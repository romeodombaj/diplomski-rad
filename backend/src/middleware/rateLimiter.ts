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

export const mobileRateLimiter = rateLimit({
  windowMs:        config.rateLimit.mobileWindowMs,
  max:             config.rateLimit.mobileMax,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip ?? 'unknown',
  message:         { success: false, message: 'Too many requests, please try again later.' },
  skip:            (req) => req.path === '/proximity',
});

export const proximityRateLimiter = rateLimit({
  windowMs:        config.rateLimit.proximityWindowMs,
  max:             config.rateLimit.proximityMax,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip ?? 'unknown',
  message:         { success: false, message: 'Too many requests, please try again later.' },
});
