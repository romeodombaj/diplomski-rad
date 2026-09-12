import type { Request, Response, NextFunction } from 'express';
import * as proximityService from './proximity.service';
import type { ProximityReportInput } from './proximity.schema';

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
      data: { published: result.published, level: result.level },
    });
  } catch (err) {
    next(err);
  }
}
