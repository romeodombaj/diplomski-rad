import { Router } from 'express';
import * as dashboardController from './dashboard.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// One request for the whole landing page. Split endpoints would mean four
// round trips for four panels that are always shown together, and the query
// underneath is a single pass over one day of one building's events.
router.get('/overview', requireAuth, dashboardController.overview);

export default router;
