import { Router } from 'express';
import * as totp_secretController from './totp_secret.controller';
import { validate } from '../../middleware/validate';
import { CreateTotp_secretSchema, UpdateTotp_secretSchema } from './totp_secret.schema';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// GET /totp_secrets?field=value&page=1&limit=20
router.get('/', requireAuth, totp_secretController.getAll);
router.get('/:id', requireAuth, totp_secretController.getById);
router.post('/', requireAuth, validate(CreateTotp_secretSchema), totp_secretController.create);
router.patch('/:id', requireAuth, validate(UpdateTotp_secretSchema), totp_secretController.update);
router.delete('/:id', requireAuth, totp_secretController.remove);

export default router;
