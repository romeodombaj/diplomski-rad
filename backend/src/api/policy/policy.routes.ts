import { Router } from 'express';
import * as controller from './policy.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import {
  GrantDirectSchema,
  AssignGroupSchema,
  CreateGroupSchema,
  UpdateGroupSchema,
  SetGroupDoorsSchema,
  CreateScheduleSchema,
} from './policy.schema';

const router = Router();

// Everything here is operator-facing. The access path never reads these tables
// — it asks the chain — so nothing in this file is on the unlock hot path.
router.use(requireAuth);

// Sync health and reconciliation. `/reconcile` is the drift detector: it reads
// the chain, diffs it against the mirror, and flags policies that exist on
// chain with no authoring record behind them.
router.get('/health', controller.health);
router.post('/sync', controller.sync);
router.post('/reconcile', controller.reconcile);
router.get('/drift', controller.listDrift);
router.post('/drift/:id/resolve', controller.resolveDrift);

// Schedules — the recurring windows the chain cannot express.
router.get('/schedules', controller.listSchedules);
router.post('/schedules', validate(CreateScheduleSchema), controller.createSchedule);
router.delete('/schedules/:id', controller.deleteSchedule);

// Groups.
router.get('/groups', controller.listGroups);
router.post('/groups', validate(CreateGroupSchema), controller.createGroup);
router.get('/groups/:id', controller.getGroup);
router.patch('/groups/:id', validate(UpdateGroupSchema), controller.updateGroup);
router.put('/groups/:id/doors', validate(SetGroupDoorsSchema), controller.setGroupDoors);
router.delete('/groups/:id', controller.deleteGroup);

// Grants. Both return 202 — the row is queued, the chain write follows.
router.post('/grants', validate(GrantDirectSchema), controller.grantDirect);
router.post('/assignments', validate(AssignGroupSchema), controller.assignGroup);
router.delete('/assignments/:personId/:groupId', controller.unassignGroup);
router.post('/:id/revoke', controller.revoke);

export default router;
