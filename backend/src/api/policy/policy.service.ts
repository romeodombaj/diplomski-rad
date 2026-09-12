import db from '../../db';
import logger from '../../lib/logger';
import * as chain from '../../services/chainService';
import * as scheduleService from '../../services/scheduleService';
import type { Schedule } from '../../services/scheduleService';
import type { MirrorRow, SyncStatus, GrantSource } from './policy.types';

const now = () => new Date().toISOString();

const MAX_ATTEMPTS = 5;

export const getSchedule = async (id: number | null): Promise<Schedule | null> => {
  if (!id) return null;
  const row = await db('access_schedules').where({ id }).whereNull('deleted_at').first();
  return row ?? null;
};


export interface GrantInput {
  personId: string;
  doorId: number;
  scheduleId?: number | null;
  startTime?: number;
  endTime?: number;
  operatorId?: string;
}

export type GrantOutcome =
  | { ok: false; reason: 'person_not_found' | 'door_not_found' | 'no_did' | 'door_not_in_scope' | 'already_granted' }
  | { ok: true; mirror: MirrorRow };

export async function grantDirect(
  buildingId: number,
  input: GrantInput,
): Promise<GrantOutcome> {
  const person = await db('people')
    .where({ id: input.personId, building_id: buildingId })
    .whereNull('deleted_at')
    .first();
  if (!person) return { ok: false, reason: 'person_not_found' };
  if (!person.did) return { ok: false, reason: 'no_did' };

  const door = await db('doors').where({ id: input.doorId }).whereNull('deleted_at').first();
  if (!door) return { ok: false, reason: 'door_not_found' };

  const attached = await db('person_buildings')
    .where({ person_id: person.id, building_id: door.building_id })
    .first();
  if (door.building_id !== person.building_id && !attached) {
    return { ok: false, reason: 'door_not_in_scope' };
  }

  const existing = await db('access_policy_mirror')
    .where({ person_id: person.id, door_id: door.id, source: 'direct' })
    .whereNotIn('sync_status', ['revoked'])
    .first();
  if (existing) return { ok: false, reason: 'already_granted' };

  const schedule = await getSchedule(input.scheduleId ?? null);

  const [id] = await db('access_policy_mirror').insert({
    person_id: person.id,
    door_id: door.id,
    did: person.did,
    door_code: door.door_code,
    source: 'direct' as GrantSource,
    source_group_id: null,
    schedule_id: input.scheduleId ?? null,
    schedule_hash: scheduleService.scheduleHash(schedule),
    start_time: input.startTime ?? 0,
    end_time: input.endTime ?? 0,
    sync_status: 'pending' as SyncStatus,
    granted_by_operator_id: input.operatorId ?? null,
  });

  return { ok: true, mirror: (await db('access_policy_mirror').where({ id }).first()) as MirrorRow };
}


export async function assignGroup(
  buildingId: number,
  personId: string,
  groupId: number,
  operatorId?: string,
): Promise<{ ok: false; reason: string } | { ok: true; created: number }> {
  const person = await db('people')
    .where({ id: personId, building_id: buildingId })
    .whereNull('deleted_at')
    .first();
  if (!person) return { ok: false, reason: 'person_not_found' };
  if (!person.did) return { ok: false, reason: 'no_did' };

  const group = await db('access_groups')
    .where({ id: groupId, building_id: buildingId })
    .whereNull('deleted_at')
    .first();
  if (!group) return { ok: false, reason: 'group_not_found' };

  const doors = await db('access_group_doors as gd')
    .where('gd.group_id', groupId)
    .join('doors as d', 'd.id', 'gd.door_id')
    .whereNull('d.deleted_at')
    .select('d.id as door_id', 'd.door_code', 'gd.schedule_id');

  let created = 0;
  await db.transaction(async (trx) => {
    await trx('person_access_groups')
      .insert({ person_id: personId, group_id: groupId, granted_by_operator_id: operatorId ?? null })
      .onConflict(['person_id', 'group_id'])
      .ignore();

    for (const door of doors) {
      const already = await trx('access_policy_mirror')
        .where({ person_id: personId, door_id: door.door_id, source_group_id: groupId })
        .first();
      if (already) continue;

      const schedule = await getSchedule(door.schedule_id);
      await trx('access_policy_mirror')
        .insert({
          person_id: personId,
          door_id: door.door_id,
          did: person.did,
          door_code: door.door_code,
          source: 'group' as GrantSource,
          source_group_id: groupId,
          schedule_id: door.schedule_id,
          schedule_hash: scheduleService.scheduleHash(schedule),
          start_time: 0,
          end_time: 0,
          sync_status: 'pending' as SyncStatus,
          granted_by_operator_id: operatorId ?? null,
        })
        .onConflict(['person_id', 'door_id', 'source_group_id'])
        .ignore();
      created += 1;
    }
  });

  return { ok: true, created };
}

