import { Router } from 'express';
import * as dashboardController from './dashboard.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.get('/overview', requireAuth, dashboardController.overview);

export default router;
