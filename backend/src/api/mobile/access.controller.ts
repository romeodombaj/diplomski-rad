import type { Request, Response, NextFunction } from 'express';
import * as accessService from './access.service';
import type { AccessRequestInput } from './access.schema';

export async function requestAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const decision = await accessService.decide(req.body as AccessRequestInput);
    const { httpStatus, ...body } = decision;
    res.status(httpStatus).json({ success: decision.granted, data: body });
  } catch (err) {
    next(err);
  }
}
