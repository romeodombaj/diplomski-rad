import type { NextFunction, Request, Response } from 'express';
import * as response from '../../utils/response';
import * as verificationService from '../../services/verificationService';
import type { VerifyAccessInput } from './verify.schema';
import { AppError } from '../../middleware/errorHandler';

/**
 * POST /api/verify/access
 * Verify a user's access to a door (TOTP or face).
 */
export const verifyAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const input = req.body as VerifyAccessInput;
    const userId = req.user?.userId;

    if (!userId) {
      return next(new AppError('Authentication required', 401));
    }

    const result = await verificationService.verifyAccess(
      {
        door_code: input.door_code,
        code: input.code,
        method: input.method,
        timestamp: input.timestamp,
      },
      userId,
    );

    if (!result.success) {
      return res.status(403).json({
        success: false,
        message: result.message,
      });
    }

    response.ok(res, result);
  } catch (error) {
    next(error);
  }
};
