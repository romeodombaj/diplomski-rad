import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { AccessRequestSchema } from './access.schema';
import * as accessController from './access.controller';

const router = Router();

router.post('/access', validate(AccessRequestSchema), accessController.requestAccess);

export default router;
