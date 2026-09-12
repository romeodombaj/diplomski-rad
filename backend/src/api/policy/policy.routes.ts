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

router.use(requireAuth);

router.get('/health', controller.health);
router.post('/sync', controller.sync);
router.post('/reconcile', controller.reconcile);
router.get('/drift', controller.listDrift);
router.post('/drift/:id/resolve', controller.resolveDrift);

router.get('/schedules', controller.listSchedules);
router.post('/schedules', validate(CreateScheduleSchema), controller.createSchedule);
router.delete('/schedules/:id', controller.deleteSchedule);

router.get('/groups', controller.listGroups);
router.post('/groups', validate(CreateGroupSchema), controller.createGroup);
router.get('/groups/:id', controller.getGroup);
router.patch('/groups/:id', validate(UpdateGroupSchema), controller.updateGroup);
router.put('/groups/:id/doors', validate(SetGroupDoorsSchema), controller.setGroupDoors);
router.delete('/groups/:id', controller.deleteGroup);

router.post('/grants', validate(GrantDirectSchema), controller.grantDirect);
router.post('/assignments', validate(AssignGroupSchema), controller.assignGroup);
router.delete('/assignments/:personId/:groupId', controller.unassignGroup);
router.post('/:id/revoke', controller.revoke);

export default router;
