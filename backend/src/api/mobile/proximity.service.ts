/**
 * Door LED proximity reports.
 *
 * The phone hears a door's BLE beacon, buckets the signal strength, and tells
 * the backend; the backend forwards it to that door's MQTT topic so the
 * hardware can light a ring as someone walks up. That is the whole feature.
 *
 * WHAT THIS IS NOT: an access decision, or an input to one. Nothing here can
 * open a door, and `decide()` in access.service.ts never reads a proximity
 * report. Per specs/HARDWARE_ACCESS_NOTES.md the BLE gate is a UX convenience,
 * not a security boundary — RSSI is trivially spoofed by a modified client, so
 * treating it as evidence of anything would be a mistake. It is treated here as
 * a request to turn on some lights, which is exactly what it is.
 *
 * NOTHING IS WRITTEN TO `access_events`. That table is the record of access
 * decisions and the behaviour engine's declared training set; filling it with
 * LED updates would both destroy it as an audit log and poison the anomaly
 * model with events that are not access attempts.
 */
import { ethers } from 'ethers';
import db from '../../db';
import logger from '../../lib/logger';
import { config } from '../../config/conifg';
import * as mqttService from '../../services/mqttService';
import { personBuildingIds } from './access.service';
import type { ProximityReportInput } from './proximity.schema';

export type ProximityRejection =
  | 'stale_report'
  | 'unknown_did'
  | 'device_revoked'
  | 'person_inactive'
  | 'no_public_key'
  | 'invalid_signature'
  | 'unknown_door'
  | 'door_inactive';

export interface ProximityResult {
  accepted: boolean;
  reason: ProximityRejection | 'ok';
  published: boolean;
  level: number;
  httpStatus: number;
}

/**
 * The string a phone signs to move a door's LEDs.
 *
 * Domain separation from `accessMessage` (`did|door_code|timestamp|nonce`) is
 * structural, not just conventional, and both halves matter:
 *
 *  - The literal `proximity|` prefix means a captured ACCESS signature can
 *    never be replayed here, because the server always builds this string with
 *    that prefix and an access message never carries it.
 *
 *  - `level` goes LAST, after the nonce, so a captured PROXIMITY signature can
 *    never be replayed as an access request. `door_code` is a free-form string
 *    and could smuggle a `|` to forge extra fields in the middle, but to match
 *    this layout an attacker would have to append `|<level>` after the nonce —
 *    and `nonce` is regex-bound to hex, so it cannot contain a pipe, and
 *    `timestamp` is a number. There is no field left to grow.
 *
 * Put `level` anywhere but last and that second property quietly disappears.
 */
export const proximityMessage = (
  did: string,
  doorCode: string,
  timestamp: number,
  nonce: string,
  level: number,
) => `proximity|${did}|${doorCode}|${timestamp}|${nonce}|${level}`;

const reject = (
  reason: ProximityRejection,
  httpStatus: number,
  detail: string,
): ProximityResult => {
  // Logged, never returned in detail: the caller gets one shape for every
  // rejection so this endpoint cannot be used to enumerate doors or people.
  logger.debug(`[proximity] rejected ${reason} — ${detail}`);
  return { accepted: false, reason, published: false, level: 0, httpStatus };
};

export async function report(input: ProximityReportInput): Promise<ProximityResult> {
  const { did, signature, door_code, timestamp, nonce, rssi } = input;

  // Clamp rather than reject: a phone configured for a ten-step ring talking to
  // a backend configured for eight is a misconfiguration that should dim the
  // lights, not start returning errors at somebody standing in a doorway.
  const level = Math.min(input.level, config.proximity.levels);

  // 1. Freshness. Much tighter than an access request's window, because a
  //    report is a claim about where someone is *now* and the phone re-sends
  //    on every bucket change anyway — there is no reason to accept an old one.
  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - timestamp;
  if (age > config.proximity.maxAgeSeconds || age < -config.proximity.maxClockSkewSeconds) {
    return reject('stale_report', 400, `age=${age}s did=${did}`);
  }

  // 2. Which device? Same lookup as the access path.
  const device = await db('person_devices').where({ did }).orderBy('id', 'desc').first();
  if (!device) return reject('unknown_did', 404, `did=${did}`);
  if (device.revoked_at) return reject('device_revoked', 403, `did=${did}`);

  // 3. Signature, against the LOCALLY stored public key rather than the
  //    on-chain one.
  //
  //    The access path deliberately prefers the chain, because there the key is
  //    what stops a backend operator forging entry. Here it would mean an RPC
  //    round trip for every step of an LED ring — up to `levels` of them as one
  //    person walks to a door — to protect a light. The worst outcome of
  //    trusting the local copy is that a tampered database lights a wrong ring.
  if (!device.public_key) return reject('no_public_key', 401, `did=${did}`);

  const message = proximityMessage(did, door_code, timestamp, nonce, input.level);
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return reject('invalid_signature', 401, `did=${did}`);
  }
  if (recovered.toLowerCase() !== ethers.computeAddress(device.public_key).toLowerCase()) {
    return reject('invalid_signature', 401, `did=${did}`);
  }

  // 4. Is this person still someone whose approach we light up?
  const person = await db('people').where({ id: device.person_id }).whereNull('deleted_at').first();
  if (!person) return reject('unknown_did', 404, `did=${did}`);
  if (person.status !== 'active') return reject('person_inactive', 403, `did=${did}`);

  // 5. Resolve the door WITHIN this person's buildings, exactly as the access
  //    path does. `door_code` has no unique constraint, so a global lookup
  //    could pick another building's door and publish to its topic — a
  //    suspended contractor lighting up a ring at a site they have never been
  //    to reads as someone standing there.
  const scopedBuildingIds = await personBuildingIds(person);
  const door = await db('doors')
    .whereIn('building_id', scopedBuildingIds)
    .where({ door_code })
    .whereNull('deleted_at')
    .first();

  if (!door) return reject('unknown_door', 404, `door=${door_code} did=${did}`);
  if (!door.active) return reject('door_inactive', 403, `door=${door_code}`);

  const published = await mqttService.publishProximity(door.mqtt_topic, {
    doorId: door.id,
    doorCode: door.door_code,
    level,
    levels: config.proximity.levels,
    rssi,
  });

  return { accepted: true, reason: 'ok', published, level, httpStatus: 200 };
}
