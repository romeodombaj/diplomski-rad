import { Router } from 'express';
import * as buildingController from './building.controller';
import { validate } from '../../middleware/validate';
import { CreateBuildingSchema, UpdateBuildingSchema } from './building.schema';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// GET /buildings?field=value&page=1&limit=20
router.get('/', requireAuth, buildingController.getAll);
router.get('/:id', requireAuth, buildingController.getById);
router.post('/', requireAuth, validate(CreateBuildingSchema), buildingController.create);
router.patch('/:id', requireAuth, validate(UpdateBuildingSchema), buildingController.update);
router.delete('/:id', requireAuth, buildingController.remove);

export default router;
