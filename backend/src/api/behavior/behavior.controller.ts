import type { NextFunction, Request, Response } from 'express';
import * as behaviorService from './behavior.service';
import * as personService from '../person/person.service';
import * as behavior from '../../services/behaviorService';
import { AppError } from '../../middleware/errorHandler';
import * as response from '../../utils/response';

const resolve = async (req: Request) => {
  const person = await personService.getById(req.user.buildingId!, req.params.id);
  if (!person) throw new AppError('person not found', 404);
  return person;
};

export const getForPerson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const person = await resolve(req);
    response.ok(res, await behaviorService.forPerson(person.id));
  } catch (err) {
    next(err);
  }
};

export const train = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const person = await resolve(req);
    if (!behavior.isEnabled()) return next(new AppError('behaviour engine not configured', 503));
    response.ok(res, await behaviorService.train(person.id));
  } catch (err) {
    next(err);
  }
};

export const seed = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const person = await resolve(req);
    if (!behavior.isEnabled()) return next(new AppError('behaviour engine not configured', 503));
    const days = Number(req.body?.days) || undefined;
    response.ok(res, await behaviorService.seed(person, days));
  } catch (err) {
    next(err);
  }
};
