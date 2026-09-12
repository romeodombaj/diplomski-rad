import net from 'net';
import mqtt from 'mqtt';
import db from '../../db';
import logger from '../../lib/logger';
import { config } from '../../config/conifg';
import type {
  Device, DeviceWithDoor, CreateDeviceDto, UpdateDeviceDto,
  DeviceSearchParams, DeviceCursorPage, DiscoveredDevice,
} from './device.types';
import type { LockDevice } from '../../services/lockService';

const SORTABLE = new Set(['id', 'name', 'kind', 'address', 'active', 'created_at', 'updated_at']);

const withDoor = (buildingId: number) =>
  db('devices as dv')
    .leftJoin('doors as d', 'd.id', 'dv.door_id')
    .where('dv.building_id', buildingId)
    .whereNull('dv.deleted_at')
    .select('dv.*', 'd.name as door_name', 'd.door_code as door_code');

export const getAll = async (
  buildingId: number,
  params: DeviceSearchParams,
): Promise<DeviceCursorPage> => {
  const limit = Number(params.limit) || 20;
  const sortCol = params.sort && SORTABLE.has(params.sort) ? `dv.${params.sort}` : 'dv.id';
  const sortDir = params.order === 'desc' ? 'desc' : 'asc';

  const base = withDoor(buildingId).orderBy(sortCol, sortDir);

  if (params.q) {
    const q = `%${params.q}%`;
    base.where((b) => b.where('dv.name', 'like', q).orWhere('dv.address', 'like', q));
  }
  if (params.kind) base.where('dv.kind', params.kind);
  if (params.active !== undefined && params.active !== '') {
    base.where('dv.active', params.active === 'true');
  }
  if (params.door_id === 'none') base.whereNull('dv.door_id');
  else if (params.door_id) base.where('dv.door_id', Number(params.door_id));

  if (sortCol === 'dv.id') {
    if (params.cursor) base.where('dv.id', '>', Number(params.cursor));
  } else {
    const page = Number(params.page) || 1;
    base.offset((page - 1) * limit);
  }

  const rows = await base.clone().limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows) as DeviceWithDoor[];

  let total: number | undefined;
  if (params.count === 'true') {
    const row = await base.clone().clearOrder().clearSelect().count('* as count').first();
    total = Number((row as any)?.count ?? 0);
  }

  return { data, nextCursor: hasMore ? String(data[data.length - 1].id) : null, hasMore, total };
};

export const getById = async (buildingId: number, id: number): Promise<DeviceWithDoor | undefined> =>
  withDoor(buildingId).where('dv.id', id).first();

async function assertDoorInBuilding(buildingId: number, doorId: number | null | undefined) {
  if (doorId === null || doorId === undefined) return;
  const door = await db('doors')
    .where({ id: doorId, building_id: buildingId })
    .whereNull('deleted_at')
    .first();
  if (!door) throw Object.assign(new Error('door_not_found'), { status: 404 });
}

async function assertNoOtherOfKind(
  buildingId: number,
  doorId: number | null | undefined,
  kind: string | undefined,
  selfId?: number,
) {
  if (!kind || !doorId) return;
  const existing = await db('devices')
    .where({ door_id: doorId, kind, building_id: buildingId })
    .whereNull('deleted_at')
    .modify((q) => { if (selfId) q.whereNot('id', selfId); })
    .first();
  if (existing) {
    throw Object.assign(
      new Error(`door already has a ${kind} device: ${existing.name}`),
      { status: 409 },
    );
  }
}

export const create = async (buildingId: number, data: CreateDeviceDto): Promise<DeviceWithDoor> => {
  await assertDoorInBuilding(buildingId, data.door_id);
  await assertNoOtherOfKind(buildingId, data.door_id, data.kind);
  const [id] = await db('devices').insert({ ...data, building_id: buildingId });
  return (await getById(buildingId, id)) as DeviceWithDoor;
};

export const update = async (
  buildingId: number,
  id: number,
  data: UpdateDeviceDto,
): Promise<DeviceWithDoor | undefined> => {
  await assertDoorInBuilding(buildingId, data.door_id);

  const current = await db('devices').where({ id, building_id: buildingId }).whereNull('deleted_at').first();
  if (current) {
    await assertNoOtherOfKind(
      buildingId,
      data.door_id === undefined ? current.door_id : data.door_id,
      data.kind ?? current.kind,
      id,
    );
  }

  await db('devices')
    .where({ id, building_id: buildingId })
    .whereNull('deleted_at')
    .update({ ...data, updated_at: new Date().toISOString() });
  return getById(buildingId, id);
};

export const remove = async (buildingId: number, id: number): Promise<void> => {
  await db('devices')
    .where({ id, building_id: buildingId })
    .whereNull('deleted_at')
    .update({ deleted_at: new Date().toISOString(), door_id: null });
};

export const listForDoor = async (buildingId: number, doorId: number): Promise<Device[]> =>
  db('devices')
    .where({ building_id: buildingId, door_id: doorId })
    .whereNull('deleted_at')
    .orderBy('kind')
    .select('*');

const ESPHOME_COMPONENTS = new Set([
  'alarm_control_panel', 'binary_sensor', 'button', 'climate', 'cover', 'datetime',
  'event', 'fan', 'light', 'lock', 'number', 'select', 'sensor', 'switch', 'text',
  'text_sensor', 'update', 'valve',
]);

