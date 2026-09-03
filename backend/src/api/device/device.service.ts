import mqtt from 'mqtt';
import db from '../../db';
import logger from '../../lib/logger';
import { config } from '../../config/conifg';
import type {
  Device, DeviceWithDoor, CreateDeviceDto, UpdateDeviceDto,
  DeviceSearchParams, DeviceCursorPage, DiscoveredDevice,
} from './device.types';

const SORTABLE = new Set(['id', 'name', 'kind', 'address', 'active', 'created_at', 'updated_at']);

/** Devices with the door they are attached to, so the list can show it. */
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
  // `door_id=none` is how the UI asks for unassigned hardware, which is a
  // different question from "any door" and cannot be expressed by a plain id.
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

/**
 * Refuse a door from another building.
 *
 * Without this an operator could attach their own hardware to somebody else's
 * door by id, and the device list would then leak that door's name back to them
 * through the join above.
 */
async function assertDoorInBuilding(buildingId: number, doorId: number | null | undefined) {
  if (doorId === null || doorId === undefined) return;
  const door = await db('doors')
    .where({ id: doorId, building_id: buildingId })
    .whereNull('deleted_at')
    .first();
  if (!door) throw Object.assign(new Error('door_not_found'), { status: 404 });
}

export const create = async (buildingId: number, data: CreateDeviceDto): Promise<DeviceWithDoor> => {
  await assertDoorInBuilding(buildingId, data.door_id);
  const [id] = await db('devices').insert({ ...data, building_id: buildingId });
  return (await getById(buildingId, id)) as DeviceWithDoor;
};

export const update = async (
  buildingId: number,
  id: number,
  data: UpdateDeviceDto,
): Promise<DeviceWithDoor | undefined> => {
  await assertDoorInBuilding(buildingId, data.door_id);
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

/** Every device attached to one door — what the door editor shows. */
export const listForDoor = async (buildingId: number, doorId: number): Promise<Device[]> =>
  db('devices')
    .where({ building_id: buildingId, door_id: doorId })
    .whereNull('deleted_at')
    .orderBy('kind')
    .select('*');

/**
 * Listen to the broker and report which devices are talking.
 *
 * This is the only discovery mechanism that needs nothing new: the broker is
 * already running and already reachable from this container, whereas mDNS
 * multicast does not cross Docker's bridge network and a port scan tells you
 * an address but never what the thing is.
 *
 * It reports topics, not devices — the operator names them and says what they
 * are. A silent device simply will not appear, which is why the UI also allows
 * adding one by hand.
 */
export const scan = async (buildingId: number, seconds = 8): Promise<DiscoveredDevice[]> => {
  if (!config.mqtt.url) return [];

  const seen = new Map<string, { messages: number; sample: string | null }>();

  await new Promise<void>((resolve) => {
    const client = mqtt.connect(config.mqtt.url, {
      username: config.mqtt.username || undefined,
      password: config.mqtt.password || undefined,
      connectTimeout: 5000,
      reconnectPeriod: 0,
      clientId: `${config.mqtt.clientId}-scan-${Math.random().toString(16).slice(2, 8)}`,
    });

    // Always resolve: a broker that never connects is an empty result, not a
    // hung request.
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

  // Mark what is already registered so the UI can grey it out rather than
  // inviting a duplicate.
  const known = new Set(
    (await db('devices')
      .where({ building_id: buildingId })
      .whereNull('deleted_at')
      .whereNotNull('address')
      .pluck('address')) as string[],
  );

  return [...seen.entries()]
    .map(([topic, v]) => ({
      topic,
      messages: v.messages,
      sample: v.sample,
      // A device's address is the base topic, so anything published beneath it
      // still counts as that device rather than a new one.
      known: known.has(topic) || [...known].some((a) => topic.startsWith(`${a}/`)),
    }))
    .sort((a, b) => b.messages - a.messages || a.topic.localeCompare(b.topic));
};