export async function unassignGroup(
  buildingId: number,
  personId: string,
  groupId: number,
): Promise<{ revoking: number }> {
  await db('person_access_groups').where({ person_id: personId, group_id: groupId }).del();

  const rows = await db('access_policy_mirror')
    .where({ person_id: personId, source_group_id: groupId })
    .whereNotIn('sync_status', ['revoked']);

  await db('access_policy_mirror')
    .whereIn('id', rows.map((r) => r.id))
    .update({ sync_status: 'revoking', updated_at: now() });

  return { revoking: rows.length };
}

export async function revokeMirror(id: number): Promise<MirrorRow | undefined> {
  await db('access_policy_mirror')
    .where({ id })
    .whereNotIn('sync_status', ['revoked'])
    .update({ sync_status: 'revoking', updated_at: now() });
  return db('access_policy_mirror').where({ id }).first();
}

export async function revokeAllForPerson(personId: string): Promise<number> {
  const rows = await db('access_policy_mirror')
    .where({ person_id: personId })
    .whereNotIn('sync_status', ['revoked']);
  await db('access_policy_mirror')
    .whereIn('id', rows.map((r) => r.id))
    .update({ sync_status: 'revoking', updated_at: now() });
  return rows.length;
}


export interface SyncReport {
  granted: number;
  revoked: number;
  failed: number;
  skipped: boolean;
}

export async function syncPending(limit = 25): Promise<SyncReport> {
  const report: SyncReport = { granted: 0, revoked: 0, failed: 0, skipped: false };
  if (!chain.isEnabled()) {
    report.skipped = true;
    return report;
  }

  const pending: MirrorRow[] = await db('access_policy_mirror')
    .whereIn('sync_status', ['pending', 'failed'])
    .where('attempts', '<', MAX_ATTEMPTS)
    .orderBy('id', 'asc')
    .limit(limit);

  for (const row of pending) {
    try {
      const { policyId, txHash } = await chain.grantAccess(
        row.did,
        row.door_code,
        Number(row.start_time),
        Number(row.end_time),
        row.schedule_hash ?? chain.NO_SCHEDULE,
      );
      await db('access_policy_mirror').where({ id: row.id }).update({
        chain_policy_id: policyId,
        chain_tx_hash: txHash,
        sync_status: 'synced' as SyncStatus,
        sync_error: null,
        last_synced_at: now(),
        attempts: row.attempts + 1,
        updated_at: now(),
      });
      report.granted += 1;
    } catch (err) {
      await markFailed(row, err as Error);
      report.failed += 1;
    }
  }

  const revoking: MirrorRow[] = await db('access_policy_mirror')
    .where({ sync_status: 'revoking' })
    .where('attempts', '<', MAX_ATTEMPTS)
    .orderBy('id', 'asc')
    .limit(limit);

  for (const row of revoking) {
    try {
      await revokeOnChain(row);
      await db('access_policy_mirror').where({ id: row.id }).update({
        sync_status: 'revoked' as SyncStatus,
        sync_error: null,
        last_synced_at: now(),
        updated_at: now(),
      });
      report.revoked += 1;
    } catch (err) {
      await markFailed(row, err as Error);
      report.failed += 1;
    }
  }

  return report;
}

