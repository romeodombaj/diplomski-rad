import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import db from '../../db';
import { config } from '../../config/conifg';
import type { LoginDto, RegisterDto, AuthUser, User } from './auth.types';

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createTokenPair(
  userId: string,
  email: string,
  role: string,
  buildingId?: number,
  isSandbox?: boolean,
) {
  return {
    accessToken: signAccess({ userId, email, role, buildingId, isSandbox }),
    refreshToken: signRefresh({ userId }),
  };
}

const ACCESS_MAX_AGE  = 15 * 60 * 1000;
const REFRESH_MAX_AGE = 2 * 60 * 60 * 1000;

async function defaultBuilding() {
  return db('buildings').where({ is_sandbox: false }).whereNull('deleted_at').first();
}

async function resolveCurrentBuilding(user: { current_building_id?: number | null }) {
  if (user.current_building_id) {
    const building = await db('buildings').where({ id: user.current_building_id }).whereNull('deleted_at').first();
    if (building) return building;
  }
  return defaultBuilding();
}

function signAccess(payload: { userId: string; email: string; role: string; buildingId?: number; isSandbox?: boolean }) {
  return jwt.sign(payload, config.jwt.accessSecret, { expiresIn: '15m' });
}

function signRefresh(payload: { userId: string }) {
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
  const user = await db('users').where({ email: dto.email }).whereNull('deleted_at').first();

  if (!user || !(await bcrypt.compare(dto.password, user.password_hash))) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  const building = await resolveCurrentBuilding(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, buildingId: building?.id, isSandbox: building?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role, buildingId: building?.id, isSandbox: building?.is_sandbox ?? false },
  };
}

export async function register(dto: RegisterDto): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const existing = await db('users').where({ email: dto.email }).first();
  if (existing) throw Object.assign(new Error('Email already registered'), { status: 409 });

  const id = randomUUID();
  await db('users').insert({
    id,
    email: dto.email,
    password_hash: await bcrypt.hash(dto.password, 12),
    name: dto.name,
    role: 'user',
  });

  const user = await db('users').where({ id }).first();
  const building = await resolveCurrentBuilding(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, buildingId: building?.id, isSandbox: building?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role, buildingId: building?.id, isSandbox: building?.is_sandbox ?? false },
  };
}

export async function refresh(oldRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  let payload: { userId: string };
  try {
    payload = jwt.verify(oldRefreshToken, config.jwt.refreshSecret) as { userId: string };
  } catch {
    throw Object.assign(new Error('Invalid or expired refresh token'), { status: 401 });
  }

  const user = await db('users').where({ id: payload.userId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

  const building = await resolveCurrentBuilding(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, buildingId: building?.id, isSandbox: building?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id }),
  };
}

export async function googleAuth(accessToken: string): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!googleRes.ok) throw Object.assign(new Error('Invalid Google token'), { status: 401 });

  const profile = await googleRes.json() as { email: string; name: string; sub: string };
  if (!profile.email) throw Object.assign(new Error('Google account has no email'), { status: 401 });

  let user = await db('users').where({ email: profile.email }).whereNull('deleted_at').first();

  if (!user) {
    const id = randomUUID();
    await db('users').insert({
      id,
      email: profile.email,
      password_hash: '',
      name: profile.name || profile.email,
      role: 'user',
    });
    user = await db('users').where({ id }).first();
  }

  const building = await resolveCurrentBuilding(user);
  return {
    accessToken:  signAccess({ userId: user.id, email: user.email, role: user.role, buildingId: building?.id, isSandbox: building?.is_sandbox }),
    refreshToken: signRefresh({ userId: user.id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role, buildingId: building?.id, isSandbox: building?.is_sandbox ?? false },
  };
}

