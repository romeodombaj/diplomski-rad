import type { Request, Response, NextFunction } from 'express';
import speakeasy from 'speakeasy';
import * as response from '../../utils/response';
import { verifyTOTP } from '../../services/totpService';
import db from '../../db';

const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;

/**
 * Resolve a project id to attach the TOTP secret to.
 * The system design keys secrets by (project_id, did) — one backend per building.
 * For the mobile demo we attach to the first live (non-sandbox) project.
 */
async function resolveProjectId(): Promise<string | null> {
  const live = await db('projects')
    .where({ is_sandbox: false })
    .whereNull('deleted_at')
    .first();
  if (live) return live.id;
  const any = await db('projects').whereNull('deleted_at').first();
  return any ? any.id : null;
}

/**
 * POST /mobile/totp/enroll
 * Register a device DID and return a TOTP secret the app stores locally.
 * Idempotent: re-enrolling the same DID returns the existing secret so the
 * on-device generator and the backend stay in sync.
 */
export async function enrollTotp(req: Request, res: Response, next: NextFunction) {
  try {
    const { did } = req.body as { did: string };

    const projectId = await resolveProjectId();
    if (!projectId) {
      console.log('[Mobile/Enroll] ❌ No project found to attach secret to');
      return res.status(500).json({ success: false, message: 'No project configured on backend' });
    }

    let secretRow = await db('totp_secrets')
      .where({ project_id: projectId, did })
      .whereNull('deleted_at')
      .first();

    if (!secretRow) {
      const generated = speakeasy.generateSecret({ length: 20 });
      const [id] = await db('totp_secrets').insert({
        project_id: projectId,
        did,
        secret: generated.base32,
        period: DEFAULT_PERIOD,
        digits: DEFAULT_DIGITS,
      });
      secretRow = await db('totp_secrets').where({ id }).first();
      console.log(`[Mobile/Enroll] ✅ Enrolled new DID | did: ${did}`);
    } else {
      console.log(`[Mobile/Enroll] ♻️  Returning existing secret | did: ${did}`);
    }

    response.ok(res, {
      success: true,
      did: secretRow.did,
      secret: secretRow.secret,
      period: secretRow.period,
      digits: secretRow.digits,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /mobile/verify/totp
 * Verify a 6-digit TOTP code produced on-device for a given DID.
 */
export async function verifyTotp(req: Request, res: Response, next: NextFunction) {
  try {
    const { did, code } = req.body as { did: string; code: string };

    const totpSecret = await db('totp_secrets')
      .where({ did })
      .whereNull('deleted_at')
      .first();

    if (!totpSecret) {
      console.log(`[Mobile/Verify] ❌ FAILED: No TOTP secret | did: ${did}`);
      return res.status(404).json({ success: false, message: 'This device is not enrolled' });
    }

    const isValid = verifyTOTP(totpSecret.secret, code, totpSecret.digits, totpSecret.period);

    if (!isValid) {
      console.log(`[Mobile/Verify] ❌ FAILED: Invalid code="${code}" | did: ${did}`);
      return res.status(401).json({ success: false, message: 'Invalid verification code' });
    }

    console.log(`[Mobile/Verify] ✅ SUCCESS: code="${code}" | did: ${did}`);

    response.ok(res, {
      success: true,
      message: 'Access granted',
      verified_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}
