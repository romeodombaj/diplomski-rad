import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import * as controller from './auth.controller';

const router = Router();

router.post('/login',          controller.login);
router.post('/register',       controller.register);
router.post('/google',         controller.google);
router.post('/refresh',        controller.refresh);
router.post('/logout',         controller.logout);
router.post('/totp-login',     controller.totpLogin);
router.post('/totp-verify',    controller.totpVerify);
router.get('/me',               requireAuth, controller.me);
router.patch('/me',             requireAuth, controller.updateProfile);
router.post('/set-password',    requireAuth, controller.setPassword);
router.post('/change-password', requireAuth, controller.changePassword);
router.post('/connect-google',  requireAuth, controller.connectGoogle);
router.post('/switch-building', requireAuth, controller.switchBuilding);
router.get('/buildings',        requireAuth, controller.listBuildings);
router.post('/buildings',       requireAuth, controller.createBuilding);
router.patch('/buildings/:id',  requireAuth, controller.renameBuilding);
router.delete('/buildings/:id', requireAuth, controller.deleteBuilding);

router.get('/users',                  requireAuth, requireAdmin, controller.listUsers);
router.post('/users',                 requireAuth, requireAdmin, controller.createUser);
router.patch('/users/:id',            requireAuth, requireAdmin, controller.updateUser);
router.delete('/users/:id',           requireAuth, requireAdmin, controller.deleteUser);
router.get('/users/:id/buildings',    requireAuth, requireAdmin, controller.getUserBuildings);
router.put('/users/:id/buildings',    requireAuth, requireAdmin, controller.setUserBuildings);

export default router;
