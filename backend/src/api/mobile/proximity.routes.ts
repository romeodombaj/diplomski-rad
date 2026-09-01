import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { proximityRateLimiter } from '../../middleware/rateLimiter';
import { ProximityReportSchema } from './proximity.schema';
import * as proximityController from './proximity.controller';

const router = Router();

/**
 * POST /mobile/proximity — move a door's LED ring. Cosmetic; opens nothing.
 *
 * Carries its own limiter, and `mobileRateLimiter` skips this path, so a phone
 * walking up to a door cannot spend the budget that /mobile/access needs. A
 * cosmetic feature must never be able to starve the functional one.
 */
router.post(
  '/proximity',
  proximityRateLimiter,
  validate(ProximityReportSchema),
  proximityController.reportProximity,
);

export default router;
