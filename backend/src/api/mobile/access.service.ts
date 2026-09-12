import crypto from 'crypto';
import { ethers } from 'ethers';
import db from '../../db';
import logger from '../../lib/logger';
import { config } from '../../config/conifg';
import { verifyTOTP } from '../../services/totpService';
import * as behavior from '../../services/behaviorService';
import * as chain from '../../services/chainService';
import * as lockService from '../../services/lockService';
import * as deviceService from '../device/device.service';
import * as scheduleService from '../../services/scheduleService';
import type { AccessRequestInput } from './access.schema';

export type DenialReason =
  | 'stale_request'
  | 'replay'
  | 'unknown_did'
  | 'device_revoked'
  | 'person_inactive'
  | 'unknown_door'
  | 'door_inactive'
  | 'door_locked_down'
  | 'building_lockdown'
  | 'door_not_in_scope'
  | 'no_public_key'
  | 'invalid_signature'
  | 'invalid_totp'
  | 'revoked_on_chain'
  | 'not_authorized'
  | 'schedule_unknown'
  | 'outside_schedule'
  | 'face_missing'
  | 'face_below_threshold'
  | 'chain_unavailable';

export interface AccessDecision {
  granted: boolean;
  reason: DenialReason | 'ok';
  message: string;
  event_id: string | null;
  event_hash: string;
  door?: { code: string; name: string };
  unlocked: boolean;
  chain_checked: boolean;
  httpStatus: number;
}

interface EventDraft {
  buildingId: number | null;
  doorId: number | null;
  doorCode: string;
  personId: string | null;
  did: string;
  faceScore: number | null;
  signatureVerified: boolean;
  chainChecked: boolean;
  eventHash: string;
  signature: string;
  occurredAt: string;
}

export const accessMessage = (
  did: string,
  doorCode: string,
  timestamp: number,
  nonce: string,
) => `${did}|${doorCode}|${timestamp}|${nonce}`;

export const accessEventHash = (message: string) =>
  ethers.keccak256(ethers.toUtf8Bytes(message));

class DuplicateSignature extends Error {}

const isUniqueViolation = (err: unknown) =>
  /UNIQUE constraint failed|duplicate key/i.test((err as Error)?.message ?? '');

async function record(draft: EventDraft, decision: 'granted' | 'denied', reason: string) {
  const id = crypto.randomUUID();
  try {
    await insertEvent(id, draft, decision, reason);
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateSignature();
    throw err;
  }

  behavior.scoreAsync(
    {
      event_id: id,
      person_id: draft.personId,
      did: draft.did,
      door_code: draft.doorCode,
      building_id: draft.buildingId,
      timestamp: draft.occurredAt,
      success: decision === 'granted',
    },
    draft.buildingId,
  );

  return id;
}

async function insertEvent(
  id: string,
  draft: EventDraft,
  decision: 'granted' | 'denied',
  reason: string,
) {
  await db('access_events').insert({
    id,
    building_id: draft.buildingId,
    door_id: draft.doorId,
    door_code: draft.doorCode,
    person_id: draft.personId,
    did: draft.did,
    decision,
    reason,
    face_score: draft.faceScore,
    signature_verified: draft.signatureVerified,
    chain_checked: draft.chainChecked,
    event_hash: draft.eventHash,
    signature: draft.signature,
    occurred_at: draft.occurredAt,
  });
}

const replayDecision = (draft: EventDraft, eventId: string | null): AccessDecision => ({
  granted: false,
  reason: 'replay',
  message: 'This request was already used',
  event_id: eventId,
  event_hash: draft.eventHash,
  unlocked: false,
  chain_checked: false,
  httpStatus: 409,
});

const deny = async (
  draft: EventDraft,
  reason: DenialReason,
  message: string,
  httpStatus = 403,
): Promise<AccessDecision> => {
  let eventId: string;
  try {
    eventId = await record(draft, 'denied', reason);
  } catch (err) {
    if (err instanceof DuplicateSignature) return replayDecision(draft, null);
    throw err;
  }
  logger.warn(
    `[access] DENIED ${reason} | did=${draft.did} door=${draft.doorCode} event=${eventId}`,
  );
  return {
    granted: false,
    reason,
    message,
    event_id: eventId,
    event_hash: draft.eventHash,
    unlocked: false,
    chain_checked: draft.chainChecked,
    httpStatus,
  };
};

async function findCommittedSchedule(
  personId: string,
  doorId: number,
  committed: string,
): Promise<scheduleService.Schedule | null> {
  const rows = await db('access_policy_mirror')
    .where({ person_id: personId, door_id: doorId })
    .whereNotNull('schedule_id');

  for (const row of rows) {
    const schedule = await db('access_schedules').where({ id: row.schedule_id }).first();
    if (schedule && scheduleService.matchesCommitment(schedule, committed)) return schedule;
  }
  return null;
}

export async function personBuildingIds(person: { id: string; building_id: number }): Promise<number[]> {
  const extra = await db('person_buildings')
    .where({ person_id: person.id })
    .pluck('building_id');
  return Array.from(new Set([person.building_id, ...extra]));
}

