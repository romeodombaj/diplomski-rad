import type { Request, Response, NextFunction } from 'express';
import * as response from '../../utils/response';
import { verifyTOTP } from '../../services/totpService';
import db from '../../db';

/**
 * POST /mobile/verify/totp
 * Mobile app TOTP verification.
 * Accepts Bearer token + 6-digit code, validates TOTP, logs result.
 */
export async function verifyTotp(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.body as { code: string };

    // Get user from Bearer token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      console.log('[Mobile/Verify] ❌ No authorization token');
      return res.status(401).json({ error: 'Authorization required' });
    }

    let userId: string;
    try {
      const jwt = await import('jsonwebtoken');
      const { config } = await import('../../config/conifg');
      const payload = jwt.default.verify(token, config.jwt.accessSecret) as { userId: string };
      userId = payload.userId;
    } catch {
      console.log('[Mobile/Verify] ❌ Invalid/Expired token');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Find TOTP secret for this user
    const totpSecret = await db('totp_secrets')
      .where({ user_id: userId })
      .whereNull('deleted_at')
      .first();

    if (!totpSecret) {
      console.log(`[Mobile/Verify] ❌ FAILED: No TOTP secret | user: ${userId}`);
      return res.status(401).json({ error: 'TOTP not configured for this account' });
    }

    const isValid = verifyTOTP(totpSecret.secret, code, totpSecret.digits, totpSecret.period);

    if (!isValid) {
      console.log(`[Mobile/Verify] ❌ FAILED: Invalid code="${code}" | user: ${userId}`);
      return res.status(401).json({ error: 'Invalid verification code' });
    }

    console.log(`[Mobile/Verify] ✅ SUCCESS: code="${code}" | user: ${userId}`);

    response.ok(res, {
      success: true,
      message: 'Verification successful',
      verified_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}
