import crypto from 'crypto';
import { ethers } from 'ethers';
import db from '../../db';
import logger from '../../lib/logger';
import * as chain from '../../services/chainService';
import * as lockService from '../../services/lockService';
import * as deviceService from '../device/device.service';
import type { Door, CreateDoorDto, UpdateDoorDto, DoorSearchParams, DoorCursorPage } from './door.types';

export const getAll = async (buildingId: number, params: DoorSearchParams): Promise<DoorCursorPage> => {
  const limit = Number(params.limit) || 20;
  const SORTABLE_COLS = new Set<string>(['id', 'name', 'door_code', 'mqtt_topic', 'active', 'created_at', 'updated_at']);
  const sortCol = params.sort && SORTABLE_COLS.has(params.sort) ? params.sort : 'id';
  const sortDir = params.order === 'desc' ? 'desc' : 'asc';

  const base = db('doors').where({ building_id: buildingId }).whereNull('deleted_at').orderBy(sortCol, sortDir);
  if (sortCol === 'id') {
    if (params.cursor) base.where('id', '>', Number(params.cursor));
  } else {
    const pg = Number(params.page) || 1;
    base.offset((pg - 1) * limit);
  }

  if (params.active !== undefined && params.active !== '') base.where('active', params.active === 'true');
  if (params.created_at_from) base.where('created_at', '>=', params.created_at_from);
  if (params.created_at_to) base.where('created_at', '<=', params.created_at_to);
  if (params.updated_at_from) base.where('updated_at', '>=', params.updated_at_from);
  if (params.updated_at_to) base.where('updated_at', '<=', params.updated_at_to);
  const rows = await base.clone().limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows) as Door[];
  const nextCursor = hasMore ? String(data[data.length - 1].id) : null;

  let total: number | undefined;
  if (params.count === 'true') {
    const countRow = await base.clone().count('* as count').first();
    total = Number((countRow as any).count);
  }

  return { data, nextCursor, hasMore, total };
};

export const getById = async (buildingId: number, id: number): Promise<Door | undefined> => {
  return db('doors').where({ id, building_id: buildingId }).whereNull('deleted_at').first();
};

export const create = async (buildingId: number, data: CreateDoorDto): Promise<Door> => {
  const [id] = await db('doors').insert({ ...data, building_id: buildingId });
  return getById(buildingId, id) as Promise<Door>;
};

export const update = async (buildingId: number, id: number, data: UpdateDoorDto): Promise<Door | undefined> => {
  await db('doors').where({ id, building_id: buildingId }).update({ ...data, updated_at: new Date().toISOString() });
  return getById(buildingId, id);
};

export const remove = async (buildingId: number, id: number): Promise<void> => {
  await db('doors').where({ id, building_id: buildingId }).whereNull('deleted_at').update({ deleted_at: new Date().toISOString() });
};

export interface UnlockResult {
  /** Whether the broker took the message. False is an operational fault. */
  unlocked: boolean;
  /** The `access_events` row this override created. */
  event_id: string;
  event_hash: string;
  door: { id: number; code: string; name: string };
}

/**
 * Write the denied event behind a refused override.
 *
 * Same table and same shape as a granted override, so a refusal turns up in the
 * ordinary history rather than in a separate quiet log — `signature_verified`
 * and `chain_checked` stay false because nothing was presented or consulted.
 */
async function recordRefusal(
  door: Door,
  operator: { userId?: string; email?: string },
  reason: string,
): Promise<void> {
  const actor = `admin:${operator.userId ?? 'unknown'}`;
  const eventId = crypto.randomUUID();
  const message = `${actor}|${door.door_code}|${Math.floor(Date.now() / 1000)}|${eventId}`;

  await db('access_events').insert({
    id: eventId,
    building_id: door.building_id,
    door_id: door.id,
    door_code: door.door_code,
    person_id: null,
    did: actor,
    decision: 'denied',
    reason,
    face_score: null,
    signature_verified: false,
    chain_checked: false,
    event_hash: ethers.keccak256(ethers.toUtf8Bytes(message)),
    signature: null,
    occurred_at: new Date().toISOString(),
  });

  logger.warn(
    `[access] ADMIN UNLOCK REFUSED | door=${door.door_code} ` +
      `by=${operator.email ?? actor} reason=${reason} event=${eventId}`,
  );
}

