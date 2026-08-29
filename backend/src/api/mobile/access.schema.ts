import { z } from 'zod';

/**
 * The access-request contract from sigurnosni-sustav-biometrija.md
 * §"Tijek autentifikacije" step 7: { DID, potpis, TOTP, lokacija, timestamp }.
 *
 * The endpoint this replaces took { did, code, faceScore? }. With no door in
 * the request, per-door authorisation was not merely unimplemented — it was
 * unrepresentable, and any enrolled device's code opened everything.
 */
export const AccessRequestSchema = z.object({
  did: z.string().trim().min(3).max(200),

  /**
   * EIP-191 signature over `${did}|${door_code}|${timestamp}|${nonce}`
   * (65 bytes hex).
   */
  signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte hex signature'),

  totp: z.string().length(6).regex(/^\d{6}$/),

  /** "lokacija" — which door. Resolved against the doors table. */
  door_code: z.string().trim().min(1).max(100),

  /** Unix seconds. Bounded by config.access.maxRequestAgeSeconds. */
  timestamp: z.number().int().positive(),

  /**
   * Per-request random value, so every request signs a distinct message.
   *
   * Without it the message is `did|door|timestamp` at one-second granularity,
   * and two genuine taps in the same second are byte-identical — indistinguish-
   * able from a replay, and the second one would be refused. The nonce makes
   * uniqueness a property of the request rather than of the clock.
   */
  nonce: z.string().trim().regex(/^[0-9a-fA-F]{16,64}$/, 'expected 8-32 hex bytes'),

  /** On-device cosine similarity from the Siamese model, 0..1. */
  faceScore: z.number().min(-1).max(1).optional(),
});

export type AccessRequestInput = z.infer<typeof AccessRequestSchema>;
