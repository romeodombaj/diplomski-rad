import { Router } from 'express';
import * as totpController from './totp.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// POST /api/totp/verify
router.post('/verify', requireAuth, totpController.verifyTOTP);

export default router;
