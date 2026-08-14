import { Router } from 'express';
import * as verifyController from './verify.controller';
import { validate } from '../../middleware/validate';
import { VerifyAccessSchema } from './verify.schema';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// POST /api/verify/access
router.post(
  '/access',
  requireAuth,
  validate(VerifyAccessSchema),
  verifyController.verifyAccess,
);

export default router;
