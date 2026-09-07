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

export const unlock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const result = await doorService.unlock(buildingId, Number(req.params.id), {
      userId: req.user.userId,
      email: req.user.email,
    });
    if (!result) return next(new AppError('door not found', 404));
    // 200 even when `unlocked` is false: the override was authorised and
    // recorded, and an unreachable broker is a fault to report rather than a
    // refusal. The caller reads `unlocked` to know whether the lock moved.
    response.ok(res, result);
  } catch (err) {
    const status = (err as any)?.status;
    if (status === 409) return next(new AppError('door is out of service', 409));
    // 423 Locked, not 403: the operator is permitted to do this, the door is
    // the thing refusing. The message names which lockdown is in the way, so
    // the operator knows whether to release one door or the building.
    if (status === 423) {
      const reason = (err as Error).message;
      return next(new AppError(
        reason === 'building_lockdown'
          ? 'the building is in emergency lockdown'
          : 'this door is locked down',
        423,
      ));
    }
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
