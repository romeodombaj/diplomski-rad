import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { AccessRequestSchema } from './access.schema';
import * as accessController from './access.controller';

const router = Router();

// POST /mobile/access — signature + TOTP + face + door, checked against chain.
router.post('/access', validate(AccessRequestSchema), accessController.requestAccess);

export default router;
