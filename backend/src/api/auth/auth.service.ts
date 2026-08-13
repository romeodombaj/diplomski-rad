import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import db from '../../db';
import { config } from '../../config/conifg';
import type { LoginDto, RegisterDto, AuthUser, User } from './auth.types';

const ACCESS_MAX_AGE  = 15 * 60 * 1000;       // 15 min
const REFRESH_MAX_AGE = 2 * 60 * 60 * 1000;   // 2 h

async function defaultProject(tenantId: string) {
  return db('projects').where({ tenant_id: tenantId, is_sandbox: false }).whereNull('deleted_at').first();
}

// Returns the project the user was last on, falling back to the tenant default.
// Handles both live and sandbox project IDs stored in current_project_id.
async function resolveCurrentProject(user: { current_project_id?: string | null; tenant_id: string }) {
  if (user.current_project_id) {
    const project = await db('projects').where({ id: user.current_project_id }).whereNull('deleted_at').first();
    if (project) return project;
  }
  return defaultProject(user.tenant_id);
}

function signAccess(payload: { userId: string; email: string; role: string; tenantId: string; projectId?: string; isSandbox?: boolean }) {
  return jwt.sign(payload, config.jwt.accessSecret, { expiresIn: '15m' });
}

function signRefresh(payload: { userId: string; tenantId: string }) {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: '2h' });
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('access_token',  accessToken,  { httpOnly: true, sameSite: 'lax' as const, secure: isProd, path: '/',             maxAge: ACCESS_MAX_AGE });
  res.cookie('refresh_token', refreshToken, { httpOnly: true, sameSite: 'lax' as const, secure: isProd, path: '/auth/refresh', maxAge: REFRESH_MAX_AGE });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('access_token',  { httpOnly: true, path: '/' });
  res.clearCookie('refresh_token', { httpOnly: true, path: '/auth/refresh' });
}

export async function login(dto: LoginDto): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const tenantId = config.defaultTenantId;
  const user = await db('users').where({ email: dto.email, tenant_id: tenantId }).whereNull('deleted_at').first();

  if (!user || !(await bcrypt.compare(dto.password, user.password_hash))) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  const project = await resolveCurrentProject(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenant_id, projectId: project?.id, isSandbox: project?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id, tenantId: user.tenant_id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, projectId: project?.id, isSandbox: project?.is_sandbox ?? false },
  };
}

export async function register(dto: RegisterDto): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const tenantId = config.defaultTenantId;
  const existing = await db('users').where({ email: dto.email, tenant_id: tenantId }).first();
  if (existing) throw Object.assign(new Error('Email already registered'), { status: 409 });

  const id = randomUUID();
  await db('users').insert({
    id,
    tenant_id: tenantId,
    email: dto.email,
    password_hash: await bcrypt.hash(dto.password, 12),
    name: dto.name,
    role: 'user',
  });

  const user = await db('users').where({ id }).first();
  const project = await resolveCurrentProject(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenant_id, projectId: project?.id, isSandbox: project?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id, tenantId: user.tenant_id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, projectId: project?.id, isSandbox: project?.is_sandbox ?? false },
  };
}

export async function refresh(oldRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  let payload: { userId: string; tenantId: string };
  try {
    payload = jwt.verify(oldRefreshToken, config.jwt.refreshSecret) as { userId: string; tenantId: string };
  } catch {
    throw Object.assign(new Error('Invalid or expired refresh token'), { status: 401 });
  }

  const user = await db('users').where({ id: payload.userId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

  const project = await resolveCurrentProject(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenant_id, projectId: project?.id, isSandbox: project?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id, tenantId: user.tenant_id }),
  };
}

export async function googleAuth(accessToken: string): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  // Verify the Google access token and fetch the user's profile
  const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!googleRes.ok) throw Object.assign(new Error('Invalid Google token'), { status: 401 });

  const profile = await googleRes.json() as { email: string; name: string; sub: string };
  if (!profile.email) throw Object.assign(new Error('Google account has no email'), { status: 401 });

  const tenantId = config.defaultTenantId;
  let user = await db('users').where({ email: profile.email, tenant_id: tenantId }).whereNull('deleted_at').first();

  if (!user) {
    const id = randomUUID();
    await db('users').insert({
      id,
      tenant_id: tenantId,
      email: profile.email,
      password_hash: '',
      name: profile.name || profile.email,
      role: 'user',
    });
    user = await db('users').where({ id }).first();
  }

  const project = await resolveCurrentProject(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenant_id, projectId: project?.id, isSandbox: project?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id, tenantId: user.tenant_id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, projectId: project?.id, isSandbox: project?.is_sandbox ?? false },
  };
}