async function markFailed(row: MirrorRow, err: Error) {
  logger.error(`[policy] sync failed for mirror ${row.id} (${row.did}/${row.door_code}): ${err.message}`);
  await db('access_policy_mirror').where({ id: row.id }).update({
    sync_status: 'failed' as SyncStatus,
    sync_error: err.message.slice(0, 500),
    attempts: row.attempts + 1,
    updated_at: now(),
  });
}

async function revokeOnChain(row: MirrorRow): Promise<void> {
  const onChain = await chain.getPoliciesForDID(row.did);
  const targets = onChain.filter((p) => p.active && p.doorCode === row.door_code);

  if (targets.length === 0) {
    logger.info(`[policy] nothing active on chain for ${row.did}/${row.door_code}`);
    return;
  }

  for (const target of targets) {
    await chain.revokeAccess(target.policyId);
    logger.info(`[policy] revoked ${target.policyId} (${row.did}/${row.door_code})`);
  }
}


export interface ReconcileReport {
  checked: number;
  unauthorised: number;
  missingOnChain: number;
  mismatched: number;
  skipped: boolean;
}

export async function reconcile(buildingId: number): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    checked: 0, unauthorised: 0, missingOnChain: 0, mismatched: 0, skipped: false,
  };
  if (!chain.isEnabled()) {
    report.skipped = true;
    return report;
  }

  const people = await db('people')
    .where({ building_id: buildingId })
    .whereNotNull('did')
    .whereNull('deleted_at')
    .select('id', 'did');

  for (const person of people) {
    const onChain = await chain.getPoliciesForDID(person.did);
    const mirror: MirrorRow[] = await db('access_policy_mirror').where({ person_id: person.id });
    report.checked += onChain.length;

    for (const policy of onChain.filter((p) => p.active)) {
      const known = mirror.find(
        (m) => m.chain_policy_id === policy.policyId ||
          (m.door_code === policy.doorCode && m.sync_status === 'synced'),
      );
      if (!known) {
        await recordDrift(buildingId, {
          kind: 'unauthorised',
          severity: 'high',
          did: person.did,
          door_code: policy.doorCode,
          chain_policy_id: policy.policyId,
          detail: 'Active on chain with no authoring record. Granted outside the dashboard.',
        });
        report.unauthorised += 1;
      } else if (known.schedule_hash && known.schedule_hash !== policy.scheduleHash) {
        await recordDrift(buildingId, {
          kind: 'mismatch',
          severity: 'high',
          did: person.did,
          door_code: policy.doorCode,
          chain_policy_id: policy.policyId,
          mirror_id: known.id,
          detail: `Schedule commitment differs: chain ${policy.scheduleHash}, mirror ${known.schedule_hash}`,
        });
        report.mismatched += 1;
      }
    }

    for (const row of mirror.filter((m) => m.sync_status === 'synced')) {
      const stillThere = onChain.some((p) => p.active && p.doorCode === row.door_code);
      if (!stillThere) {
        await recordDrift(buildingId, {
          kind: 'missing_on_chain',
          severity: 'medium',
          did: person.did,
          door_code: row.door_code,
          mirror_id: row.id,
          detail: 'Recorded as synced but not active on chain. Re-queued.',
        });
        await db('access_policy_mirror').where({ id: row.id }).update({
          sync_status: 'pending' as SyncStatus, attempts: 0, updated_at: now(),
        });
        report.missingOnChain += 1;
      }
    }
  }

  return report;
}

