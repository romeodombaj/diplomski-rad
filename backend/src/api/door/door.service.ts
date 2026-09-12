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
  unlocked: boolean;
  event_id: string;
  event_hash: string;
  door: { id: number; code: string; name: string };
}

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

export const unlock = async (
  buildingId: number,
  id: number,
  operator: { userId?: string; email?: string },
): Promise<UnlockResult | undefined> => {
  const door = await getById(buildingId, id);
  if (!door) return undefined;
  if (!door.active) throw Object.assign(new Error('door_inactive'), { status: 409 });

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
    signature_verified: false,
    chain_checked: false,
    event_hash: eventHash,
    signature: null,
    occurred_at: occurredAt,
  });

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
