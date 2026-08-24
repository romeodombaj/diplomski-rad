import type { NextFunction, Request, Response } from 'express';
import * as doorService from './door.service';
import { AppError } from '../../middleware/errorHandler';
import * as response from '../../utils/response';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const result = await doorService.getAll(buildingId, req.query as any);
    response.ok(res, result);
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const item = await doorService.getById(buildingId, Number(req.params.id));
    if (!item) return next(new AppError('door not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const item = await doorService.create(buildingId, req.body);
    response.created(res, item);
  } catch (err) {
    next(err);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const item = await doorService.update(buildingId, Number(req.params.id), req.body);
    if (!item) return next(new AppError('door not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    await doorService.remove(buildingId, Number(req.params.id));
    response.ok(res, null);
  } catch (err) {
    next(err);
  }
};
