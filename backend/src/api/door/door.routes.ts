import { Router } from 'express';
import * as doorController from './door.controller';
import * as policyController from '../policy/policy.controller';
import * as deviceController from '../device/device.controller';
import { validate } from '../../middleware/validate';
import { CreateDoorSchema, UpdateDoorSchema } from './door.schema';
import { requireAuth, requireAdmin } from '../../middleware/auth';

const router = Router();

router.get('/', requireAuth, doorController.getAll);
router.get('/:id', requireAuth, doorController.getById);

router.get('/:doorId/who-has-access', requireAuth, policyController.whoHasAccess);
router.get('/:doorId/devices', requireAuth, deviceController.listForDoor);

router.post('/:id/unlock', requireAuth, requireAdmin, doorController.unlock);

router.post('/', requireAuth, validate(CreateDoorSchema), doorController.create);
router.patch('/:id', requireAuth, validate(UpdateDoorSchema), doorController.update);
router.delete('/:id', requireAuth, doorController.remove);

export default router;
