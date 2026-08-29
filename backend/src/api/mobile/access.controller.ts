import type { Request, Response, NextFunction } from 'express';
import * as accessService from './access.service';
import type { AccessRequestInput } from './access.schema';

/**
 * POST /mobile/access
 * The one access endpoint. Unauthenticated by design — the signature, the TOTP
 * and the face score are the credentials; a bearer token would add nothing the
 * private key does not already prove.
 */
export async function requestAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const decision = await accessService.decide(req.body as AccessRequestInput);
    const { httpStatus, ...body } = decision;
    res.status(httpStatus).json({ success: decision.granted, data: body });
  } catch (err) {
    next(err);
  }
}
