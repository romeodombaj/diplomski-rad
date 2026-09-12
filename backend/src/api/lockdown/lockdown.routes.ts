import { Router } from 'express';
import * as lockdownController from './lockdown.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.get('/', requireAuth, lockdownController.getState);
router.post('/building', requireAuth, lockdownController.setBuilding);
router.post('/doors/:doorId', requireAuth, lockdownController.setDoor);

export default router;
