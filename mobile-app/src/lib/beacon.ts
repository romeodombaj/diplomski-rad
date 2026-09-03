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
// MEASURED on this install, walking the distance with the app open:
//
//   touching  -10      3 m  -56
//   1 m       -43      4 m  -65
//   2 m       -50      5 m  -70..-75
//
// Near enough to linear in distance over 1-5 m that a straight RSSI ramp gives
// an even spread of LEDs per metre. Re-measure after moving the board: walls,
// mounting height and which hand holds the phone all shift these.

/** 1 m — the whole ring is lit at this signal or stronger. */
export const RSSI_NEAR = -43;
/** 5 m — a single LED is lit here, the last step before dark. */
export const RSSI_FAR = -72;
/** Beyond about 5 m the ring goes out entirely. */
export const RSSI_DARK = -78;

/**
 * The gate, with hysteresis: the button appears at ENTER and only disappears
 * again at EXIT. Raw RSSI swings ±10 dB between frames even standing still, so
 * a single threshold makes the button flicker on and off in someone's hand.
 */
// The unlock button appears around 2-3 m, partway up the ramp, and only
// disappears again slightly further out so it cannot flicker at the boundary.
// The unlock button appears around 2-3 m, partway up the ramp, and only
// disappears again slightly further out so it cannot flicker at the boundary.
// The unlock button appears at roughly 2 m and only goes away again nearer 3 m,
// so it cannot flicker while somebody stands at the boundary.
export const RSSI_GATE_ENTER = -50;
export const RSSI_GATE_EXIT = -57;

/**
 * Steps in the door's LED ring — one per physical LED.
 *
 * Twelve because the ring has twelve. It was eight, which the door then
 * rescaled to twelve and left the intermediate positions uneven
 * (0,1,3,4,6,7,9,10,12). Must match `config.proximity.levels` in the backend,
 * which clamps to it.
 */
export const LED_LEVELS = 12;

/** Drop a door from the list this long after its last advertisement. */
export const BEACON_TTL_MS = 4000;

/**
 * How much history the median is taken over.
 *
 * Two seconds is long enough to ride out the deep fades BLE produces when a
 * body or a hand moves through the path, and short enough that the ring still
 * tracks someone walking at a normal pace.
 */
export const RSSI_WINDOW_MS = 2000;

/**
 * How many consecutive evaluations must agree before the LED count changes.
 *
 * The median alone still sits on a boundary occasionally and toggles between
 * two adjacent counts. Requiring the new level twice in a row costs a quarter
 * of a second and removes that flicker entirely.
 */
export const LEVEL_CONFIRM_TICKS = 2;

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

  // ── Our compact door frame (8 bytes) ──────────────────────────────────────
  //   FF FF   company id 0xFFFF (reserved for testing / no company)
  //   AC 01   marker: Access Control, format version 1
  //   major   buildings.id, big-endian
  //   minor   doors.id, big-endian
  //
  // This is what the door hardware actually broadcasts. ESPHome's
  // esp32_ble_beacon never transmitted — its start-advertising call is dropped
  // by an internal flag race — so the payload moved to esp32_ble_server's
  // manufacturer_data, which needs to fit alongside the name inside BLE's
  // 31-byte advertisement. See hardware/door-beacon/README.md.
  if (b.length >= 8 && b[0] === 0xff && b[1] === 0xff && b[2] === 0xac && b[3] === 0x01) {
    return {
      uuid: BEACON_UUID,
      major: (b[4] << 8) | b[5],
      minor: (b[6] << 8) | b[7],
      // Not carried: the ramp is calibrated against RSSI_NEAR/RSSI_FAR, which
      // have to be measured per install anyway.
      measuredPower: -59,
    };
  }

  // ── Standard iBeacon (25 bytes) ───────────────────────────────────────────
  // Still accepted, so a real iBeacon — a bought one, or ESPHome's component if
  // it is ever fixed — works without another app release.
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

export interface RssiSample {
  t: number;
  rssi: number;
}

/**
 * Median RSSI over the recent window, with samples older than it dropped.
 *
 * Median rather than mean on purpose. RSSI is not noisy in a well-behaved,
 * normally-distributed way — it takes sudden deep drops when something blocks
 * the path, and occasional constructive-interference spikes. A mean folds those
 * into the answer and the ring jumps; a median throws them away. This mutates
 * `samples`, trimming it in place, because it is called once per evaluation and
 * the caller owns the buffer.
 */
export function medianRssi(samples: RssiSample[], now: number): number | null {
  while (samples.length > 0 && now - samples[0].t > RSSI_WINDOW_MS) {
    samples.shift();
  }
  if (samples.length === 0) return null;

  const values = samples.map((s) => s.rssi).sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Smoothed RSSI → how many LED steps to light, 0..LED_LEVELS.
 *
 * Linear between the two calibration points. RSSI is logarithmic and distance
 * is not, so this is not a distance scale — it is a ramp that looks right as
 * someone walks up, which is all an LED ring has to be.
 */
export function rssiToLevel(rssi: number, levels: number = LED_LEVELS): number {
  // Out of range entirely: dark.
  if (rssi < RSSI_DARK) return 0;

  // Inside the ramp the floor is one LED, not zero — at 5 m the ring should
  // show a single light rather than nothing, so that "seen but far" and "not
  // seen at all" look different to somebody walking up.
  const span = RSSI_NEAR - RSSI_FAR;
  const ratio = (rssi - RSSI_FAR) / span;
  const level = 1 + Math.round(ratio * (levels - 1));
  return Math.max(1, Math.min(levels, level));
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
