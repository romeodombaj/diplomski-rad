import type { NextFunction, Request, Response } from 'express';
import * as totp_secretService from './totp_secret.service';
import { AppError } from '../../middleware/errorHandler';
import * as response from '../../utils/response';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const result = await totp_secretService.getAll(projectId, req.query as any);
    response.ok(res, result);
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const item = await totp_secretService.getById(projectId, Number(req.params.id));
    if (!item) return next(new AppError('totp_secret not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const item = await totp_secretService.create(projectId, req.body);
    response.created(res, item);
  } catch (err) {
    next(err);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    const item = await totp_secretService.update(projectId, Number(req.params.id), req.body);
    if (!item) return next(new AppError('totp_secret not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.user.projectId!;
    await totp_secretService.remove(projectId, Number(req.params.id));
    response.ok(res, null);
  } catch (err) {
    next(err);
  }
};
