import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { ClaimEnrollmentSchema } from '../person/person.schema';
import * as personController from '../person/person.controller';

const router = Router();

// POST /mobile/enroll/claim — trades a one-time enrolment token for the TOTP
// secret. Unauthenticated by design: the token is the credential.
router.post('/enroll/claim', validate(ClaimEnrollmentSchema), personController.claimEnrollment);

export default router;
