import { Router } from 'express';
import * as personController from './person.controller';
import * as policyController from '../policy/policy.controller';
import * as behaviorController from '../behavior/behavior.controller';
import { validate } from '../../middleware/validate';
import {
  CreatePersonSchema,
  UpdatePersonSchema,
  SuspendPersonSchema,
  OffboardPersonSchema,
  RevokeDeviceSchema,
} from './person.schema';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.get('/', requireAuth, personController.getAll);
router.get('/:id', requireAuth, personController.getById);
router.post('/', requireAuth, validate(CreatePersonSchema), personController.create);
router.patch('/:id', requireAuth, validate(UpdatePersonSchema), personController.update);
router.delete('/:id', requireAuth, personController.remove);

router.post('/:id/suspend', requireAuth, validate(SuspendPersonSchema), personController.suspend);
router.post('/:id/reinstate', requireAuth, personController.reinstate);
router.post('/:id/offboard', requireAuth, validate(OffboardPersonSchema), personController.offboard);

router.get('/:id/enrollment', requireAuth, personController.getEnrollment);
router.post('/:id/enrollment', requireAuth, personController.issueEnrollment);

router.get('/:id/effective-access', requireAuth, policyController.listForPerson);

router.get('/:id/groups', requireAuth, policyController.listGroupsForPerson);

router.get('/:id/behavior', requireAuth, behaviorController.getForPerson);
router.post('/:id/behavior/train', requireAuth, behaviorController.train);
router.post('/:id/behavior/seed', requireAuth, behaviorController.seed);

router.get('/:id/devices', requireAuth, personController.listDevices);
router.post('/:id/devices/:deviceId/revoke', requireAuth, validate(RevokeDeviceSchema), personController.revokeDevice);

export default router;
