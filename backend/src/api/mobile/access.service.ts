/**
 * The single access path.
 *
 * Replaces two divergent implementations that both diverged from the spec:
 * `/mobile/verify/totp`, which checked a TOTP code and nothing else and did not
 * even carry a door; and `/api/verify`, which was mounted but unreachable, used
 * the door code as a DID, and authorised against the operators table.
 *
 * The order below follows sigurnosni-sustav-biometrija.md §"Tijek
 * autentifikacije" steps 7-14. Every outcome — granted or denied — is written
 * to `access_events`, because the behaviour engine has to learn from denials
 * too, and because a denial nobody recorded is a denial nobody can investigate.
 */
import crypto from 'crypto';
import { ethers } from 'ethers';
import db from '../../db';
import logger from '../../lib/logger';
import { config } from '../../config/conifg';
import { verifyTOTP } from '../../services/totpService';
import * as behavior from '../../services/behaviorService';
import * as chain from '../../services/chainService';
import * as mqttService from '../../services/mqttService';
import * as scheduleService from '../../services/scheduleService';
import type { AccessRequestInput } from './access.schema';

/** Machine-readable denial causes. Stored verbatim in access_events.reason. */
export type DenialReason =
  | 'stale_request'
  | 'replay'
  | 'unknown_did'
  | 'device_revoked'
  | 'person_inactive'
  | 'unknown_door'
  | 'door_inactive'
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
  /** An `access_events.id`; null only when a lost insert race hid it. */
  event_id: string | null;
  event_hash: string;
  door?: { code: string; name: string };
  unlocked: boolean;
  chain_checked: boolean;
  /** HTTP status the controller should use. */
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

/**
 * The exact string the phone signs, and the preimage of the on-chain event
 * hash. Must stay byte-identical to the mobile app's `signAccessRequest`
 * (mobile-app/src/lib/identity.ts) and to blockchain/test/Integration.test.js.
 */
export const accessMessage = (
  did: string,
  doorCode: string,
  timestamp: number,
  nonce: string,
) => `${did}|${doorCode}|${timestamp}|${nonce}`;

/** keccak256 of the signed message — what goes on-chain. No personal data. */
export const accessEventHash = (message: string) =>
  ethers.keccak256(ethers.toUtf8Bytes(message));

/** Thrown when the unique index on `signature` rejects a duplicate insert. */
class DuplicateSignature extends Error {}

const isUniqueViolation = (err: unknown) =>
  /UNIQUE constraint failed|duplicate key/i.test((err as Error)?.message ?? '');

