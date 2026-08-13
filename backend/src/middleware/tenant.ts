import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config/conifg'

export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Explicit headers take priority (dev bypass and direct API calls)
  const headerTenantId  = req.headers['x-tenant-id'];
  const headerProjectId = req.headers['x-project-id'];
  if (headerTenantId) {
    req.user = {
      tenantId:  Array.isArray(headerTenantId)  ? headerTenantId[0]  : headerTenantId,
      projectId: headerProjectId ? (Array.isArray(headerProjectId) ? headerProjectId[0] : headerProjectId) : undefined,
    };
    return next();
  }

  // 2. Fall back to access_token cookie — authenticated requests carry context in the token
  const token = req.cookies?.access_token;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.accessSecret) as { tenantId: string; projectId?: string; isSandbox?: boolean; userId?: string; email?: string; role?: string }
      if (payload.tenantId) {
        req.user = { tenantId: payload.tenantId, projectId: payload.projectId, isSandbox: payload.isSandbox, userId: payload.userId, email: payload.email, role: payload.role }
        return next()
      }
    } catch {
      // invalid/expired token — return 401 so the frontend can trigger a refresh
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
  }

  // No header and no cookie — treat as unauthenticated so the frontend can trigger a refresh
  return res.status(401).json({ error: 'Not authenticated' })
}
