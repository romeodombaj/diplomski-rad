import { Router } from 'express';
import * as controller from './access_event.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// The access log is append-only — there is deliberately no PUT or DELETE here.
// The on-chain AuditLog carries the hash of every one of these rows, so an
// operator quietly editing history is exactly what the design rules out.
router.get('/stats', requireAuth, controller.stats);
router.get('/:id', requireAuth, controller.getById);
router.get('/', requireAuth, controller.getAll);

export default router;
