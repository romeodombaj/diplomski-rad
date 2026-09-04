import type { NextFunction, Request, Response } from 'express';
import * as dashboardService from './dashboard.service';
import * as response from '../../utils/response';

export const overview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await dashboardService.overview(req.user.buildingId!));
  } catch (err) {
    next(err);
  }
};
