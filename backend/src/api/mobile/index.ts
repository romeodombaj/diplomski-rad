import { Router } from 'express';
import verifyRoutes from './verify.routes';
import enrollRoutes from './enroll.routes';
import proximityRoutes from './proximity.routes';

const router = Router();

// Mounted at /mobile — routes define their full sub-paths
// (/mobile/access, /mobile/enroll/claim, /mobile/proximity)
router.use('/', verifyRoutes);
router.use('/', enrollRoutes);
router.use('/', proximityRoutes);

export default router;
