import type { NextFunction, Request, Response } from 'express';
import * as verificationService from '../../services/verificationService';
import db from '../../db';
import { AppError } from '../../middleware/errorHandler';

/**
 * POST /api/totp/verify
 * Verify a TOTP code from the user's own TOTP secret (not door-specific).
 */
export const verifyTOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      throw new AppError('Code is required', 400);
    }

    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    console.log(`[TOTP Verify] 🔐 Attempt: code="${code}" | user: ${userId}`);

    // Find the user's active TOTP secret
    const totpSecret = await db('totp_secrets')
      .where({ user_id: userId })
      .where('active', true)
      .whereNull('deleted_at')
      .first();

    if (!totpSecret) {
      console.log(`[TOTP Verify] ❌ No secret found for user: ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'No TOTP secret configured for your account',
      });
    }

    const isValid = verificationService.verifyTOTP(
      totpSecret.secret,
      code,
      totpSecret.digits || 6,
      totpSecret.period || 30,
    );

    if (!isValid) {
      console.log(`[TOTP Verify] ❌ FAILED: code="${code}" | user: ${userId}`);
      return res.status(403).json({
        success: false,
        message: 'Invalid verification code',
      });
    }

    console.log(`[TOTP Verify] ✅ SUCCESS: code="${code}" | user: ${userId}`);
    res.json({
      success: true,
      message: 'Verification successful',
    });
  } catch (error) {
    next(error);
  }
};
