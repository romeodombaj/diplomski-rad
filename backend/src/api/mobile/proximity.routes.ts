import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { proximityRateLimiter } from '../../middleware/rateLimiter';
import { ProximityReportSchema } from './proximity.schema';
import * as proximityController from './proximity.controller';

const router = Router();

router.post(
  '/proximity',
  proximityRateLimiter,
  validate(ProximityReportSchema),
  proximityController.reportProximity,
);

export default router;
