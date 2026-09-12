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
  logger.debug(`[proximity] rejected ${reason} — ${detail}`);
  return { accepted: false, reason, published: false, level: 0, httpStatus };
};

export async function report(input: ProximityReportInput): Promise<ProximityResult> {
  const { did, signature, door_code, timestamp, nonce, rssi } = input;

  const level = Math.min(input.level, config.proximity.levels);

  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - timestamp;
  if (age > config.proximity.maxAgeSeconds || age < -config.proximity.maxClockSkewSeconds) {
    return reject('stale_report', 400, `age=${age}s did=${did}`);
  }

  const device = await db('person_devices').where({ did }).orderBy('id', 'desc').first();
  if (!device) return reject('unknown_did', 404, `did=${did}`);
  if (device.revoked_at) return reject('device_revoked', 403, `did=${did}`);

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

  const person = await db('people').where({ id: device.person_id }).whereNull('deleted_at').first();
  if (!person) return reject('unknown_did', 404, `did=${did}`);
  if (person.status !== 'active') return reject('person_inactive', 403, `did=${did}`);

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
