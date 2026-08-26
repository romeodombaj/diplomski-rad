import { Router } from 'express';
import verifyRoutes from './verify.routes';
import enrollRoutes from './enroll.routes';

const router = Router();

// Mounted at /mobile — routes define their full sub-paths
// (/mobile/totp/enroll, /mobile/verify/totp, /mobile/enroll/claim)
router.use('/', verifyRoutes);
router.use('/', enrollRoutes);

export default router;
