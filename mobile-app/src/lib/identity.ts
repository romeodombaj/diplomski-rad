/**
 * The device's cryptographic identity.
 *
 * This is the "kriptografski identitet" pillar of the spec
 * (sigurnosni-sustav-biometrija.md §1) and it did not exist before: the DID was
 * a `Math.random()` hex string with no key behind it, so the phone could not
 * sign anything and the backend had nothing to verify. A stolen DID string was
 * a complete identity.
 *
 * Now the phone generates a real secp256k1 keypair. The private key is written
 * to SecureStore (Keychain on iOS, Keystore on Android) and never leaves the
 * device — the backend only ever sees the public key, at enrolment, and the
 * signatures it produces.
 *
 * Pure-JS on purpose: @noble runs under Hermes without a native module, so this
 * works in Expo Go as well as a dev build. Randomness comes from expo-crypto,
 * which is a real CSPRNG — `Math.random()` is not, and using it to mint a key
 * would make every identity guessable.
 */
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
  // TextEncoder is not guaranteed under Hermes; this is the same encoding.
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

/** A private key must be a scalar in [1, n-1]; retry on the astronomically rare miss. */
function generatePrivateKey(): Uint8Array {
  for (let i = 0; i < 8; i++) {
    const candidate = Crypto.getRandomBytes(32);
    if (secp256k1.utils.isValidPrivateKey(candidate)) return candidate;
  }
  throw new Error('Could not generate a valid private key');
}

/** Ethereum address: last 20 bytes of keccak256 over the uncompressed key body. */
function addressFromPublicKey(publicKey: Uint8Array): string {
  return '0x' + toHex(keccak_256(publicKey.slice(1))).slice(-40);
}

export interface DeviceIdentity {
  /** `did:ethr:sep:0x…` — the address, so the DID and the key cannot disagree. */
  did: string;
  /** Uncompressed SEC1 point (0x04 || X || Y). What DIDRegistry stores. */
  publicKey: string;
  address: string;
}

let cached: DeviceIdentity | null = null;

async function loadPrivateKey(): Promise<Uint8Array | null> {
  const hex = await storage.getPrivateKey();
  return hex ? fromHex(hex) : null;
}

/**
 * The device identity, minting one on first call.
 *
 * Deriving the DID from the public key is what makes the pair unforgeable as a
 * unit: anyone can claim a DID string, but only the holder of the matching
 * private key can sign for it, and the address in the DID is checkable against
 * the key the registry holds.
 */
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

/**
 * Sign a string the way `personal_sign` does (EIP-191), because that is what
 * the backend's `ethers.verifyMessage` and the contracts' recovery expect.
 */
async function signPersonalMessage(message: string): Promise<string> {
  const priv = await loadPrivateKey();
  if (!priv) throw new Error('No device key — enrol first');

  const body = utf8(message);
  const prefix = utf8(`\x19Ethereum Signed Message:\n${body.length}`);
  const payload = new Uint8Array(prefix.length + body.length);
  payload.set(prefix, 0);
  payload.set(body, prefix.length);

  const sig = secp256k1.sign(keccak_256(payload), priv);
  // r || s || v, with v as the 27-based recovery id Ethereum tooling expects.
  return '0x' + sig.toCompactHex() + (sig.recovery + 27).toString(16).padStart(2, '0');
}

/** Per-request randomness, so two taps in the same second are distinct requests. */
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

/**
 * Sign an access request for one door.
 *
 * The message format must stay byte-identical to `accessMessage` in
 * backend/src/api/mobile/access.service.ts — the backend recovers the signer
 * from exactly this string, so any drift reads as a forged signature.
 */
export async function signAccessRequest(doorCode: string): Promise<SignedAccessRequest> {
  const { did } = await getOrCreateIdentity();
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = newNonce();
  const signature = await signPersonalMessage(`${did}|${doorCode}|${timestamp}|${nonce}`);
  return { did, door_code: doorCode, timestamp, nonce, signature };
}

/** Wipe the keypair. The old DID can never be re-derived — that is the point. */
export async function clearIdentity(): Promise<void> {
  cached = null;
  await storage.deletePrivateKey();
}
