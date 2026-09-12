import { Router } from 'express'
import { getHealth, getStatus } from './health.controller'
import { requireAuth } from '../../middleware/auth'

const router = Router()

router.get('/', getHealth)

router.get('/status', requireAuth, getStatus)

export default router