export async function me(userId: string, tenantId: string) {
  const user = await db('users').where({ id: userId, tenant_id: tenantId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const { password_hash, ...rest } = user;
  return { ...rest, has_password: password_hash !== '' };
}

export async function updateProfile(userId: string, name: string): Promise<void> {
  await db('users').where({ id: userId }).update({ name });
}

export async function setPassword(userId: string, requesterId: string, password: string): Promise<void> {
  const user = await db('users').where({ id: userId }).first();
  if ((user?.role === 'superadmin' || user?.role === 'owner') && userId !== requesterId) {
    throw Object.assign(new Error('Cannot change password of this user'), { status: 403 });
  }
  const hash = await bcrypt.hash(password, 12);
  await db('users').where({ id: userId }).update({ password_hash: hash });
}

export async function changePassword(userId: string, requesterId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if ((user.role === 'superadmin' || user.role === 'owner') && userId !== requesterId) {
    throw Object.assign(new Error('Cannot change password of this user'), { status: 403 });
  }
  if (!user.password_hash) throw Object.assign(new Error('No password set — use set-password instead'), { status: 400 });
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw Object.assign(new Error('Current password is incorrect'), { status: 400 });
  const hash = await bcrypt.hash(newPassword, 12);
  await db('users').where({ id: userId }).update({ password_hash: hash });
}

export async function connectGoogle(userId: string, accessToken: string): Promise<void> {
  const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!googleRes.ok) throw Object.assign(new Error('Invalid Google token'), { status: 401 });
  const profile = await googleRes.json() as { email: string };
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (profile.email !== user.email) {
    throw Object.assign(new Error('Google account email does not match your account'), { status: 400 });
  }
}

export async function switchProject(userId: string, tenantId: string, projectId: string, role: string): Promise<{ accessToken: string; refreshToken: string }> {
  const project = await db('projects').where({ id: projectId, tenant_id: tenantId }).whereNull('deleted_at').first();
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });

  if (role === 'user') {
    const userRow = await db('users').where({ id: userId }).first();
    if (!userRow?.all_projects) {
      const liveProjectId = project.is_sandbox
        ? (await db('projects').where({ sandbox_project_id: project.id }).whereNull('deleted_at').select('id').first())?.id
        : project.id;
      const hasAccess = liveProjectId && await db('user_projects').where({ user_id: userId, project_id: liveProjectId }).first();
      if (!hasAccess) throw Object.assign(new Error('Access denied'), { status: 403 });
    }
  }

  const user = await db('users').where({ id: userId }).first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  // Persist so re-login / token refresh restores this exact project+sandbox state
  await db('users').where({ id: userId }).update({ current_project_id: project.id });

  return {
    accessToken: signAccess({
      userId:    user.id,
      email:     user.email,
      role:      user.role,
      tenantId:  user.tenant_id,
      projectId: project.id,
      isSandbox: project.is_sandbox,
    }),
    refreshToken: signRefresh({ userId: user.id, tenantId: user.tenant_id }),
  };
}

export async function listProjects(tenantId: string, userId: string, role: string) {
  const isAdmin = role === 'admin' || role === 'owner' || role === 'superadmin';
  let showAll = isAdmin;
  if (!showAll) {
    const userRow = await db('users').where({ id: userId }).first();
    showAll = !!userRow?.all_projects;
  }

  let projects;
  if (showAll) {
    projects = await db('projects')
      .where({ tenant_id: tenantId, is_sandbox: false })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
  } else {
    const assigned = await db('user_projects').where({ user_id: userId }).select('project_id');
    const ids = assigned.map((r: { project_id: string }) => r.project_id);
    projects = ids.length > 0
      ? await db('projects').where({ tenant_id: tenantId, is_sandbox: false }).whereIn('id', ids).whereNull('deleted_at').orderBy('created_at', 'asc')
      : [];
  }

  return projects.map((p: { id: string; name: string; sandbox_project_id: string | null }) => ({
    id: p.id,
    name: p.name,
    sandboxProjectId: p.sandbox_project_id,
  }));
}

export async function createProject(tenantId: string, name: string): Promise<{ id: string; name: string; sandboxProjectId: string }> {
  const { randomUUID } = await import('crypto');
  const sandboxId = randomUUID();
  const liveId = randomUUID();

  await db('projects').insert({ id: sandboxId, tenant_id: tenantId, name, is_sandbox: true });
  await db('projects').insert({ id: liveId, tenant_id: tenantId, name, is_sandbox: false, sandbox_project_id: sandboxId });

  return { id: liveId, name, sandboxProjectId: sandboxId };
}

export async function renameProject(tenantId: string, projectId: string, name: string): Promise<void> {
  const project = await db('projects').where({ id: projectId, tenant_id: tenantId, is_sandbox: false }).whereNull('deleted_at').first();
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });

  await db('projects').where({ id: projectId }).update({ name });
  if (project.sandbox_project_id) {
    await db('projects').where({ id: project.sandbox_project_id }).update({ name });
  }
}

