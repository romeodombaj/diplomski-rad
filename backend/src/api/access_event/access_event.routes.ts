import { Router } from 'express';
import * as controller from './access_event.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.get('/stats', requireAuth, controller.stats);
router.get('/:id', requireAuth, controller.getById);
router.get('/', requireAuth, controller.getAll);

export default router;
