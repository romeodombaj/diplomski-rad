import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { ClaimEnrollmentSchema } from '../person/person.schema';
import * as personController from '../person/person.controller';

const router = Router();

router.post('/enroll/claim', validate(ClaimEnrollmentSchema), personController.claimEnrollment);

export default router;
