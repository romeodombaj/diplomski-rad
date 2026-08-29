/**
 * Enrolment and the access request.
 *
 * WHAT CHANGED AND WHY: this module used to auto-enrol on first launch by
 * POSTing a self-minted DID to `/mobile/totp/enroll`, an unauthenticated route
 * that handed a working TOTP secret to anyone who asked. Any device that could
 * reach the backend could mint itself a credential.
 *
 * Enrolment now requires a one-time token issued by an operator from the
 * dashboard (the QR on the person's record). The token is the credential; it is
 * single-use, hashed at rest, and expires. Nothing is minted without it.
 */

import { apiFetch } from './apiFetch';
import { storage } from './storage';
import { getOrCreateIdentity, signAccessRequest, hasIdentity, clearIdentity } from './identity';

export interface Door {
  door_code: string;
  name: string;
}

export interface Enrollment {
  did: string;
  secret: string;
  period: number;
  digits: number;
  buildingName: string;
  doors: Door[];
  /** False when the DID exists only in the backend's database, not on-chain. */
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

/**
 * Trade an operator-issued enrolment token for this building's TOTP secret,
 * binding this device's public key to the person's record.
 */
export async function claimEnrollment(token: string): Promise<Enrollment> {
  const identity = await getOrCreateIdentity();

  const res = await apiFetch('/mobile/enroll/claim', {
    method: 'POST',
    body: JSON.stringify({
      token: token.trim(),
      did: identity.did,
      publicKey: identity.publicKey,
      deviceInfo: { platform: 'ios' },
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

/** The cached enrolment, or null when this device has never been enrolled. */
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

/** Denial reasons rendered as something a person standing at a door can act on. */
const REASON_TEXT: Record<string, string> = {
  stale_request: 'Request timed out — try again',
  replay: 'Already used — try again',
  unknown_did: 'This device is not enrolled',
  device_revoked: 'This device has been revoked',
  person_inactive: 'Your access is not active',
  unknown_door: 'Unknown door',
  door_inactive: 'This door is out of service',
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

/**
 * Sign and send an access request for one door.
 *
 * `faceScore` is the on-device Siamese similarity. The backend re-checks it
 * against its own threshold rather than trusting the client's own gate — a
 * modified app could send anything, so the client-side check is UX and the
 * server-side one is the control.
 */
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

/**
 * Wipe the identity so the device can enrol again with a fresh token.
 *
 * `clearIdentity()` is essential, not decorative: identity.ts memoises the
 * derived DID and public key in a module-level cache. Clearing storage alone
 * leaves that cache populated, so the next enrolment would bind the OLD DID and
 * public key while the matching private key is gone — consuming the single-use
 * token to mint a credential that can never sign.
 */
export async function resetEnrollment(): Promise<void> {
  await clearIdentity();
  await storage.clearEnrollment();
  await storage.deleteFaceEmbedding().catch(() => {});
}
