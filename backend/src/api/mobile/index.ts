import { Router } from 'express';
import verifyRoutes from './verify.routes';
import enrollRoutes from './enroll.routes';
import proximityRoutes from './proximity.routes';

const router = Router();

router.use('/', verifyRoutes);
router.use('/', enrollRoutes);
router.use('/', proximityRoutes);

export default router;
