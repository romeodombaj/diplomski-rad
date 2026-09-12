import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import * as Crypto from 'expo-crypto';
import { storage } from './storage';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};

const utf8 = (s: string): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
};

function generatePrivateKey(): Uint8Array {
  for (let i = 0; i < 8; i++) {
    const candidate = Crypto.getRandomBytes(32);
    if (secp256k1.utils.isValidPrivateKey(candidate)) return candidate;
  }
  throw new Error('Could not generate a valid private key');
}

function addressFromPublicKey(publicKey: Uint8Array): string {
  return '0x' + toHex(keccak_256(publicKey.slice(1))).slice(-40);
}

export interface DeviceIdentity {
  did: string;
  publicKey: string;
  address: string;
}

let cached: DeviceIdentity | null = null;

async function loadPrivateKey(): Promise<Uint8Array | null> {
  const hex = await storage.getPrivateKey();
  return hex ? fromHex(hex) : null;
}

export async function getOrCreateIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached;

  let priv = await loadPrivateKey();
  if (!priv) {
    priv = generatePrivateKey();
    await storage.setPrivateKey(toHex(priv));
  }

  const pub = secp256k1.getPublicKey(priv, false);
  const address = addressFromPublicKey(pub);

  cached = { did: `did:ethr:sep:${address}`, publicKey: '0x' + toHex(pub), address };
  return cached;
}

export async function hasIdentity(): Promise<boolean> {
  return (await storage.getPrivateKey()) !== null;
}

async function signPersonalMessage(message: string): Promise<string> {
  const priv = await loadPrivateKey();
  if (!priv) throw new Error('No device key — enrol first');

  const body = utf8(message);
  const prefix = utf8(`\x19Ethereum Signed Message:\n${body.length}`);
  const payload = new Uint8Array(prefix.length + body.length);
  payload.set(prefix, 0);
  payload.set(body, prefix.length);

  const sig = secp256k1.sign(keccak_256(payload), priv);
  return '0x' + sig.toCompactHex() + (sig.recovery + 27).toString(16).padStart(2, '0');
}

export function newNonce(): string {
  return toHex(Crypto.getRandomBytes(16));
}

export interface SignedAccessRequest {
  did: string;
  door_code: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export async function signAccessRequest(doorCode: string): Promise<SignedAccessRequest> {
  const { did } = await getOrCreateIdentity();
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = newNonce();
  const signature = await signPersonalMessage(`${did}|${doorCode}|${timestamp}|${nonce}`);
  return { did, door_code: doorCode, timestamp, nonce, signature };
}

export interface SignedProximityReport {
  did: string;
  door_code: string;
  level: number;
  timestamp: number;
  nonce: string;
  signature: string;
}

export async function signProximityReport(
  doorCode: string,
  level: number,
): Promise<SignedProximityReport> {
  const { did } = await getOrCreateIdentity();
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = newNonce();
  const signature = await signPersonalMessage(
    `proximity|${did}|${doorCode}|${timestamp}|${nonce}|${level}`,
  );
  return { did, door_code: doorCode, level, timestamp, nonce, signature };
}

export async function clearIdentity(): Promise<void> {
  cached = null;
  await storage.deletePrivateKey();
}
