/**
 * Device identity + TOTP enrollment.
 *
 * The phone is the identity: it owns a DID and an on-device TOTP secret.
 * On first run we mint a DID and enroll it with the backend, which returns
 * the shared secret. From then on the app generates codes locally.
 */

import { apiFetch } from './apiFetch';
import { storage } from './storage';

export interface Enrollment {
  did: string;
  secret: string;
  period: number;
  digits: number;
}

function randomHex(len: number): string {
  let out = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** Get the device DID, creating (and persisting) one if it doesn't exist. */
export async function getOrCreateDid(): Promise<string> {
  let did = await storage.getDid();
  if (!did) {
    did = `did:demo:${randomHex(32)}`;
    await storage.setDid(did);
  }
  return did;
}

/** Enroll the current DID with the backend and cache the secret. */
export async function enroll(did: string): Promise<Enrollment> {
  const res = await apiFetch('/mobile/totp/enroll', {
    method: 'POST',
    body: JSON.stringify({ did }),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok || !json?.data?.secret) {
    throw new Error(json?.message || `Enrollment failed (${res.status})`);
  }
  const data = json.data as Enrollment;
  await storage.setTotpSecret(data.secret);
  await storage.setTotpPeriod(String(data.period));
  await storage.setTotpDigits(String(data.digits));
  return data;
}

/**
 * Return a ready-to-use enrollment, enrolling with the backend if the device
 * doesn't have a cached secret yet.
 */
export async function ensureEnrolled(): Promise<Enrollment> {
  const did = await getOrCreateDid();
  const secret = await storage.getTotpSecret();
  if (secret) {
    return {
      did,
      secret,
      period: Number(await storage.getTotpPeriod()) || 30,
      digits: Number(await storage.getTotpDigits()) || 6,
    };
  }
  return enroll(did);
}

/** Wipe the local identity and enroll a brand-new DID. */
export async function reEnroll(): Promise<Enrollment> {
  await storage.clearEnrollment();
  const did = await getOrCreateDid();
  return enroll(did);
}
