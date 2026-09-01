import rateLimit from 'express-rate-limit';
import { config } from '../config/conifg';

export const rateLimiter = rateLimit({
  windowMs:        config.rateLimit.windowMs,
  max:             config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => (req.user as any)?.userId ?? req.ip ?? 'unknown',
  message:         { success: false, message: 'Too many requests, please try again later.' },
});

export const v1RateLimiter = rateLimit({
  windowMs:        config.rateLimit.windowMs,
  max:             config.rateLimit.v1Max,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => (req.user as any)?.buildingId ?? req.ip ?? 'unknown',
  message:         { success: false, message: 'Too many requests, please try again later.' },
});

export const authRateLimiter = rateLimit({
  windowMs:        config.rateLimit.authWindowMs,
  max:             config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip ?? 'unknown',
  message:         { success: false, message: 'Too many attempts, please try again later.' },
});

/**
 * The unauthenticated mobile surface (`/mobile/access`, `/mobile/enroll/claim`).
 *
 * `/mobile` had no limiter at all, and the access path records a denial *before*
 * any identity is established — so anyone who could reach the backend could
 * grow `access_events` without bound with random signatures, and could flood
 * one DID's history, which is the behaviour engine's declared training set.
 *
 * Keyed by IP because there is no session here by definition. The allowance is
 * generous enough for a person retrying a door and a whole office arriving at
 * once behind one NAT address, and small enough to make bulk stuffing useless.
 */
export const mobileRateLimiter = rateLimit({
  windowMs:        config.rateLimit.mobileWindowMs,
  max:             config.rateLimit.mobileMax,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip ?? 'unknown',
  message:         { success: false, message: 'Too many requests, please try again later.' },
  // Mounted at /mobile, so req.path is already relative to that. Proximity has
  // its own budget below: one person walking to a door legitimately sends a
  // report per LED step, and that must not consume the allowance that the
  // access path — the one that actually opens doors — depends on.
  skip:            (req) => req.path === '/proximity',
});

/**
 * Cosmetic LED proximity reports (`/mobile/proximity`).
 *
 * Generous, because the phone reports once per LED step of an approach and a
 * few people can arrive at once behind one NAT address; still bounded, because
 * the endpoint is unauthenticated at the transport layer and a flood would cost
 * MQTT publishes. Keyed by IP for the same reason as mobileRateLimiter: there
 * is no session here by definition.
 */
export const proximityRateLimiter = rateLimit({
  windowMs:        config.rateLimit.proximityWindowMs,
  max:             config.rateLimit.proximityMax,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip ?? 'unknown',
  message:         { success: false, message: 'Too many requests, please try again later.' },
});
