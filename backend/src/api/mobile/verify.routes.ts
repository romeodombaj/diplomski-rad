import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { VerifySchema } from './verify.schema';
import * as controller from './verify.controller';

const router = Router();

// POST /mobile/verify/totp
router.post(
  '/verify/totp',
  validate(VerifySchema),
  controller.verifyTotp,
);

export default router;
