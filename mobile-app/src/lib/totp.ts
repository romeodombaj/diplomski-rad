/**
 * Self-contained TOTP (RFC 6238) generator — pure JS, no native modules.
 *
 * Runs anywhere (Expo Go / Hermes) because it implements SHA-1, HMAC and
 * base32 decoding by hand instead of relying on Web/Node crypto. The backend
 * generates the shared secret (speakeasy, base32) and the app generates the
 * matching 6-digit code locally so the biometric-gated code never has to be
 * fetched from the server.
 *
 * Defaults (SHA-1, 6 digits, 30s period) match the backend's speakeasy config.
 */

// --- SHA-1 -----------------------------------------------------------------

function rotl(n: number, s: number): number {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}

/** SHA-1 of a byte array, returns 20 bytes. */
function sha1(bytes: number[]): number[] {
  const ml = bytes.length * 8;
  const msg = bytes.slice();

  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  // 64-bit big-endian length (message length fits well within 32 bits here)
  for (let i = 0; i < 4; i++) msg.push(0);
  msg.push((ml >>> 24) & 0xff, (ml >>> 16) & 0xff, (ml >>> 8) & 0xff, ml & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Array<number>(80);

  for (let chunk = 0; chunk < msg.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((msg[chunk + i * 4] << 24) |
          (msg[chunk + i * 4 + 1] << 16) |
          (msg[chunk + i * 4 + 2] << 8) |
          msg[chunk + i * 4 + 3]) >>>
        0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out: number[] = [];
  for (const h of [h0, h1, h2, h3, h4]) {
    out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  }
  return out;
}

// --- HMAC-SHA1 -------------------------------------------------------------

function hmacSha1(key: number[], message: number[]): number[] {
  const blockSize = 64;
  let k = key.slice();
  if (k.length > blockSize) k = sha1(k);
  while (k.length < blockSize) k.push(0);

  const oKeyPad = k.map((b) => b ^ 0x5c);
  const iKeyPad = k.map((b) => b ^ 0x36);

  const inner = sha1(iKeyPad.concat(message));
  return sha1(oKeyPad.concat(inner));
}

// --- base32 (RFC 4648) -----------------------------------------------------

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): number[] {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip stray chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return out;
}

// --- TOTP ------------------------------------------------------------------

export interface TotpConfig {
  secret: string; // base32
  period?: number;
  digits?: number;
}

/** Generate the TOTP code for a given unix time (seconds). */
export function totpAt(cfg: TotpConfig, unixSeconds: number): string {
  const period = cfg.period ?? 30;
  const digits = cfg.digits ?? 6;
  const key = base32Decode(cfg.secret);

  let counter = Math.floor(unixSeconds / period);
  // 8-byte big-endian counter
  const counterBytes = new Array<number>(8).fill(0);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const hmac = hmacSha1(key, counterBytes);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/** Current TOTP code. */
export function totpNow(cfg: TotpConfig): string {
  return totpAt(cfg, Math.floor(Date.now() / 1000));
}

/** Seconds remaining before the current code rolls over. */
export function secondsRemaining(period = 30): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}
