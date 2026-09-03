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

// Lifecycle — each transition is its own endpoint rather than a PATCH on status,
// so intent is explicit and separately authorisable.
router.post('/:id/suspend', requireAuth, validate(SuspendPersonSchema), personController.suspend);
router.post('/:id/reinstate', requireAuth, personController.reinstate);
router.post('/:id/offboard', requireAuth, validate(OffboardPersonSchema), personController.offboard);

// Enrolment
router.get('/:id/enrollment', requireAuth, personController.getEnrollment);
router.post('/:id/enrollment', requireAuth, personController.issueEnrollment);

// What can this person open, and via which group or direct grant. Provenance
// is the point: "can open the server room" is useless without "via Engineering".
router.get('/:id/effective-access', requireAuth, policyController.listForPerson);

// Behaviour — the anomaly engine's view of this person, delegated the same way
// as effective-access above. It is not part of the person record, but it is
// where an operator looks for it.
router.get('/:id/behavior', requireAuth, behaviorController.getForPerson);
router.post('/:id/behavior/train', requireAuth, behaviorController.train);
router.post('/:id/behavior/seed', requireAuth, behaviorController.seed);

// Devices
router.get('/:id/devices', requireAuth, personController.listDevices);
router.post('/:id/devices/:deviceId/revoke', requireAuth, validate(RevokeDeviceSchema), personController.revokeDevice);

export default router;
