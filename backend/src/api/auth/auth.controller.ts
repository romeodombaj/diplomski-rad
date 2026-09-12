import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/errorHandler';
import * as authService from './auth.service';
import { verifyTOTP } from '../../services/totpService';
import db from '../../db';

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
    const result = await authService.me(req.user.userId!);
    res.json({ ...result, buildingId: req.user.buildingId, isSandbox: req.user.isSandbox ?? false });
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

export async function switchBuilding(req: Request, res: Response, next: NextFunction) {
  try {
    const { buildingId } = req.body;
    if (buildingId === undefined || buildingId === null) { next(new AppError('buildingId is required', 400)); return; }
    const { accessToken, refreshToken } = await authService.switchBuilding(req.user.userId!, Number(buildingId), req.user.role ?? 'user');
    authService.setAuthCookies(res, accessToken, refreshToken);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function listBuildings(req: Request, res: Response, next: NextFunction) {
  try {
    const buildings = await authService.listBuildings(req.user.userId!, req.user.role ?? 'user');
    res.json(buildings);
  } catch (err) {
    next(err);
  }
}

export async function createBuilding(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, address, contractAddress } = req.body;
    if (!name || !name.trim()) { next(new AppError('Name is required', 400)); return; }
    if (!address || !address.trim()) { next(new AppError('Address is required', 400)); return; }
    if (!contractAddress || !contractAddress.trim()) { next(new AppError('Contract address is required', 400)); return; }
    const building = await authService.createBuilding({ name: name.trim(), address: address.trim(), contractAddress: contractAddress.trim() });
    res.status(201).json(building);
  } catch (err) {
    next(err);
  }
}

export async function renameBuilding(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { name, address, contractAddress } = req.body;
    await authService.renameBuilding(Number(id), {
      name: typeof name === 'string' ? name.trim() : undefined,
      address: typeof address === 'string' ? address.trim() : undefined,
      contractAddress: typeof contractAddress === 'string' ? contractAddress.trim() : undefined,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await authService.listUsers();
    res.json(users);
  } catch (err) { next(err); }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, name, role, password, allBuildings, buildingIds } = req.body;
    if (!email || !name) { next(new AppError('email and name are required', 400)); return; }
    if (!password || password.length < 6) { next(new AppError('Password must be at least 6 characters', 400)); return; }
    const requesterRole = req.user?.role;
    if (role === 'owner' && requesterRole !== 'superadmin' && requesterRole !== 'owner') {
      next(new AppError('Only owner or superadmin can assign the owner role', 403)); return;
    }
    await authService.createUser({ email, name, role, password, allBuildings: !!allBuildings, buildingIds });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { name, role } = req.body;
    await authService.updateUser(id, { name, role });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await authService.deleteUser(id);
    if (id === req.user.userId) {
      authService.clearAuthCookies(res);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function getUserBuildings(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const result = await authService.getUserBuildings(id);
    res.json(result);
  } catch (err) { next(err); }
}

export async function setUserBuildings(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { allBuildings, buildingIds } = req.body;
    if (!allBuildings && !Array.isArray(buildingIds)) { next(new AppError('buildingIds must be an array', 400)); return; }
    await authService.setUserBuildings(id, { allBuildings: !!allBuildings, buildingIds: buildingIds ?? [] });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteBuilding(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const buildingId = Number(id);
    const { switchToBuildingId } = await authService.deleteBuilding(buildingId);

    if (req.user.buildingId === buildingId || req.user.buildingId === undefined) {
      if (switchToBuildingId) {
        const { accessToken, refreshToken } = await authService.switchBuilding(req.user.userId!, switchToBuildingId, req.user.role ?? 'user');
        authService.setAuthCookies(res, accessToken, refreshToken);
      }
    }

    res.json({ ok: true, switchToBuildingId });
  } catch (err) {
    next(err);
  }
}

export async function totpLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, totp } = req.body;

    if (!email || !password || !totp) {
      console.log('[Auth/TOTP] ❌ Missing fields | email provided:', !!email);
      return res.status(400).json({ error: 'Email, password, and TOTP code are required' });
    }

    const userRecord = await db('users').where({ email }).whereNull('deleted_at').first();
    if (!userRecord) {
      console.log(`[Auth/TOTP] ❌ FAILED: User not found | email: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await authService.verifyPassword(password, userRecord.password_hash);
    if (!validPassword) {
      console.log(`[Auth/TOTP] ❌ FAILED: Invalid password | email: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log(`[Auth/TOTP] ✅ Password valid | email: ${email} | user: ${userRecord.id}`);

    const totpSecret = await db('totp_secrets')
      .where({ user_id: userRecord.id })
      .whereNull('deleted_at')
      .first();

    if (!totpSecret) {
      console.log(`[Auth/TOTP] ❌ FAILED: No TOTP secret for user | user: ${userRecord.id} | email: ${email}`);
      return res.status(401).json({ error: 'TOTP not configured for this account' });
    }

    const isValid = verifyTOTP(totpSecret.secret, totp, totpSecret.digits, totpSecret.period);

    if (!isValid) {
      console.log(`[Auth/TOTP] ❌ FAILED: Invalid TOTP code | code: ${totp} | user: ${userRecord.id} | email: ${email}`);
      return res.status(401).json({ error: 'Invalid TOTP code' });
    }

    console.log(`[Auth/TOTP] ✅ SUCCESS: TOTP valid | user: ${userRecord.id} | email: ${email} | code: ${totp}`);

    const { accessToken, refreshToken } = await authService.createTokenPair(
      userRecord.id,
      userRecord.email,
      userRecord.role,
      userRecord.current_building_id,
    );

    authService.setAuthCookies(res, accessToken, refreshToken);

    res.json({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        role: userRecord.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function totpVerify(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.body;

    if (!code || code.length !== 6) {
      console.log('[Auth/TOTP] ❌ Invalid code format');
      return res.status(400).json({ error: 'A 6-digit code is required' });
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      console.log('[Auth/TOTP] ❌ No authorization token');
      return res.status(401).json({ error: 'Authorization required' });
    }

    let payload: { userId: string };
    try {
      const jwt = await import('jsonwebtoken');
      const { config } = await import('../../config/conifg');
      payload = jwt.default.verify(token, config.jwt.accessSecret) as { userId: string };
    } catch {
      console.log('[Auth/TOTP] ❌ Invalid/Expired access token');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const totpSecret = await db('totp_secrets')
      .where({ user_id: payload.userId })
      .whereNull('deleted_at')
      .first();

    if (!totpSecret) {
      console.log(`[Auth/TOTP] ❌ FAILED: No TOTP secret for user | user: ${payload.userId}`);
      return res.status(401).json({ error: 'TOTP not configured for this account' });
    }

    const isValid = verifyTOTP(totpSecret.secret, code, totpSecret.digits, totpSecret.period);

    if (!isValid) {
      console.log(`[Auth/TOTP] ❌ FAILED: Invalid TOTP code | code: ${code} | user: ${payload.userId}`);
      return res.status(401).json({ error: 'Invalid verification code' });
    }

    console.log(`[Auth/TOTP] ✅ SUCCESS: TOTP valid | code: ${code} | user: ${payload.userId}`);

    return res.json({
      success: true,
      message: 'Verification successful',
      verified_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}
