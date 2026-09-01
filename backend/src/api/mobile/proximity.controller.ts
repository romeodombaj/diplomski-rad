import type { Request, Response, NextFunction } from 'express';
import * as proximityService from './proximity.service';
import type { ProximityReportInput } from './proximity.schema';

/**
 * POST /mobile/proximity
 *
 * Unauthenticated in the same sense as /mobile/access: the device signature is
 * the credential. Every rejection answers with the same body, because the only
 * thing an attacker could learn from a detailed reason is which doors and DIDs
 * exist — and the endpoint grants nothing worth that.
 */
export async function reportProximity(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await proximityService.report(req.body as ProximityReportInput);

    if (!result.accepted) {
      return res
        .status(result.httpStatus)
        .json({ success: false, message: 'Proximity report rejected' });
    }

    res.status(200).json({
      success: true,
      // `published` is false when the broker is unreachable. Reported honestly
      // rather than swallowed, but the phone does nothing with it: a dark ring
      // is not a failure the person at the door needs to hear about.
      data: { published: result.published, level: result.level },
    });
  } catch (err) {
    next(err);
  }
}
