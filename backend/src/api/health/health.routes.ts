import { Router } from 'express'
import { getHealth, getStatus } from './health.controller'
import { requireAuth } from '../../middleware/auth'

const router = Router()

router.get('/', getHealth)

// Subsystem detail (chain addresses, signer, whether face is enforced and at
// what threshold) is operator-only — see the comments in the controller.
router.get('/status', requireAuth, getStatus)

export default router