/**
 * Open a door from the dashboard, without a phone.
 *
 * There has to be a way to let somebody in when their handset is flat, and a
 * building whose only way in is a working phone is not deployable. But an
 * override that opened a door without leaving a trace would be a hole straight
 * through the thesis's own argument: §7.4 step 10 says a door that opened
 * cannot be a door nobody recorded, and an operator-initiated unlock is exactly
 * the event an auditor most wants to find.
 *
 * So this follows the same order as the mobile access path — record first, then
 * publish, then write the hash on-chain off the critical path. It is stored as
 * a granted event with reason `admin_unlock` and a `did` naming the operator,
 * so it appears in the same history, the same drift reports and the same
 * behaviour feed as any other entry rather than in a separate quiet log.
 *
 * What it deliberately does NOT do is consult the chain policy: the operator is
 * not claiming an access right, they are exercising an administrative one, and
 * pretending otherwise would put a policy check in front of the mechanism that
 * exists for when policy cannot help.
 */
export const unlock = async (
  buildingId: number,
  id: number,
  operator: { userId?: string; email?: string },
): Promise<UnlockResult | undefined> => {
  const door = await getById(buildingId, id);
  if (!door) return undefined;
  if (!door.active) throw Object.assign(new Error('door_inactive'), { status: 409 });

  // Lockdown outranks the override, including for an admin.
  //
  // The override exists for the case where policy cannot help — a flat handset,
  // a visitor with no phone. A lockdown is the opposite situation: policy is
  // working and the answer is deliberately "nobody". An operator with the right
  // to lift the lockdown can still open this door; they have to lift it first,
  // and that release is itself a recorded, deliberate act with a name attached.
  // An override that punched quietly through an emergency would make the whole
  // lockdown advisory, which is the same as not having one.
  //
  // The refusal is recorded rather than merely thrown: someone reaching for a
  // door during a lockdown is exactly the entry an incident review looks for,
  // and it would otherwise exist only in the process log.
  const building = await db('buildings').where({ id: door.building_id }).first();
  const blocked = door.locked_down
    ? 'door_locked_down'
    : building?.lockdown_at
      ? 'building_lockdown'
      : null;

  if (blocked) {
    await recordRefusal(door, operator, blocked);
    throw Object.assign(new Error(blocked), { status: 423 });
  }

  // Not a DID — there is no key behind it, and the `admin:` prefix keeps it
  // from ever colliding with the `did:ethr:` namespace a phone registers under.
  const actor = `admin:${operator.userId ?? 'unknown'}`;
  const occurredAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const message = `${actor}|${door.door_code}|${Math.floor(Date.now() / 1000)}|${eventId}`;
  const eventHash = ethers.keccak256(ethers.toUtf8Bytes(message));

  await db('access_events').insert({
    id: eventId,
    building_id: door.building_id,
    door_id: door.id,
    door_code: door.door_code,
    person_id: null,
    did: actor,
    decision: 'granted',
    reason: 'admin_unlock',
    face_score: null,
    // No signature was presented and none was checked. Recording `true` here
    // would make an override indistinguishable from a phone-signed entry.
    signature_verified: false,
    chain_checked: false,
    event_hash: eventHash,
    // Left null on purpose: `signature` carries a unique index used as the
    // replay guard, and an override has nothing to replay.
    signature: null,
    occurred_at: occurredAt,
  });

  // The lock device says how this door opens; the door's own topic is the
  // fallback for a door with no lock registered yet. See lockService.
  const lock = await deviceService.lockForDoor(door.id);
  const { delivered } = await lockService.actuate(door, lock, {
    doorId: door.id,
    doorCode: door.door_code,
    did: actor,
    eventId,
  });

  chain.logEventAsync(eventHash, door.door_code);

  logger.warn(
    `[access] ADMIN UNLOCK | door=${door.door_code} by=${operator.email ?? actor} ` +
      `unlocked=${delivered} event=${eventId}`,
  );

  return {
    unlocked: delivered,
    event_id: eventId,
    event_hash: eventHash,
    door: { id: door.id, code: door.door_code, name: door.name },
  };
};