export async function listUsers(tenantId: string) {
  const users = await db('users').where({ tenant_id: tenantId }).whereNull('deleted_at').orderBy('created_at', 'asc');
  return users.map(({ password_hash, ...u }: any) => ({ ...u, has_password: password_hash !== '' }));
}

export async function createUser(tenantId: string, dto: { email: string; name: string; role: string; password: string; allProjects?: boolean; projectIds?: string[] }): Promise<void> {
  const existing = await db('users').where({ email: dto.email, tenant_id: tenantId }).first();
  if (existing && !existing.deleted_at) throw Object.assign(new Error('Email already registered'), { status: 409 });

  const passwordHash = await bcrypt.hash(dto.password, 12);

  if (existing && existing.deleted_at) {
    await db('users').where({ id: existing.id }).update({
      name: dto.name,
      role: dto.role ?? 'user',
      password_hash: passwordHash,
      all_projects: dto.allProjects ? 1 : 0,
      deleted_at: null,
    });
    await db('user_projects').where({ user_id: existing.id }).delete();
    if (!dto.allProjects && dto.projectIds && dto.projectIds.length > 0) {
      await db('user_projects').insert(dto.projectIds.map((pid: string) => ({ user_id: existing.id, project_id: pid })));
    }
    return;
  }

  const id = randomUUID();
  await db('users').insert({
    id,
    tenant_id: tenantId,
    email: dto.email,
    name: dto.name,
    role: dto.role ?? 'user',
    password_hash: passwordHash,
    all_projects: dto.allProjects ? 1 : 0,
  });
  if (!dto.allProjects && dto.projectIds && dto.projectIds.length > 0) {
    await db('user_projects').insert(dto.projectIds.map((pid: string) => ({ user_id: id, project_id: pid })));
  }
}

export async function updateUser(tenantId: string, userId: string, dto: { name?: string; role?: string }): Promise<void> {
  const user = await db('users').where({ id: userId, tenant_id: tenantId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.role === 'superadmin') throw Object.assign(new Error('Cannot modify superadmin'), { status: 403 });
  if (user.role === 'owner') throw Object.assign(new Error('Cannot change role or name of tenant owner'), { status: 403 });
  const updates: Record<string, unknown> = {};
  if (dto.name !== undefined) updates.name = dto.name;
  if (dto.role !== undefined) updates.role = dto.role;
  if (Object.keys(updates).length > 0) await db('users').where({ id: userId }).update(updates);
}

export async function deleteUser(tenantId: string, userId: string): Promise<void> {
  const user = await db('users').where({ id: userId, tenant_id: tenantId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.role === 'superadmin') throw Object.assign(new Error('Cannot delete superadmin'), { status: 403 });
  if (user.role === 'owner') throw Object.assign(new Error('Cannot delete tenant owner'), { status: 403 });
  await db('users').where({ id: userId }).update({ deleted_at: new Date().toISOString() });
}

export async function getUserProjects(userId: string): Promise<{ allProjects: boolean; projectIds: string[] }> {
  const user = await db('users').where({ id: userId }).first();
  const rows = await db('user_projects').where({ user_id: userId }).select('project_id');
  return { allProjects: !!user?.all_projects, projectIds: rows.map((r: { project_id: string }) => r.project_id) };
}

export async function setUserProjects(tenantId: string, userId: string, dto: { allProjects: boolean; projectIds: string[] }): Promise<void> {
  const user = await db('users').where({ id: userId, tenant_id: tenantId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  await db('users').where({ id: userId }).update({ all_projects: dto.allProjects ? 1 : 0 });
  await db('user_projects').where({ user_id: userId }).delete();
  if (!dto.allProjects && dto.projectIds.length > 0) {
    await db('user_projects').insert(dto.projectIds.map((pid: string) => ({ user_id: userId, project_id: pid })));
  }
}

export async function deleteProject(tenantId: string, projectId: string): Promise<{ switchToProjectId: string | null }> {
  const project = await db('projects').where({ id: projectId, tenant_id: tenantId, is_sandbox: false }).whereNull('deleted_at').first();
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });

  const now = new Date().toISOString();
  const deletedIds = [projectId, project.sandbox_project_id].filter(Boolean);

  await db('projects').where({ id: projectId }).update({ deleted_at: now });
  if (project.sandbox_project_id) {
    await db('projects').where({ id: project.sandbox_project_id }).update({ deleted_at: now });
  }

  // Clear current_project_id for any user who had this project (or its sandbox) as their last context
  await db('users').whereIn('current_project_id', deletedIds).update({ current_project_id: null });

  // Return another live project to switch to (if any)
  const fallback = await db('projects').where({ tenant_id: tenantId, is_sandbox: false }).whereNull('deleted_at').first();
  return { switchToProjectId: fallback?.id ?? null };
}
