
export const BEACON_UUID = '8f1d2a604c3b4e919a772b5c6d8e0f13';


export const RSSI_NEAR = -43;
export const RSSI_FAR = -72;
export const RSSI_DARK = -78;

export const RSSI_GATE_ENTER = -50;
export const RSSI_GATE_EXIT = -57;

export const LED_LEVELS = 12;

export const BEACON_TTL_MS = 4000;

export const RSSI_WINDOW_MS = 2000;

export const LEVEL_CONFIRM_TICKS = 2;

export interface IBeaconFrame {
  uuid: string;
  major: number;
  minor: number;
  measuredPower: number;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function fromBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function parseIBeacon(manufacturerData: string | null | undefined): IBeaconFrame | null {
  if (!manufacturerData) return null;
  const b = fromBase64(manufacturerData);

  if (b.length >= 8 && b[0] === 0xff && b[1] === 0xff && b[2] === 0xac && b[3] === 0x01) {
    return {
      uuid: BEACON_UUID,
      major: (b[4] << 8) | b[5],
      minor: (b[6] << 8) | b[7],
      measuredPower: -59,
    };
  }

  if (b.length < 25) return null;
  if (b[0] !== 0x4c || b[1] !== 0x00) return null;
  if (b[2] !== 0x02 || b[3] !== 0x15) return null;

  return {
    uuid: hex(b.subarray(4, 20)),
    major: (b[20] << 8) | b[21],
    minor: (b[22] << 8) | b[23],
    measuredPower: b[24] > 127 ? b[24] - 256 : b[24],
  };
}

export interface RssiSample {
  t: number;
  rssi: number;
}

export function medianRssi(samples: RssiSample[], now: number): number | null {
  while (samples.length > 0 && now - samples[0].t > RSSI_WINDOW_MS) {
    samples.shift();
  }
  if (samples.length === 0) return null;

  const values = samples.map((s) => s.rssi).sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function rssiToLevel(rssi: number, levels: number = LED_LEVELS): number {
  if (rssi < RSSI_DARK) return 0;

  const span = RSSI_NEAR - RSSI_FAR;
  const ratio = (rssi - RSSI_FAR) / span;
  const level = 1 + Math.round(ratio * (levels - 1));
  return Math.max(1, Math.min(levels, level));
}

export function isWithinGate(rssi: number, wasWithin: boolean): boolean {
  return wasWithin ? rssi > RSSI_GATE_EXIT : rssi >= RSSI_GATE_ENTER;
}
