import type { NextFunction, Request, Response } from 'express';
import * as buildingService from './building.service';
import { AppError } from '../../middleware/errorHandler';
import * as response from '../../utils/response';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const result = await buildingService.getAll(projectId, req.query as any);
    response.ok(res, result);
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const item = await buildingService.getById(projectId, Number(req.params.id));
    if (!item) return next(new AppError('building not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const item = await buildingService.create(projectId, req.body);
    response.created(res, item);
  } catch (err) {
    next(err);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const item = await buildingService.update(projectId, Number(req.params.id), req.body);
    if (!item) return next(new AppError('building not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    await buildingService.remove(projectId, Number(req.params.id));
    response.ok(res, null);
  } catch (err) {
    next(err);
  }
};
