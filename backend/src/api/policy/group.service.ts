import db from '../../db';
import * as policyService from './policy.service';
import type { AccessGroup, AccessScheduleRow, SyncStatus } from './policy.types';

const now = () => new Date().toISOString();


export const listSchedules = (buildingId: number): Promise<AccessScheduleRow[]> =>
  db('access_schedules').where({ building_id: buildingId }).whereNull('deleted_at').orderBy('name');

export const createSchedule = async (
  buildingId: number,
  data: Omit<AccessScheduleRow, 'id' | 'building_id'>,
): Promise<AccessScheduleRow> => {
  const [id] = await db('access_schedules').insert({ ...data, building_id: buildingId });
  return db('access_schedules').where({ id }).first() as Promise<AccessScheduleRow>;
};

export const deleteSchedule = async (buildingId: number, id: number): Promise<void> => {
  await db('access_schedules')
    .where({ id, building_id: buildingId })
    .update({ deleted_at: now(), updated_at: now() });
};


export const listGroups = async (buildingId: number) => {
  const groups = await db('access_groups')
    .where({ building_id: buildingId })
    .whereNull('deleted_at')
    .orderBy('name');

  return Promise.all(
    groups.map(async (g: AccessGroup) => {
      const [doors] = await db('access_group_doors').where({ group_id: g.id }).count('* as c');
      const [members] = await db('person_access_groups').where({ group_id: g.id }).count('* as c');
      return {
        ...g,
        door_count: Number((doors as any).c),
        member_count: Number((members as any).c),
        fan_out: Number((doors as any).c),
      };
    }),
  );
};

export const groupsForPerson = async (buildingId: number, personId: string) => {
  const rows = await db('person_access_groups as pg')
    .where('pg.person_id', personId)
    .join('access_groups as g', 'g.id', 'pg.group_id')
    .where('g.building_id', buildingId)
    .whereNull('g.deleted_at')
    .orderBy('g.name')
    .select('g.id', 'g.name', 'g.description', 'g.is_default', 'pg.granted_at');

  return Promise.all(
    rows.map(async (row: any) => {
      const [doors] = await db('access_group_doors').where({ group_id: row.id }).count('* as c');
      return { ...row, is_default: Boolean(row.is_default), door_count: Number((doors as any).c) };
    }),
  );
};

export const getGroup = async (buildingId: number, id: number) => {
  const group = await db('access_groups')
    .where({ id, building_id: buildingId })
    .whereNull('deleted_at')
    .first();
  if (!group) return undefined;

  const doors = await db('access_group_doors as gd')
    .where('gd.group_id', id)
    .join('doors as d', 'd.id', 'gd.door_id')
    .leftJoin('access_schedules as s', 's.id', 'gd.schedule_id')
    .select('d.id as door_id', 'd.name as door_name', 'd.door_code', 'gd.schedule_id', 's.name as schedule_name');

  const members = await db('person_access_groups as pg')
    .where('pg.group_id', id)
    .join('people as p', 'p.id', 'pg.person_id')
    .whereNull('p.deleted_at')
    .select('p.id', 'p.full_name', 'p.employee_no', 'p.status', 'pg.granted_at');

  return { ...group, doors, members };
};

export const createGroup = async (
  buildingId: number,
  data: { name: string; description?: string | null; is_default?: boolean },
): Promise<AccessGroup> => {
  const [id] = await db('access_groups').insert({ ...data, building_id: buildingId });
  return db('access_groups').where({ id }).first() as Promise<AccessGroup>;
};

export const updateGroup = async (
  buildingId: number,
  id: number,
  data: { name?: string; description?: string | null; is_default?: boolean },
): Promise<AccessGroup | undefined> => {
  await db('access_groups').where({ id, building_id: buildingId }).update({ ...data, updated_at: now() });
  return db('access_groups').where({ id }).first();
};

export async function setGroupDoors(
  buildingId: number,
  groupId: number,
  doors: { door_id: number; schedule_id?: number | null }[],
): Promise<{ ok: false; reason: string } | { ok: true; added: number; removed: number; affected: number }> {
  const group = await db('access_groups')
    .where({ id: groupId, building_id: buildingId })
    .whereNull('deleted_at')
    .first();
  if (!group) return { ok: false, reason: 'group_not_found' };

  const valid = await db('doors')
    .whereIn('id', doors.map((d) => d.door_id))
    .where({ building_id: buildingId })
    .whereNull('deleted_at')
    .pluck('id');
  if (valid.length !== doors.length) return { ok: false, reason: 'door_not_in_building' };

  const before = await db('access_group_doors').where({ group_id: groupId }).pluck('door_id');
  const after = doors.map((d) => d.door_id);
  const added = after.filter((d) => !before.includes(d));
  const removed = before.filter((d) => !after.includes(d));

  const members = await db('person_access_groups').where({ group_id: groupId }).pluck('person_id');

  await db.transaction(async (trx) => {
    await trx('access_group_doors').where({ group_id: groupId }).del();
    for (const d of doors) {
      await trx('access_group_doors').insert({
        group_id: groupId, door_id: d.door_id, schedule_id: d.schedule_id ?? null,
      });
    }

    if (removed.length && members.length) {
      await trx('access_policy_mirror')
        .where({ source_group_id: groupId })
        .whereIn('door_id', removed)
        .whereNotIn('sync_status', ['revoked'])
        .update({ sync_status: 'revoking' as SyncStatus, updated_at: now() });
    }
  });

  for (const personId of members) {
    await policyService.assignGroup(buildingId, personId, groupId);
  }

  return { ok: true, added: added.length, removed: removed.length, affected: members.length };
}

export async function deleteGroup(
  buildingId: number,
  id: number,
): Promise<{ revoking: number }> {
  const rows = await db('access_policy_mirror')
    .where({ source_group_id: id })
    .whereNotIn('sync_status', ['revoked']);

  await db.transaction(async (trx) => {
    await trx('access_policy_mirror')
      .whereIn('id', rows.map((r) => r.id))
      .update({ sync_status: 'revoking' as SyncStatus, updated_at: now() });
    await trx('person_access_groups').where({ group_id: id }).del();
    await trx('access_groups')
      .where({ id, building_id: buildingId })
      .update({ deleted_at: now(), updated_at: now() });
  });

  return { revoking: rows.length };
}