async function record(draft: EventDraft, decision: 'granted' | 'denied', reason: string) {
  const id = crypto.randomUUID();
  try {
    await insertEvent(id, draft, decision, reason);
  } catch (err) {
    // The lookup in step 2 and this insert are not atomic, so two identical
    // requests in flight at once can both pass the check. The unique index is
    // the real guard; this turns losing that race into a clean replay answer
    // rather than a 500.
    if (isUniqueViolation(err)) throw new DuplicateSignature();
    throw err;
  }

  // Forward to the behaviour engine, from the one place every outcome passes
  // through — granted and denied alike, because a denial is exactly the shape
  // of behaviour worth learning from. Not awaited: the decision is already
  // made and the row is already committed, so a slow or missing engine costs
  // an alert and never an entry (config.behavior.url empty = no-op).
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

/**
 * The answer given when a signature has already been used.
 *
 * `eventId` is the ORIGINAL event's id when we found it, and null when we lost
 * the insert race and never learned it. It is never the event hash: the field
 * is an `access_events.id` that clients and logs will try to look up.
 */
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

/**
 * The local schedule matching the commitment the chain holds for this grant.
 *
 * Returns null when no local schedule hashes to `committed` — which means
 * either the schedule was edited without a re-grant, or this backend is not
 * the one that authored the policy. Both are refusals, not fallbacks.
 */
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

/**
 * Every building this person may be seen at: their home site plus attachments.
 * Exported because proximity.service.ts must scope doors identically — door
 * codes are not globally unique, and duplicating this would let the two paths
 * drift apart.
 */
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

  // 1. Freshness. Bounds how long a captured request stays interesting.
  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - timestamp;
  if (age > config.access.maxRequestAgeSeconds || age < -config.access.maxClockSkewSeconds) {
    return deny(draft, 'stale_request', 'Request expired — try again', 401);
  }

  // 2. Replay. A signature is single-use; the unique index is the real guard,
  //    this lookup just turns the constraint violation into a clean answer.
  const seen = await db('access_events').where({ signature }).first();
  if (seen) {
    // Reuse of a signature must not create a second row (unique index), so this
    // denial is logged rather than recorded.
    logger.warn(`[access] DENIED replay | did=${did} door=${door_code} original=${seen.id}`);
    return replayDecision(draft, seen.id);
  }

  // 3. Who is this? The device, not just the DID — a revoked phone whose person
  //    is still employed must not get in.
  const device = await db('person_devices').where({ did }).orderBy('id', 'desc').first();
  if (!device) return deny(draft, 'unknown_did', 'This device is not enrolled', 404);
  draft.personId = device.person_id;

  // 4. Prove key possession before anything else is revealed.
  //
  //    Everything below this point — whether a door code exists, whether a
  //    person is suspended, whether a credential is valid for a building — is
  //    only reachable by someone who can sign for this DID. A DID is an
  //    Ethereum address and effectively public, so checking the cheap database
  //    facts first would let anyone holding a DID string probe the estate.
  //
  //    The on-chain registry is the authority for the key: a backend operator
  //    who edits their own database still cannot forge a signature.
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

  // 5. Identity lifecycle.
  if (device.revoked_at) {
    return deny(draft, 'device_revoked', 'This device has been revoked');
  }

  const person = await db('people').where({ id: device.person_id }).whereNull('deleted_at').first();
  if (!person) return deny(draft, 'unknown_did', 'This device is not enrolled', 404);
  draft.buildingId = person.building_id;

  if (person.status !== 'active') {
    return deny(draft, 'person_inactive', `Access suspended (${person.status})`);
  }

  // 6. Which door? Scoped to the buildings this person actually belongs to, so
  //    a valid credential from building A cannot name a door in building B.
  //    Resolved WITHIN the person's buildings, not globally: `door_code` has no
  //    unique constraint, so two buildings may both call their entrance
  //    MAIN-01. A global `.first()` would pick the lower id — handing back the
  //    wrong building's `mqtt_topic` and opening the wrong door.
  const scopedBuildingIds = await personBuildingIds(person);

  const door = await db('doors')
    .whereIn('building_id', scopedBuildingIds)
    .where({ door_code })
    .whereNull('deleted_at')
    .first();

  if (!door) {
    // Distinguish "no such door anywhere" from "not yours" only in the log —
    // the caller gets the same answer either way.
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

  // 7. TOTP — the second factor, scoped to this door's building. The endpoint
  //    this replaces looked up `where({ did })` with no building scope at all.
  //    Keyed by (did, person) rather than by building. The secret is a device
  //    credential issued once at enrolment, so scoping the lookup to the door's
  //    building would make the multi-building case above unreachable — a
  //    contractor attached to a second site has no secret minted for it. The
  //    building boundary is enforced by the door scoping above and by the
  //    on-chain policy below, not by which row this query happens to find.
  //    (The original bug was `where({ did })` with no person and no door at
  //    all, which let any enrolled device open everything.)
  const secretRow = await db('totp_secrets')
    .where({ did, person_id: person.id })
    .whereNull('deleted_at')
    .first();
  if (!secretRow) return deny(draft, 'invalid_totp', 'No credential on file', 401);

  if (!verifyTOTP(secretRow.secret, totp, secretRow.digits, secretRow.period)) {
    return deny(draft, 'invalid_totp', 'Invalid verification code', 401);
  }

  // 8. Revocation list, then policy. Both on-chain, both free view calls.
  if (chain.isEnabled()) {
    if (await chain.isRevoked(did)) {
      return deny(draft, 'revoked_on_chain', 'This identity has been revoked');
    }

    const verdict = await chain.hasAccessWithSchedule(did, door_code);
    if (!verdict?.allowed) {
      return deny(draft, 'not_authorized', 'Not authorised for this door');
    }

    // The chain cannot express "Mon-Fri 09:00-17:00", so it commits to a hash
    // of the schedule and this enforces the window. The commitment is what
    // stops an operator quietly widening a schedule: a local schedule that
    // does not hash to what the chain holds is refused outright rather than
    // trusted, so tampering shows up as a denial instead of silent access.
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

  // 9. Face. Advisory in the old endpoint, which logged `face: bypassed`;
  //    enforced here, because the client deciding its own gate is not a gate.
  if (config.access.requireFace) {
    if (faceScore == null) return deny(draft, 'face_missing', 'Face verification required', 401);
    if (faceScore < config.access.faceThreshold) {
      return deny(draft, 'face_below_threshold', 'Face not recognised', 401);
    }
  }

  // 10. Record FIRST, then open the door.
  //
  //    The replay lookup in step 2 and this insert are not atomic — the unique
  //    index on `signature` is the real guard. Publishing before the row
  //    commits means two racing copies of one signed request both reach the
  //    lock while only one is ever recorded, producing a physical unlock with
  //    no audit row and no on-chain hash. That is the exact outcome this
  //    system exists to rule out, so the write that can reject goes first.
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

  // The unlock itself is not allowed to fail the request: the decision is made
  // and recorded, and an unreachable broker is an operational fault to report
  // (`unlocked: false`), not a reason to pretend access was denied.
  const unlocked = await mqttService.publishUnlock(door.mqtt_topic, {
    doorId: door.id,
    doorCode: door.door_code,
    did,
    eventId,
  });

  // 11. Durable proof, off the critical path — nobody waits ~12s at a door.
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
