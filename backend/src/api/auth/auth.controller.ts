import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/errorHandler';
import * as authService from './auth.service';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { user, accessToken, refreshToken } = await authService.login(req.body);
    authService.setAuthCookies(res, accessToken, refreshToken);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { user, accessToken, refreshToken } = await authService.register(req.body);
    authService.setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) { next(new AppError('No refresh token', 401)); return; }
    const { accessToken, refreshToken } = await authService.refresh(token);
    authService.setAuthCookies(res, accessToken, refreshToken);
    res.json({ ok: true });
  } catch (err) {
    authService.clearAuthCookies(res);
    next(err);
  }
}

export async function google(req: Request, res: Response, next: NextFunction) {
  try {
    const { access_token } = req.body;
    if (!access_token) { next(new AppError('Missing access_token', 400)); return; }
    const { user, accessToken, refreshToken } = await authService.googleAuth(access_token);
    authService.setAuthCookies(res, accessToken, refreshToken);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response) {
  authService.clearAuthCookies(res);
  res.json({ ok: true });
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.me(req.user.userId!, req.user.tenantId);
    res.json({ ...result, projectId: req.user.projectId, isSandbox: req.user.isSandbox ?? false });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) { next(new AppError('Name is required', 400)); return; }
    await authService.updateProfile(req.user.userId!, name.trim());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function setPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) { next(new AppError('Password must be at least 6 characters', 400)); return; }
    await authService.setPassword(req.user.userId!, req.user.userId!, password);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword) { next(new AppError('Current password is required', 400)); return; }
    if (!newPassword || newPassword.length < 6) { next(new AppError('New password must be at least 6 characters', 400)); return; }
    await authService.changePassword(req.user.userId!, req.user.userId!, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function connectGoogle(req: Request, res: Response, next: NextFunction) {
  try {
    const { access_token } = req.body;
    if (!access_token) { next(new AppError('Missing access_token', 400)); return; }
    await authService.connectGoogle(req.user.userId!, access_token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function switchProject(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.body;
    if (!projectId) { next(new AppError('projectId is required', 400)); return; }
    const { accessToken, refreshToken } = await authService.switchProject(req.user.userId!, req.user.tenantId, projectId, req.user.role ?? 'user');
    authService.setAuthCookies(res, accessToken, refreshToken);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function listProjects(req: Request, res: Response, next: NextFunction) {
  try {
    const projects = await authService.listProjects(req.user.tenantId, req.user.userId!, req.user.role ?? 'user');
    res.json(projects);
  } catch (err) {
    next(err);
  }
}

export async function createProject(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) { next(new AppError('Name is required', 400)); return; }
    const project = await authService.createProject(req.user.tenantId, name.trim());
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
}

export async function renameProject(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) { next(new AppError('Name is required', 400)); return; }
    await authService.renameProject(req.user.tenantId, id, name.trim());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await authService.listUsers(req.user.tenantId);
    res.json(users);
  } catch (err) { next(err); }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, name, role, password, allProjects, projectIds } = req.body;
    if (!email || !name) { next(new AppError('email and name are required', 400)); return; }
    if (!password || password.length < 6) { next(new AppError('Password must be at least 6 characters', 400)); return; }
    const requesterRole = req.user?.role;
    if (role === 'owner' && requesterRole !== 'superadmin' && requesterRole !== 'owner') {
      next(new AppError('Only owner or superadmin can assign the owner role', 403)); return;
    }
    await authService.createUser(req.user.tenantId, { email, name, role, password, allProjects: !!allProjects, projectIds });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { name, role } = req.body;
    await authService.updateUser(req.user.tenantId, id, { name, role });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await authService.deleteUser(req.user.tenantId, id);
    if (id === req.user.userId) {
      authService.clearAuthCookies(res);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function getUserProjects(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const result = await authService.getUserProjects(id);
    res.json(result);
  } catch (err) { next(err); }
}

export async function setUserProjects(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { allProjects, projectIds } = req.body;
    if (!allProjects && !Array.isArray(projectIds)) { next(new AppError('projectIds must be an array', 400)); return; }
    await authService.setUserProjects(req.user.tenantId, id, { allProjects: !!allProjects, projectIds: projectIds ?? [] });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteProject(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { switchToProjectId } = await authService.deleteProject(req.user.tenantId, id);

    // If the deleted project was active, issue a new token for the fallback project
    if (req.user.projectId === id || req.user.projectId === undefined) {
      if (switchToProjectId) {
        const { accessToken, refreshToken } = await authService.switchProject(req.user.userId!, req.user.tenantId, switchToProjectId, req.user.role ?? 'user');
        authService.setAuthCookies(res, accessToken, refreshToken);
      }
    }

    res.json({ ok: true, switchToProjectId });
  } catch (err) {
    next(err);
  }
}
