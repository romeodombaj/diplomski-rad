import { Router } from 'express';
import * as deviceController from './device.controller';
import { validate } from '../../middleware/validate';
import { CreateDeviceSchema, UpdateDeviceSchema, ScanSchema } from './device.schema';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// Before /:id, or "scan" is parsed as a device id.
router.post('/scan', requireAuth, validate(ScanSchema), deviceController.scan);

router.get('/', requireAuth, deviceController.getAll);
router.get('/:id', requireAuth, deviceController.getById);
router.post('/', requireAuth, validate(CreateDeviceSchema), deviceController.create);
router.patch('/:id', requireAuth, validate(UpdateDeviceSchema), deviceController.update);
router.delete('/:id', requireAuth, deviceController.remove);

export default router;
