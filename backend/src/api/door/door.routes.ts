import { Router } from 'express';
import * as doorController from './door.controller';
import { validate } from '../../middleware/validate';
import { CreateDoorSchema, UpdateDoorSchema } from './door.schema';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// GET /doors?field=value&page=1&limit=20
router.get('/', requireAuth, doorController.getAll);
router.get('/:id', requireAuth, doorController.getById);
router.post('/', requireAuth, validate(CreateDoorSchema), doorController.create);
router.patch('/:id', requireAuth, validate(UpdateDoorSchema), doorController.update);
router.delete('/:id', requireAuth, doorController.remove);

export default router;
