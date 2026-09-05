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

/**
 * Refuse a second lock on a door that already has one.
 *
 * A unique index enforces this in the database, but a constraint violation
 * surfaces as a 500 and a message about an index name. The operator's actual
 * question is "which lock is already there", so answer that.
 *
 * Two of a kind on one door is not a configuration but a mistake: the code
 * would have to pick one, and picking silently means an unlock that opens
 * whichever row happened to sort first, or a ring reporting the wrong distance.
 */
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

  // A PATCH may move a device to a door, turn it into a lock, or both, so the
  // check runs against the row as it will be rather than as it is.
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

/** Every device attached to one door — what the door editor shows. */
export const listForDoor = async (buildingId: number, doorId: number): Promise<Device[]> =>
  db('devices')
    .where({ building_id: buildingId, door_id: doorId })
    .whereNull('deleted_at')
    .orderBy('kind')
    .select('*');

/**
 * ESPHome publishes one topic per entity, so a single node appears on the wire
 * as a handful of unrelated-looking topics. These are the component prefixes it
 * uses in `<node>/<component>/<object>/state`.
 */
const ESPHOME_COMPONENTS = new Set([
  'alarm_control_panel', 'binary_sensor', 'button', 'climate', 'cover', 'datetime',
  'event', 'fan', 'light', 'lock', 'number', 'select', 'sensor', 'switch', 'text',
  'text_sensor', 'update', 'valve',
]);

/** Topics an ESPHome node publishes about itself rather than about an entity. */
const ESPHOME_NODE_TOPICS = new Set(['debug', 'status']);

/**
 * Which device a topic belongs to.
 *
 * Deliberately conservative: only shapes that are *recognisably* one node's
 * sub-topics are folded together. Everything else stays its own row, because a
 * door's command topic looks like `doors/front-01/cmd`, and grouping by first
 * segment would merge every door in the building into a single "doors" device.
 */
export function deviceRoot(topic: string): string {
  const parts = topic.split('/');

  // `esphome/discover/<node>` — the node announcing itself at boot.
  if (parts.length === 3 && parts[0] === 'esphome' && parts[1] === 'discover') return parts[2];

  // `<node>/debug`, `<node>/status`
  if (parts.length === 2 && ESPHOME_NODE_TOPICS.has(parts[1])) return parts[0];

  // `<node>/<component>/<object>/state|command|config`
  if (parts.length === 4 && ESPHOME_COMPONENTS.has(parts[1])) return parts[0];

  return topic;
}

/** Pull the friendly name and address out of an ESPHome discovery payload. */
function parseDiscovery(sample: string | null): { name: string | null; ip: string | null } {
  if (!sample) return { name: null, ip: null };
  try {
    const json = JSON.parse(sample);
    return {
      name: json.friendly_name ?? json.name ?? null,
      ip: json.ip ?? null,
    };
  } catch {
    // The sample is truncated to 120 chars, so a long discovery payload will
    // not parse. A missing name is not an error — the operator types one.
    return { name: null, ip: null };
  }
}

/**
 * Listen to the broker and report which devices are talking.
 *
 * This is the only discovery mechanism that needs nothing new: the broker is
 * already running and already reachable from this container, whereas mDNS
 * multicast does not cross Docker's bridge network and a port scan tells you
 * an address but never what the thing is.
 *
 * Results are grouped by device, not by topic. One ESPHome node publishes a
 * discovery topic, a debug/log topic and one topic per entity it exposes, so an
 * ungrouped list showed a single ReSpeaker ring as five separate "devices" and
 * invited the operator to register all five. A silent device still will not
 * appear at all, which is why the UI also allows adding one by hand.
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

  // Fold the raw topics into one entry per device.
  const devices = new Map<string, DiscoveredDevice>();
  for (const [topic, v] of seen) {
    const root = deviceRoot(topic);
    const device = devices.get(root) ?? {
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

    // The discovery payload is the one that actually names the device, so it
    // wins over whichever entity happened to publish most.
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

  return [...devices.values()]
    .map((d) => ({
      ...d,
      // A device's address is its base topic, so anything published beneath it
      // still counts as that device rather than a new one.
      known:
        known.has(d.topic) ||
        [...known].some((a) => d.topic === a || d.topic.startsWith(`${a}/`)),
      topics: d.topics.sort((a, b) => b.messages - a.messages || a.topic.localeCompare(b.topic)),
    }))
    .sort((a, b) => b.messages - a.messages || a.topic.localeCompare(b.topic));
};

/**
 * The lock attached to one door, if any.
 *
 * The unique index added in 20260904120000 guarantees at most one, so this is a
 * `first()` on a set that cannot have two members rather than an arbitrary pick.
 */
export const lockForDoor = async (doorId: number): Promise<LockDevice | null> => {
  const row = await db('devices')
    .where({ door_id: doorId, kind: 'lock' })
    .whereNull('deleted_at')
    .first();
  return (row as LockDevice) ?? null;
};
