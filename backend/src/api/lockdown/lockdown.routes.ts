import { Router } from 'express';
import * as lockdownController from './lockdown.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.get('/', requireAuth, lockdownController.getState);
/** Building-wide emergency. Body: { active: boolean } */
router.post('/building', requireAuth, lockdownController.setBuilding);
/** One door. Body: { locked_down: boolean } */
router.post('/doors/:doorId', requireAuth, lockdownController.setDoor);

export default router;
