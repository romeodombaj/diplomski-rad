import type { NextFunction, Request, Response } from 'express';
import * as personService from './person.service';
import { AppError } from '../../middleware/errorHandler';
import * as response from '../../utils/response';
import type { PersonStatus } from './person.types';

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const result = await personService.getAll(buildingId, req.query as any);
    response.ok(res, result);
  } catch (err) {
    next(err);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const item = await personService.getById(buildingId, req.params.id);
    if (!item) return next(new AppError('person not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const person = await personService.create(buildingId, req.body);
    // Creating a person immediately issues their first enrolment token, so the
    // admin can show the QR without a second round-trip.
    const invite = await personService.issueEnrollment(buildingId, person.id, req.user.userId);
    response.created(res, { person, invite });
  } catch (err) {
    next(err);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const item = await personService.update(buildingId, req.params.id, req.body);
    if (!item) return next(new AppError('person not found', 404));
    response.ok(res, item);
  } catch (err) {
    next(err);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    await personService.remove(buildingId, req.params.id);
    response.ok(res, null);
  } catch (err) {
    next(err);
  }
};

/** Shared handler for the lifecycle transitions, so each one has an audit point. */
const transition = (to: PersonStatus) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const buildingId = req.user.buildingId!;
      const person = await personService.getById(buildingId, req.params.id);
      if (!person) return next(new AppError('person not found', 404));
      if (!personService.canTransition(person.status, to)) {
        return next(new AppError(`cannot go from ${person.status} to ${to}`, 409));
      }
      const updated = await personService.setStatus(buildingId, req.params.id, to);
      response.ok(res, updated);
    } catch (err) {
      next(err);
    }
  };

export const suspend = transition('suspended');
export const reinstate = transition('active');

/**
 * Offboarding is terminal. The on-chain revocation-list write is not wired up
 * yet (no chain client in the backend) — see specs/06_access_control.md §5.
 */
export const offboard = transition('offboarded');

export const issueEnrollment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const person = await personService.getById(buildingId, req.params.id);
    if (!person) return next(new AppError('person not found', 404));
    if (person.status === 'offboarded') {
      return next(new AppError('cannot enrol an offboarded person', 409));
    }
    if (person.did) {
      return next(new AppError('person is already enrolled; revoke their device first', 409));
    }
    const invite = await personService.issueEnrollment(buildingId, person.id, req.user.userId);
    response.created(res, invite);
  } catch (err) {
    next(err);
  }
};

export const getEnrollment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const person = await personService.getById(buildingId, req.params.id);
    if (!person) return next(new AppError('person not found', 404));
    const token = await personService.getActiveEnrollment(person.id);
    // The raw token is unrecoverable, so this reports status only — reissue to
    // get a new QR.
    response.ok(res, token ? { expires_at: token.expires_at, active: true } : { active: false });
  } catch (err) {
    next(err);
  }
};

export const listDevices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const person = await personService.getById(buildingId, req.params.id);
    if (!person) return next(new AppError('person not found', 404));
    response.ok(res, await personService.listDevices(person.id));
  } catch (err) {
    next(err);
  }
};

export const revokeDevice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const device = await personService.revokeDevice(
      buildingId, req.params.id, Number(req.params.deviceId), req.body?.reason,
    );
    if (!device) return next(new AppError('device not found', 404));
    response.ok(res, device);
  } catch (err) {
    next(err);
  }
};

/** Mobile-facing: unauthenticated, guarded by the one-time token itself. */
export const claimEnrollment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, did, publicKey, deviceInfo } = req.body;
    const result = await personService.claimEnrollment(token, did, publicKey, deviceInfo);
    if (!result.ok) {
      const status = result.reason === 'did_taken' ? 409 : 400;
      return next(new AppError(`enrolment failed: ${result.reason}`, status));
    }
    response.ok(res, {
      person: { id: result.person.id, full_name: result.person.full_name, status: result.person.status },
      totp: result.totp,
      building: result.building,
      doors: result.doors,
    });
  } catch (err) {
    next(err);
  }
};