export async function decide(input: AccessRequestInput): Promise<AccessDecision> {
  const { did, signature, totp, door_code, timestamp, nonce, faceScore } = input;
  const message = accessMessage(did, door_code, timestamp, nonce);

  const draft: EventDraft = {
    buildingId: null,
    doorId: null,
    doorCode: door_code,
    personId: null,
    did,
    faceScore: faceScore ?? null,
    signatureVerified: false,
    chainChecked: false,
    eventHash: accessEventHash(message),
    signature,
    occurredAt: new Date().toISOString(),
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - timestamp;
  if (age > config.access.maxRequestAgeSeconds || age < -config.access.maxClockSkewSeconds) {
    return deny(draft, 'stale_request', 'Request expired — try again', 401);
  }

  const seen = await db('access_events').where({ signature }).first();
  if (seen) {
    logger.warn(`[access] DENIED replay | did=${did} door=${door_code} original=${seen.id}`);
    return replayDecision(draft, seen.id);
  }

  const device = await db('person_devices').where({ did }).orderBy('id', 'desc').first();
  if (!device) return deny(draft, 'unknown_did', 'This device is not enrolled', 404);
  draft.personId = device.person_id;

  const chainKey = await chain.getPublicKey(did);
  const publicKey = chainKey ?? device.public_key;
  draft.chainChecked = chainKey !== null;

  if (!publicKey) {
    return deny(
      draft,
      'no_public_key',
      chain.isEnabled()
        ? 'Identity is not registered on-chain'
        : 'No public key on file for this device',
      401,
    );
  }
  if (chainKey === null && config.chain.requireChain) {
    return deny(draft, 'chain_unavailable', 'Identity registry unavailable', 503);
  }

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return deny(draft, 'invalid_signature', 'Signature verification failed', 401);
  }
  if (recovered.toLowerCase() !== ethers.computeAddress(publicKey).toLowerCase()) {
    return deny(draft, 'invalid_signature', 'Signature verification failed', 401);
  }
  draft.signatureVerified = true;

  if (device.revoked_at) {
    return deny(draft, 'device_revoked', 'This device has been revoked');
  }

  const person = await db('people').where({ id: device.person_id }).whereNull('deleted_at').first();
  if (!person) return deny(draft, 'unknown_did', 'This device is not enrolled', 404);
  draft.buildingId = person.building_id;

  if (person.status !== 'active') {
    return deny(draft, 'person_inactive', `Access suspended (${person.status})`);
  }

  const scopedBuildingIds = await personBuildingIds(person);

  const door = await db('doors')
    .whereIn('building_id', scopedBuildingIds)
    .where({ door_code })
    .whereNull('deleted_at')
    .first();

  if (!door) {
    const existsElsewhere = await db('doors').where({ door_code }).whereNull('deleted_at').first();
    if (existsElsewhere) {
      draft.doorId = existsElsewhere.id;
      return deny(draft, 'door_not_in_scope', 'Not authorised for this location');
    }
    return deny(draft, 'unknown_door', 'Unknown door', 404);
  }
  draft.doorId = door.id;
  draft.buildingId = door.building_id;

  if (!door.active) return deny(draft, 'door_inactive', 'This door is out of service');

  if (door.locked_down) {
    return deny(draft, 'door_locked_down', 'This door is locked down');
  }

  const building = await db('buildings').where({ id: door.building_id }).first();
  if (building?.lockdown_at) {
    return deny(draft, 'building_lockdown', 'The building is in emergency lockdown');
  }

  const secretRow = await db('totp_secrets')
    .where({ did, person_id: person.id })
    .whereNull('deleted_at')
    .first();
  if (!secretRow) return deny(draft, 'invalid_totp', 'No credential on file', 401);

  if (!verifyTOTP(secretRow.secret, totp, secretRow.digits, secretRow.period)) {
    return deny(draft, 'invalid_totp', 'Invalid verification code', 401);
  }

  if (chain.isEnabled()) {
    if (await chain.isRevoked(did)) {
      return deny(draft, 'revoked_on_chain', 'This identity has been revoked');
    }

    const verdict = await chain.hasAccessWithSchedule(did, door_code);
    if (!verdict?.allowed) {
      return deny(draft, 'not_authorized', 'Not authorised for this door');
    }

    if (verdict.scheduleHash !== chain.NO_SCHEDULE) {
      const schedule = await findCommittedSchedule(person.id, door.id, verdict.scheduleHash);
      if (!schedule) {
        return deny(draft, 'schedule_unknown', 'Access schedule could not be verified', 403);
      }
      if (!scheduleService.isWithinSchedule(schedule)) {
        return deny(draft, 'outside_schedule', 'Outside your permitted hours');
      }
    }
  } else if (config.chain.requireChain) {
    return deny(draft, 'chain_unavailable', 'Access policy unavailable', 503);
  }

  if (config.access.requireFace) {
    if (faceScore == null) return deny(draft, 'face_missing', 'Face verification required', 401);
    if (faceScore < config.access.faceThreshold) {
      return deny(draft, 'face_below_threshold', 'Face not recognised', 401);
    }
  }

  let eventId: string;
  try {
    eventId = await record(draft, 'granted', 'ok');
  } catch (err) {
    if (err instanceof DuplicateSignature) {
      logger.warn(`[access] concurrent duplicate signature | did=${did} door=${door_code}`);
      return replayDecision(draft, null);
    }
    throw err;
  }

  const lock = await deviceService.lockForDoor(door.id);
  const { delivered: unlocked } = await lockService.actuate(door, lock, {
    doorId: door.id,
    doorCode: door.door_code,
    did,
    eventId,
  });

  chain.logEventAsync(draft.eventHash, door_code);

  logger.info(
    `[access] GRANTED | did=${did} door=${door_code} face=${faceScore ?? 'n/a'} ` +
      `chain=${draft.chainChecked} unlocked=${unlocked} event=${eventId}`,
  );

  return {
    granted: true,
    reason: 'ok',
    message: 'Access granted',
    event_id: eventId,
    event_hash: draft.eventHash,
    door: { code: door.door_code, name: door.name },
    unlocked,
    chain_checked: draft.chainChecked,
    httpStatus: 200,
  };
}
