import type { Request, Response, NextFunction } from 'express';
import * as service from './access_event.service';
import * as response from '../../utils/response';
import { AppError } from '../../middleware/errorHandler';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    response.ok(res, await service.getAll(buildingId, req.query as any));
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const item = await service.getById(buildingId, req.params.id);
    if (!item) return next(new AppError('access event not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const stats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    response.ok(res, await service.stats(buildingId, req.query.since as string | undefined));
  } catch (err) {
    next(err);
  }
};
