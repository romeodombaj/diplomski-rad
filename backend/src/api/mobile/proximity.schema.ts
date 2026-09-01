import { z } from 'zod';

/**
 * A cosmetic proximity report: "the phone believes it is `level` steps close to
 * this door". It drives the LED ring on the door hardware and nothing else.
 *
 * It is signed by the same device key as an access request, so only an enrolled
 * phone can light a ring, but it is deliberately NOT the access contract — see
 * `proximityMessage` in proximity.service.ts for why the two signed strings can
 * never be mistaken for one another.
 */
export const ProximityReportSchema = z.object({
  did: z.string().trim().min(3).max(200),

  /** EIP-191 signature over `proximityMessage(...)` (65 bytes hex). */
  signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte hex signature'),

  door_code: z.string().trim().min(1).max(100),

  /**
   * How many LED steps to light, 0..config.proximity.levels. The phone buckets
   * its own RSSI and reports only when the bucket changes — the raw signal
   * updates ~10x a second and the ring has eight steps, so bucketing on the
   * device is what keeps this from becoming a flood.
   */
  level: z.number().int().min(0).max(64),

  /** The smoothed RSSI behind that bucket. Carried for calibration and logs. */
  rssi: z.number().int().min(-127).max(20),

  /** Unix seconds. Bounded by config.proximity.maxAgeSeconds. */
  timestamp: z.number().int().positive(),

  /**
   * Pipe-free by regex, and load-bearing for domain separation — see
   * `proximityMessage`.
   */
  nonce: z.string().trim().regex(/^[0-9a-fA-F]{16,64}$/, 'expected 8-32 hex bytes'),
});

export type ProximityReportInput = z.infer<typeof ProximityReportSchema>;
