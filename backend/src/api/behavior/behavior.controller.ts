import type { NextFunction, Request, Response } from 'express';
import * as behaviorService from './behavior.service';
import * as personService from '../person/person.service';
import * as behavior from '../../services/behaviorService';
import { AppError } from '../../middleware/errorHandler';
import * as response from '../../utils/response';

/**
 * Every handler resolves the person within the caller's building first.
 *
 * A behaviour profile is a description of when somebody comes and goes, which
 * is more revealing than most of the person record itself — it must not be
 * readable by id alone from another building's dashboard.
 */
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

/** Fit from this person's real history. Slow enough to be explicit about. */
export const train = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const person = await resolve(req);
    if (!behavior.isEnabled()) return next(new AppError('behaviour engine not configured', 503));
    response.ok(res, await behaviorService.train(person.id));
  } catch (err) {
    next(err);
  }
};

/**
 * Seed a synthetic baseline — the documented cold-start fix, not a shortcut to
 * be reached for once real history exists.
 */
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
