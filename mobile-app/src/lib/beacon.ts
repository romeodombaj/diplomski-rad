/**
 * iBeacon frame parsing and RSSI smoothing.
 *
 * The door hardware (hardware/door-beacon/door-beacon.yaml) advertises an
 * iBeacon carrying `major = buildings.id` and `minor = doors.id`. The phone
 * maps that pair back to a `door_code` using the door list it received at
 * enrolment — which is why `claimEnrollment` returns `id` and `building_id`.
 *
 * Nothing here is a security boundary. Per hardware/door-beacon/README.md a
 * beacon carries no secret and anyone can forge one; all this decides is which
 * door the UI offers. The real checks happen server-side.
 */

/** Must match `uuid:` in door-beacon.yaml. Lower-case, no dashes. */
export const BEACON_UUID = '8f1d2a604c3b4e919a772b5c6d8e0f13';

/**
 * CALIBRATE THESE PER INSTALL — see the "Calibration" section of
 * hardware/door-beacon/README.md. Do not compute them from a path-loss formula;
 * walls, door frames and mounting height dominate.
 *
 * `NEAR` is the reading with the phone against the door (full ring), `FAR` the
 * reading where the ring should just light up at all.
 */
export const RSSI_NEAR = -52;
export const RSSI_FAR = -88;

/**
 * The gate, with hysteresis: the button appears at ENTER and only disappears
 * again at EXIT. Raw RSSI swings ±10 dB between frames even standing still, so
 * a single threshold makes the button flicker on and off in someone's hand.
 */
export const RSSI_GATE_ENTER = -68;
export const RSSI_GATE_EXIT = -76;

/** Steps in the door's LED ring. Must match `config.proximity.levels`. */
export const LED_LEVELS = 8;

/** Drop a door from the list this long after its last advertisement. */
export const BEACON_TTL_MS = 4000;

/**
 * Smoothing factor for the RSSI moving average. Lower is steadier but slower to
 * react; 0.25 settles within about a second at a 10 Hz advertising rate, which
 * is faster than a person walks.
 */
const EMA_ALPHA = 0.25;

export interface IBeaconFrame {
  uuid: string;
  /** `buildings.id` */
  major: number;
  /** `doors.id` */
  minor: number;
  /** The beacon's own claimed RSSI at 1 m. Advisory; we calibrate instead. */
  measuredPower: number;
}

/**
 * Base64 → bytes, written out rather than using `atob`.
 *
 * Hermes has shipped `atob` for a while, but identity.ts already treats
 * TextEncoder as not-guaranteed on this runtime and this is ten lines. A silent
 * failure here would look like "the beacon does not work on that phone".
 */
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

/**
 * Parse an iBeacon out of a BLE advertisement's manufacturer-specific data.
 *
 * react-native-ble-plx hands this over base64-encoded and INCLUDING the two
 * company-ID bytes, so the layout is:
 *
 *   0..1   4C 00        Apple, little-endian
 *   2..3   02 15        iBeacon type, 21 bytes to follow
 *   4..19  UUID         16 bytes
 *   20..21 major        big-endian
 *   22..23 minor        big-endian
 *   24     measured power, signed
 *
 * Returns null for anything that is not an iBeacon — which is most of what a
 * scan sees.
 */
export function parseIBeacon(manufacturerData: string | null | undefined): IBeaconFrame | null {
  if (!manufacturerData) return null;
  const b = fromBase64(manufacturerData);
  if (b.length < 25) return null;
  if (b[0] !== 0x4c || b[1] !== 0x00) return null;
  if (b[2] !== 0x02 || b[3] !== 0x15) return null;

  return {
    uuid: hex(b.subarray(4, 20)),
    major: (b[20] << 8) | b[21],
    minor: (b[22] << 8) | b[23],
    // A byte over 127 is a negative dBm in two's complement.
    measuredPower: b[24] > 127 ? b[24] - 256 : b[24],
  };
}

/** One step of an exponential moving average over RSSI. */
export function smoothRssi(previous: number | null, sample: number): number {
  if (previous === null) return sample;
  return previous + EMA_ALPHA * (sample - previous);
}

/**
 * Smoothed RSSI → how many LED steps to light, 0..LED_LEVELS.
 *
 * Linear between the two calibration points. RSSI is logarithmic and distance
 * is not, so this is not a distance scale — it is a ramp that looks right as
 * someone walks up, which is all an LED ring has to be.
 */
export function rssiToLevel(rssi: number, levels: number = LED_LEVELS): number {
  const span = RSSI_NEAR - RSSI_FAR;
  const ratio = (rssi - RSSI_FAR) / span;
  return Math.max(0, Math.min(levels, Math.round(ratio * levels)));
}

/**
 * Whether the unlock button should be offered, given the previous answer.
 *
 * Passing the previous state in is what makes this hysteresis rather than a
 * threshold — see RSSI_GATE_ENTER / RSSI_GATE_EXIT.
 */
export function isWithinGate(rssi: number, wasWithin: boolean): boolean {
  return wasWithin ? rssi > RSSI_GATE_EXIT : rssi >= RSSI_GATE_ENTER;
}
