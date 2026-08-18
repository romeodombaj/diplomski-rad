import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { EnrollSchema, VerifySchema } from './verify.schema';
import * as controller from './verify.controller';

const router = Router();

// POST /mobile/totp/enroll
router.post('/totp/enroll', validate(EnrollSchema), controller.enrollTotp);

// POST /mobile/verify/totp
router.post('/verify/totp', validate(VerifySchema), controller.verifyTotp);

export default router;