const ESPHOME_NODE_TOPICS = new Set(['debug', 'status']);

export function deviceRoot(topic: string): string {
  const parts = topic.split('/');

  if (parts.length === 3 && parts[0] === 'esphome' && parts[1] === 'discover') return parts[2];

  if (parts.length === 2 && ESPHOME_NODE_TOPICS.has(parts[1])) return parts[0];

  if (parts.length === 4 && ESPHOME_COMPONENTS.has(parts[1])) return parts[0];

  return topic;
}

function parseDiscovery(sample: string | null): { name: string | null; ip: string | null } {
  if (!sample) return { name: null, ip: null };
  try {
    const json = JSON.parse(sample);
    return {
      name: json.friendly_name ?? json.name ?? null,
      ip: json.ip ?? null,
    };
  } catch {
    return { name: null, ip: null };
  }
}

const TUYA_PORT = 6668;

async function sweepTuya(subnet: string, timeoutMs = 700): Promise<string[]> {
  const match = /^(\d+)\.(\d+)\.(\d+)\.\d+\/24$/.exec(subnet.trim());
  if (!match) {
    if (subnet.trim()) logger.warn(`[devices] DEVICE_SCAN_SUBNET must be a /24, got "${subnet}"`);
    return [];
  }
  const [, a, b, c] = match;

  const probe = (host: string) =>
    new Promise<string | null>((resolve) => {
      const socket = new net.Socket();
      const finish = (hit: boolean) => {
        socket.destroy();
        resolve(hit ? host : null);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(TUYA_PORT, host);
    });

  const hosts = Array.from({ length: 254 }, (_, i) => `${a}.${b}.${c}.${i + 1}`);
  const found: string[] = [];
  const BATCH = 64;
  for (let i = 0; i < hosts.length; i += BATCH) {
    const results = await Promise.all(hosts.slice(i, i + BATCH).map(probe));
    found.push(...results.filter((h): h is string => h !== null));
  }
  return found;
}

export const scan = async (buildingId: number, seconds = 8): Promise<DiscoveredDevice[]> => {
  if (!config.mqtt.url) return [];

  const seen = new Map<string, { messages: number; sample: string | null }>();

  const tuyaScan = sweepTuya(config.devices.scanSubnet).catch((err) => {
    logger.warn(`[devices] tuya sweep: ${(err as Error).message}`);
    return [] as string[];
  });

  await new Promise<void>((resolve) => {
    const client = mqtt.connect(config.mqtt.url, {
      username: config.mqtt.username || undefined,
      password: config.mqtt.password || undefined,
      connectTimeout: 5000,
      reconnectPeriod: 0,
      clientId: `${config.mqtt.clientId}-scan-${Math.random().toString(16).slice(2, 8)}`,
    });

    const done = () => {
      clearTimeout(timer);
      client.end(true, {}, () => resolve());
    };
    const timer = setTimeout(done, seconds * 1000);

    client.on('connect', () => client.subscribe('#', { qos: 0 }));
    client.on('error', (err) => {
      logger.warn(`[devices] scan: ${err.message}`);
      done();
    });
    client.on('message', (topic, payload) => {
      const entry = seen.get(topic) ?? { messages: 0, sample: null };
      entry.messages += 1;
      entry.sample = payload.toString('utf8').slice(0, 120) || null;
      seen.set(topic, entry);
    });
  });

  const known = new Set(
    (await db('devices')
      .where({ building_id: buildingId })
      .whereNull('deleted_at')
      .whereNotNull('address')
      .pluck('address')) as string[],
  );

  const devices = new Map<string, DiscoveredDevice>();
  for (const [topic, v] of seen) {
    const root = deviceRoot(topic);
    const device: DiscoveredDevice = devices.get(root) ?? {
      source: 'mqtt' as const,
      topic: root,
      name: null,
      ip: null,
      messages: 0,
      sample: null,
      known: false,
      topics: [],
    };
    device.messages += v.messages;
    device.topics.push({ topic, messages: v.messages, sample: v.sample });

    if (topic.startsWith('esphome/discover/')) {
      const { name, ip } = parseDiscovery(v.sample);
      device.name = name ?? device.name;
      device.ip = ip ?? device.ip;
      device.sample = v.sample;
    } else if (device.sample === null) {
      device.sample = v.sample;
    }

    devices.set(root, device);
  }

  const byMqttIp = new Set(
    [...devices.values()].map((d) => d.ip).filter((ip): ip is string => Boolean(ip)),
  );
  for (const host of await tuyaScan) {
    if (byMqttIp.has(host) || devices.has(host)) continue;
    devices.set(host, {
      source: 'tuya',
      topic: host,
      name: null,
      ip: host,
      messages: 0,
      sample: null,
      known: false,
      topics: [],
    });
  }

  return [...devices.values()]
    .map((d) => ({
      ...d,
      known:
        known.has(d.topic) ||
        [...known].some((a) => d.topic === a || d.topic.startsWith(`${a}/`)),
      topics: d.topics.sort((a, b) => b.messages - a.messages || a.topic.localeCompare(b.topic)),
    }))
    .sort((a, b) => b.messages - a.messages || a.topic.localeCompare(b.topic));
};

export const lockForDoor = async (doorId: number): Promise<LockDevice | null> => {
  const row = await db('devices')
    .where({ door_id: doorId, kind: 'lock' })
    .whereNull('deleted_at')
    .first();
  return (row as LockDevice) ?? null;
};