export async function me(userId: string) {
  const user = await db('users').where({ id: userId }).whereNull('deleted_at').first();
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

export async function switchBuilding(userId: string, buildingId: number, role: string): Promise<{ accessToken: string; refreshToken: string }> {
  const building = await db('buildings').where({ id: buildingId }).whereNull('deleted_at').first();
  if (!building) throw Object.assign(new Error('Building not found'), { status: 404 });

  if (role === 'user') {
    const userRow = await db('users').where({ id: userId }).first();
    if (!userRow?.all_buildings) {
      const liveBuildingId = building.is_sandbox
        ? (await db('buildings').where({ sandbox_building_id: building.id }).whereNull('deleted_at').select('id').first())?.id
        : building.id;
      const hasAccess = liveBuildingId && await db('user_buildings').where({ user_id: userId, building_id: liveBuildingId }).first();
      if (!hasAccess) throw Object.assign(new Error('Access denied'), { status: 403 });
    }
  }

  const user = await db('users').where({ id: userId }).first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  await db('users').where({ id: userId }).update({ current_building_id: building.id });

  return {
    accessToken: signAccess({
      userId:     user.id,
      email:      user.email,
      role:       user.role,
      buildingId: building.id,
      isSandbox:  building.is_sandbox,
    }),
    refreshToken: signRefresh({ userId: user.id }),
  };
}

export async function listBuildings(userId: string, role: string) {
  const isAdmin = role === 'admin' || role === 'owner' || role === 'superadmin';
  let showAll = isAdmin;
  if (!showAll) {
    const userRow = await db('users').where({ id: userId }).first();
    showAll = !!userRow?.all_buildings;
  }

  let buildings;
  if (showAll) {
    buildings = await db('buildings')
      .where({ is_sandbox: false })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
  } else {
    const assigned = await db('user_buildings').where({ user_id: userId }).select('building_id');
    const ids = assigned.map((r: { building_id: number }) => r.building_id);
    buildings = ids.length > 0
      ? await db('buildings').where({ is_sandbox: false }).whereIn('id', ids).whereNull('deleted_at').orderBy('created_at', 'asc')
      : [];
  }

  return buildings.map((b: { id: number; name: string; address: string; contract_address: string; sandbox_building_id: number | null }) => ({
    id: b.id,
    name: b.name,
    address: b.address,
    contractAddress: b.contract_address,
    sandboxBuildingId: b.sandbox_building_id,
  }));
}

export async function createBuilding(dto: { name: string; address: string; contractAddress: string }): Promise<{ id: number; name: string; address: string; contractAddress: string; sandboxBuildingId: number }> {
  const [sandboxId] = await db('buildings').insert({ name: dto.name, address: dto.address, contract_address: dto.contractAddress, is_sandbox: true });
  const [liveId] = await db('buildings').insert({ name: dto.name, address: dto.address, contract_address: dto.contractAddress, is_sandbox: false, sandbox_building_id: sandboxId });

  return { id: liveId, name: dto.name, address: dto.address, contractAddress: dto.contractAddress, sandboxBuildingId: sandboxId };
}

export async function renameBuilding(buildingId: number, dto: { name?: string; address?: string; contractAddress?: string }): Promise<void> {
  const building = await db('buildings').where({ id: buildingId, is_sandbox: false }).whereNull('deleted_at').first();
  if (!building) throw Object.assign(new Error('Building not found'), { status: 404 });

  const updates: Record<string, unknown> = {};
  if (dto.name !== undefined) updates.name = dto.name;
  if (dto.address !== undefined) updates.address = dto.address;
  if (dto.contractAddress !== undefined) updates.contract_address = dto.contractAddress;
  if (Object.keys(updates).length > 0) await db('buildings').where({ id: buildingId }).update(updates);

  if (building.sandbox_building_id && (dto.name !== undefined || dto.address !== undefined)) {
    const twinUpdates: Record<string, unknown> = {};
    if (dto.name !== undefined) twinUpdates.name = dto.name;
    if (dto.address !== undefined) twinUpdates.address = dto.address;
    await db('buildings').where({ id: building.sandbox_building_id }).update(twinUpdates);
  }
}

export async function listUsers() {
  const users = await db('users').whereNull('deleted_at').orderBy('created_at', 'asc');
  return users.map(({ password_hash, ...u }: any) => ({ ...u, has_password: password_hash !== '' }));
}

export async function createUser(dto: { email: string; name: string; role: string; password: string; allBuildings?: boolean; buildingIds?: number[] }): Promise<void> {
  const existing = await db('users').where({ email: dto.email }).first();
  if (existing && !existing.deleted_at) throw Object.assign(new Error('Email already registered'), { status: 409 });

  const passwordHash = await bcrypt.hash(dto.password, 12);

  if (existing && existing.deleted_at) {
    await db('users').where({ id: existing.id }).update({
      name: dto.name,
      role: dto.role ?? 'user',
      password_hash: passwordHash,
      all_buildings: dto.allBuildings ? 1 : 0,
      deleted_at: null,
    });
    await db('user_buildings').where({ user_id: existing.id }).delete();
    if (!dto.allBuildings && dto.buildingIds && dto.buildingIds.length > 0) {
      await db('user_buildings').insert(dto.buildingIds.map((bid: number) => ({ user_id: existing.id, building_id: bid })));
    }
    return;
  }

  const id = randomUUID();
  await db('users').insert({
    id,
    email: dto.email,
    name: dto.name,
    role: dto.role ?? 'user',
    password_hash: passwordHash,
    all_buildings: dto.allBuildings ? 1 : 0,
  });
  if (!dto.allBuildings && dto.buildingIds && dto.buildingIds.length > 0) {
    await db('user_buildings').insert(dto.buildingIds.map((bid: number) => ({ user_id: id, building_id: bid })));
  }
}

export async function updateUser(userId: string, dto: { name?: string; role?: string }): Promise<void> {
  const user = await db('users').where({ id: userId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.role === 'superadmin') throw Object.assign(new Error('Cannot modify superadmin'), { status: 403 });
  if (user.role === 'owner') throw Object.assign(new Error('Cannot change role or name of tenant owner'), { status: 403 });
  const updates: Record<string, unknown> = {};
  if (dto.name !== undefined) updates.name = dto.name;
  if (dto.role !== undefined) updates.role = dto.role;
  if (Object.keys(updates).length > 0) await db('users').where({ id: userId }).update(updates);
}

export async function deleteUser(userId: string): Promise<void> {
  const user = await db('users').where({ id: userId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.role === 'superadmin') throw Object.assign(new Error('Cannot delete superadmin'), { status: 403 });
  if (user.role === 'owner') throw Object.assign(new Error('Cannot delete tenant owner'), { status: 403 });
  await db('users').where({ id: userId }).update({ deleted_at: new Date().toISOString() });
}

export async function getUserBuildings(userId: string): Promise<{ allBuildings: boolean; buildingIds: number[] }> {
  const user = await db('users').where({ id: userId }).first();
  const rows = await db('user_buildings').where({ user_id: userId }).select('building_id');
  return { allBuildings: !!user?.all_buildings, buildingIds: rows.map((r: { building_id: number }) => r.building_id) };
}

export async function setUserBuildings(userId: string, dto: { allBuildings: boolean; buildingIds: number[] }): Promise<void> {
  const user = await db('users').where({ id: userId }).whereNull('deleted_at').first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  await db('users').where({ id: userId }).update({ all_buildings: dto.allBuildings ? 1 : 0 });
  await db('user_buildings').where({ user_id: userId }).delete();
  if (!dto.allBuildings && dto.buildingIds.length > 0) {
    await db('user_buildings').insert(dto.buildingIds.map((bid: number) => ({ user_id: userId, building_id: bid })));
  }
}

export async function deleteBuilding(buildingId: number): Promise<{ switchToBuildingId: number | null }> {
  const building = await db('buildings').where({ id: buildingId, is_sandbox: false }).whereNull('deleted_at').first();
  if (!building) throw Object.assign(new Error('Building not found'), { status: 404 });

  const now = new Date().toISOString();
  const deletedIds = [buildingId, building.sandbox_building_id].filter(Boolean);

  await db('buildings').where({ id: buildingId }).update({ deleted_at: now });
  if (building.sandbox_building_id) {
    await db('buildings').where({ id: building.sandbox_building_id }).update({ deleted_at: now });
  }

  await db('users').whereIn('current_building_id', deletedIds).update({ current_building_id: null });

  const fallback = await db('buildings').where({ is_sandbox: false }).whereNull('deleted_at').first();
  return { switchToBuildingId: fallback?.id ?? null };
}