async function recordDrift(
  buildingId: number,
  d: {
    kind: string; severity: string; did?: string; door_code?: string;
    chain_policy_id?: string; mirror_id?: number; detail: string;
  },
) {
  const open = await db('access_policy_drift')
    .where({
      building_id: buildingId, kind: d.kind,
      did: d.did ?? null, door_code: d.door_code ?? null,
    })
    .whereNull('resolved_at')
    .first();
  if (open) return;

  await db('access_policy_drift').insert({
    building_id: buildingId,
    kind: d.kind,
    severity: d.severity,
    did: d.did ?? null,
    door_code: d.door_code ?? null,
    chain_policy_id: d.chain_policy_id ?? null,
    mirror_id: d.mirror_id ?? null,
    detail: d.detail,
  });
  logger.warn(`[policy] drift (${d.severity}) ${d.kind}: ${d.detail}`);
}

export const listDrift = (buildingId: number, includeResolved = false) => {
  const q = db('access_policy_drift').where({ building_id: buildingId }).orderBy('detected_at', 'desc');
  if (!includeResolved) q.whereNull('resolved_at');
  return q;
};

export const resolveDrift = async (buildingId: number, id: number) =>
  db('access_policy_drift')
    .where({ id, building_id: buildingId })
    .update({ resolved_at: now(), updated_at: now() });


export interface EffectiveAccessRow {
  id: number;
  door_id: number;
  door_code: string;
  door_name: string;
  source: GrantSource;
  source_name: string;
  schedule: string;
  schedule_id: number | null;
  chain_policy_id: string | null;
  sync_status: SyncStatus;
  open_now: boolean;
}

export async function effectiveAccess(personId: string): Promise<EffectiveAccessRow[]> {
  const rows = await db('access_policy_mirror as m')
    .where('m.person_id', personId)
    .whereNotIn('m.sync_status', ['revoked'])
    .leftJoin('doors as d', 'd.id', 'm.door_id')
    .leftJoin('access_groups as g', 'g.id', 'm.source_group_id')
    .select(
      'm.*',
      'd.name as door_name',
      'g.name as group_name',
    );

  const at = new Date();
  const out: EffectiveAccessRow[] = [];

  for (const row of rows) {
    const schedule = await getSchedule(row.schedule_id);
    const withinWindow =
      (!row.start_time || at.getTime() / 1000 >= Number(row.start_time)) &&
      (!row.end_time || at.getTime() / 1000 <= Number(row.end_time));

    out.push({
      id: row.id,
      door_id: row.door_id,
      door_code: row.door_code,
      door_name: row.door_name ?? row.door_code,
      source: row.source,
      source_name: row.source === 'group' ? (row.group_name ?? 'deleted group') : 'direct grant',
      schedule: scheduleService.describe(schedule),
      schedule_id: row.schedule_id,
      chain_policy_id: row.chain_policy_id,
      sync_status: row.sync_status,
      open_now:
        row.sync_status === 'synced' &&
        withinWindow &&
        scheduleService.isWithinSchedule(schedule, at),
    });
  }

  return out;
}

export async function whoHasAccess(doorId: number) {
  const rows = await db('access_policy_mirror as m')
    .where('m.door_id', doorId)
    .whereNotIn('m.sync_status', ['revoked'])
    .leftJoin('people as p', 'p.id', 'm.person_id')
    .leftJoin('access_groups as g', 'g.id', 'm.source_group_id')
    .select(
      'm.id', 'm.person_id', 'm.did', 'm.source', 'm.schedule_id',
      'm.sync_status', 'm.chain_policy_id',
      'p.full_name', 'p.employee_no', 'p.status as person_status',
      'g.name as group_name',
    );

  const at = new Date();
  return Promise.all(
    rows.map(async (row) => {
      const schedule = await getSchedule(row.schedule_id);
      return {
        ...row,
        source_name: row.source === 'group' ? (row.group_name ?? 'deleted group') : 'direct grant',
        schedule: scheduleService.describe(schedule),
        open_now:
          row.sync_status === 'synced' &&
          row.person_status === 'active' &&
          scheduleService.isWithinSchedule(schedule, at),
      };
    }),
  );
}
