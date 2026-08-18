import { Router } from 'express';
import verifyRoutes from './verify.routes';

const router = Router();

// Mounted at /mobile — routes define their full sub-paths
// (/mobile/totp/enroll, /mobile/verify/totp)
router.use('/', verifyRoutes);

export default router;
