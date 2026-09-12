
import { Platform } from 'react-native';
import { apiFetch } from './apiFetch';
import { storage } from './storage';
import {
  getOrCreateIdentity,
  signAccessRequest,
  signProximityReport,
  hasIdentity,
  clearIdentity,
} from './identity';

export interface Door {
  door_code: string;
  name: string;
  id?: number;
  building_id?: number;
}

export interface Enrollment {
  did: string;
  secret: string;
  period: number;
  digits: number;
  buildingName: string;
  doors: Door[];
  chainRegistered: boolean;
}

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
}

export async function claimEnrollment(token: string): Promise<Enrollment> {
  const identity = await getOrCreateIdentity();

  const res = await apiFetch('/mobile/enroll/claim', {
    method: 'POST',
    body: JSON.stringify({
      token: token.trim(),
      did: identity.did,
      publicKey: identity.publicKey,
      deviceInfo: { platform: Platform.OS },
    }),
  });

  const json = await parse(res);
  if (!res.ok || !json?.data?.totp?.secret) {
    throw new Error(json?.message || `Enrolment failed (${res.status})`);
  }

  const d = json.data;
  const enrollment: Enrollment = {
    did: identity.did,
    secret: d.totp.secret,
    period: d.totp.period ?? 30,
    digits: d.totp.digits ?? 6,
    buildingName: d.building?.name ?? '',
    doors: d.doors ?? [],
    chainRegistered: Boolean(d.chain_registered),
  };

  await storage.setDid(enrollment.did);
  await storage.setTotpSecret(enrollment.secret);
  await storage.setTotpPeriod(String(enrollment.period));
  await storage.setTotpDigits(String(enrollment.digits));
  await storage.setDoors(JSON.stringify(enrollment.doors));
  await storage.setBuildingName(enrollment.buildingName);

  return enrollment;
}

export async function loadEnrollment(): Promise<Enrollment | null> {
  const [did, secret] = await Promise.all([storage.getDid(), storage.getTotpSecret()]);
  if (!did || !secret || !(await hasIdentity())) return null;

  const doorsRaw = await storage.getDoors();
  let doors: Door[] = [];
  try {
    doors = doorsRaw ? JSON.parse(doorsRaw) : [];
  } catch {
    doors = [];
  }

  return {
    did,
    secret,
    period: Number(await storage.getTotpPeriod()) || 30,
    digits: Number(await storage.getTotpDigits()) || 6,
    buildingName: (await storage.getBuildingName()) ?? '',
    doors,
    chainRegistered: false,
  };
}

export interface AccessResult {
  granted: boolean;
  reason: string;
  message: string;
  door?: { code: string; name: string };
  unlocked: boolean;
  chainChecked: boolean;
}

const REASON_TEXT: Record<string, string> = {
  stale_request: 'Request timed out — try again',
  replay: 'Already used — try again',
  unknown_did: 'This device is not enrolled',
  device_revoked: 'This device has been revoked',
  person_inactive: 'Your access is not active',
  unknown_door: 'Unknown door',
  door_inactive: 'This door is out of service',
  door_locked_down: 'This door is locked down',
  building_lockdown: 'The building is in emergency lockdown',
  door_not_in_scope: 'You do not have access to this location',
  no_public_key: 'Identity not registered — re-enrol',
  invalid_signature: 'Could not verify this device',
  invalid_totp: 'Code rejected — check the time on your phone',
  revoked_on_chain: 'This identity has been revoked',
  not_authorized: 'Not authorised for this door',
  face_missing: 'Face verification required',
  face_below_threshold: 'Face not recognised',
  chain_unavailable: 'Identity service unavailable — try again',
};

export async function requestAccess(
  doorCode: string,
  totp: string,
  faceScore?: number,
): Promise<AccessResult> {
  const signed = await signAccessRequest(doorCode);

  const res = await apiFetch('/mobile/access', {
    method: 'POST',
    body: JSON.stringify({ ...signed, totp, faceScore }),
  });

  const json = await parse(res);
  const data = json?.data ?? {};
  const reason: string = data.reason ?? 'unknown';

  return {
    granted: Boolean(data.granted),
    reason,
    message: data.granted
      ? data.message || 'Access granted'
      : REASON_TEXT[reason] || json?.message || data.message || 'Access denied',
    door: data.door,
    unlocked: Boolean(data.unlocked),
    chainChecked: Boolean(data.chain_checked),
  };
}

export async function reportProximity(
  doorCode: string,
  level: number,
  rssi: number,
): Promise<void> {
  try {
    const signed = await signProximityReport(doorCode, level);
    await apiFetch('/mobile/proximity', {
      method: 'POST',
      body: JSON.stringify({ ...signed, rssi: Math.round(rssi) }),
    });
  } catch {
  }
}

export async function resetEnrollment(): Promise<void> {
  await clearIdentity();
  await storage.clearEnrollment();
  await storage.deleteFaceEmbedding().catch(() => {});
}
