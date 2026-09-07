import type { Request, Response, NextFunction } from 'express';
import * as policyService from './policy.service';
import * as groupService from './group.service';
import * as chain from '../../services/chainService';
import * as response from '../../utils/response';
import { AppError } from '../../middleware/errorHandler';
import db from '../../db';

const REASON_STATUS: Record<string, number> = {
  person_not_found: 404,
  door_not_found: 404,
  group_not_found: 404,
  no_did: 409,
  door_not_in_scope: 403,
  door_not_in_building: 400,
  already_granted: 409,
};

// ── Grants ──────────────────────────────────────────────────────────────────

/**
 * Authoring returns 202, not 200: the row is written and queued, and the chain
 * write happens in the sync pass. Blocking on a block would tie an admin click
 * to Sepolia's confirmation time.
 */
export const grantDirect = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const result = await policyService.grantDirect(buildingId, {
      personId: req.body.person_id,
      doorId: req.body.door_id,
      scheduleId: req.body.schedule_id ?? null,
      startTime: req.body.start_time,
      endTime: req.body.end_time,
      operatorId: req.user.userId,
    });
    if (!result.ok) {
      return next(new AppError(`grant failed: ${result.reason}`, REASON_STATUS[result.reason] ?? 400));
    }
    // Push it now when the chain is up, so the common case is synced by the
    // time the operator's list refreshes.
    policyService.syncPending().catch(() => {});
    response.ok(res, result.mirror, 202);
  } catch (err) {
    next(err);
  }
};

export const assignGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const result = await policyService.assignGroup(
      buildingId, req.body.person_id, req.body.group_id, req.user.userId,
    );
    if (!result.ok) {
      return next(new AppError(`assign failed: ${result.reason}`, REASON_STATUS[result.reason] ?? 400));
    }
    policyService.syncPending().catch(() => {});
    response.ok(res, result, 202);
  } catch (err) {
    next(err);
  }
};

export const unassignGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const result = await policyService.unassignGroup(
      buildingId, req.params.personId, Number(req.params.groupId),
    );
    policyService.syncPending().catch(() => {});
    response.ok(res, result, 202);
  } catch (err) {
    next(err);
  }
};

export const revoke = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const row = await db('access_policy_mirror as m')
      .where('m.id', Number(req.params.id))
      .join('people as p', 'p.id', 'm.person_id')
      .where('p.building_id', buildingId)
      .select('m.id')
      .first();
    if (!row) return next(new AppError('policy not found', 404));

    const updated = await policyService.revokeMirror(row.id);
    policyService.syncPending().catch(() => {});
    response.ok(res, updated, 202);
  } catch (err) {
    next(err);
  }
};

// Mounted on the person router as /:id/effective-access, so the param is `id`.
export const listForPerson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await policyService.effectiveAccess(req.params.id));
  } catch (err) {
    next(err);
  }
};

/** The groups this person is a member of — the Access tab's other half. */
export const listGroupsForPerson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await groupService.groupsForPerson(req.user.buildingId!, req.params.id));
  } catch (err) {
    next(err);
  }
};

export const whoHasAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await policyService.whoHasAccess(Number(req.params.doorId)));
  } catch (err) {
    next(err);
  }
};

// ── Sync and reconciliation ─────────────────────────────────────────────────

export const sync = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await policyService.syncPending());
  } catch (err) {
    next(err);
  }
};

export const reconcile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await policyService.reconcile(req.user.buildingId!));
  } catch (err) {
    next(err);
  }
};

export const listDrift = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await policyService.listDrift(
      req.user.buildingId!, req.query.include_resolved === 'true',
    ));
  } catch (err) {
    next(err);
  }
};

export const resolveDrift = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await policyService.resolveDrift(req.user.buildingId!, Number(req.params.id));
    response.ok(res, null);
  } catch (err) {
    next(err);
  }
};

/** Sync-health summary for the dashboard panel. */
export const health = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buildingId = req.user.buildingId!;
    const counts = await db('access_policy_mirror as m')
      .join('people as p', 'p.id', 'm.person_id')
      .where('p.building_id', buildingId)
      .select('m.sync_status')
      .count('* as count')
      .groupBy('m.sync_status');

    const byStatus: Record<string, number> = {};
    for (const row of counts as any[]) byStatus[row.sync_status] = Number(row.count);

    const openDrift = await policyService.listDrift(buildingId);

    response.ok(res, {
      chain: chain.status(),
      byStatus,
      pending: byStatus.pending ?? 0,
      failed: byStatus.failed ?? 0,
      synced: byStatus.synced ?? 0,
      drift: {
        open: openDrift.length,
        unauthorised: openDrift.filter((d: any) => d.kind === 'unauthorised').length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Groups and schedules ────────────────────────────────────────────────────

export const listGroups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await groupService.listGroups(req.user.buildingId!));
  } catch (err) {
    next(err);
  }
};

export const getGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await groupService.getGroup(req.user.buildingId!, Number(req.params.id));
    if (!group) return next(new AppError('group not found', 404));
    response.ok(res, group);
  } catch (err) {
    next(err);
  }
};

export const createGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.created(res, await groupService.createGroup(req.user.buildingId!, req.body));
  } catch (err) {
    next(err);
  }
};

export const updateGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await groupService.updateGroup(req.user.buildingId!, Number(req.params.id), req.body);
    if (!group) return next(new AppError('group not found', 404));
    response.ok(res, group);
  } catch (err) {
    next(err);
  }
};

export const setGroupDoors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await groupService.setGroupDoors(
      req.user.buildingId!, Number(req.params.id), req.body.doors,
    );
    if (!result.ok) {
      return next(new AppError(result.reason, REASON_STATUS[result.reason] ?? 400));
    }
    policyService.syncPending().catch(() => {});
    response.ok(res, result, 202);
  } catch (err) {
    next(err);
  }
};

export const deleteGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await groupService.deleteGroup(req.user.buildingId!, Number(req.params.id));
    policyService.syncPending().catch(() => {});
    response.ok(res, result, 202);
  } catch (err) {
    next(err);
  }
};

export const listSchedules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.ok(res, await groupService.listSchedules(req.user.buildingId!));
  } catch (err) {
    next(err);
  }
};

export const createSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    response.created(res, await groupService.createSchedule(req.user.buildingId!, req.body));
  } catch (err) {
    next(err);
  }
};

export const deleteSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await groupService.deleteSchedule(req.user.buildingId!, Number(req.params.id));
    response.ok(res, null);
  } catch (err) {
    next(err);
  }
};
