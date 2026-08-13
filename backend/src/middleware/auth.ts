import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/conifg';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, config.jwt.accessSecret) as {
      userId: string;
      email: string;
      role: string;
      tenantId: string;
      projectId?: string;
      isSandbox?: boolean;
    };
    req.user = { userId: payload.userId, email: payload.email, role: payload.role, tenantId: payload.tenantId, projectId: payload.projectId, isSandbox: payload.isSandbox };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'owner' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== 'owner' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
