import { Router } from 'express';
import verifyRoutes from './verify.routes';

const router = Router();

// Mount verify routes under /verify
router.use('/verify', verifyRoutes);

export default router;
