/**
 * Reads over the access-event log.
 *
 * This is what the dashboard's audit page has been calling all along — the
 * frontend shipped `/api/audit-logs` against a backend route that did not
 * exist, so the page has never rendered a row.
 *
 * It is also the query surface the behaviour engine trains on: `forBehaviour`
 * returns one person's history in chronological order, which is exactly the
 * shape a per-user Isolation Forest is fitted against
 * (specs/BEHAVIOR_ENGINE_NOTES.md §1).
 */
import db from '../../db';
import type { AccessEvent, AccessEventPage, AccessEventSearchParams } from './access_event.types';

const SORTABLE = new Set(['occurred_at', 'decision', 'reason', 'door_code', 'did', 'id']);

export const getAll = async (
  buildingId: number,
  params: AccessEventSearchParams,
): Promise<AccessEventPage> => {
  const limit = Math.min(Number(params.limit) || 20, 200);
  const sortCol = params.sort && SORTABLE.has(params.sort) ? params.sort : 'occurred_at';
  const sortDir = params.order === 'asc' ? 'asc' : 'desc';

  // Joined so the table can show a name rather than a raw DID — the DID stays
  // in the row because a denied event often has no person to join to.
  const base = db('access_events as e')
    .where('e.building_id', buildingId)
    .leftJoin('people as p', 'p.id', 'e.person_id')
    .leftJoin('doors as d', 'd.id', 'e.door_id')
    .select(
      'e.*',
      'p.full_name as person_name',
      'p.employee_no as person_employee_no',
      'd.name as door_name',
    )
    .orderBy(`e.${sortCol}`, sortDir);

  if (params.decision) base.where('e.decision', params.decision);
  if (params.reason) base.where('e.reason', params.reason);
  if (params.did) base.where('e.did', params.did);
  if (params.person_id) base.where('e.person_id', params.person_id);
  if (params.door_code) base.where('e.door_code', params.door_code);
  if (params.occurred_at_from) base.where('e.occurred_at', '>=', params.occurred_at_from);
  if (params.occurred_at_to) base.where('e.occurred_at', '<=', params.occurred_at_to);
  if (params.q) {
    const q = `%${params.q}%`;
    base.where((b) =>
      b.where('e.did', 'like', q)
        .orWhere('e.door_code', 'like', q)
        .orWhere('e.reason', 'like', q)
        .orWhere('p.full_name', 'like', q),
    );
  }

  const page = Number(params.page) || 1;
  base.offset((page - 1) * limit);

  const rows = await base.clone().limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows) as AccessEvent[];

  let total: number | undefined;
  if (params.count === 'true') {
    // `.clear('offset')` and `.clear('limit')` matter: the clone inherits the
    // paging applied above, and `count(*) … limit -1 offset 20` returns no rows
    // at all, so `.first()` would be undefined and this would throw a 500 on
    // any page but the first.
    const row = await base
      .clone()
      .clearOrder()
      .clearSelect()
      .clear('limit')
      .clear('offset')
      .count('* as count')
      .first();
    total = Number((row as any)?.count ?? 0);
  }

  return { data, nextCursor: null, hasMore, total };
};

export const getById = async (buildingId: number, id: string): Promise<AccessEvent | undefined> =>
  db('access_events').where({ id, building_id: buildingId }).first();

/** Chronological history for one person — the behaviour engine's training set. */
export const forBehaviour = async (personId: string, since?: string): Promise<AccessEvent[]> => {
  const q = db('access_events').where({ person_id: personId }).orderBy('occurred_at', 'asc');
  if (since) q.where('occurred_at', '>=', since);
  return q;
};

export interface AccessEventStats {
  total: number;
  granted: number;
  denied: number;
  byReason: { reason: string; count: number }[];
  byDoor: { door_code: string; count: number }[];
  byHour: { hour: number; count: number }[];
}

/**
 * Dashboard summary. `byHour` is the time-of-day distribution the spec's
 * "analitika pristupa" panel calls for, and the same signal the behaviour
 * engine flags on (a 2am entry against a 9-to-5 baseline).
 */
export const stats = async (buildingId: number, since?: string): Promise<AccessEventStats> => {
  const scope = () => {
    const q = db('access_events').where({ building_id: buildingId });
    if (since) q.where('occurred_at', '>=', since);
    return q;
  };

  const [totals, byReason, byDoor, rows] = await Promise.all([
    scope().select('decision').count('* as count').groupBy('decision'),
    scope().select('reason').count('* as count').groupBy('reason').orderBy('count', 'desc'),
    scope().select('door_code').count('* as count').groupBy('door_code').orderBy('count', 'desc'),
    scope().select('occurred_at'),
  ]);

  const granted = Number(totals.find((t: any) => t.decision === 'granted')?.count ?? 0);
  const denied = Number(totals.find((t: any) => t.decision === 'denied')?.count ?? 0);

  // Bucketed in JS rather than SQL: strftime is sqlite-specific and this table
  // is small enough that the portability is worth more than the pushdown.
  const buckets = new Array(24).fill(0);
  for (const r of rows as { occurred_at: string }[]) {
    const h = new Date(r.occurred_at).getHours();
    if (!Number.isNaN(h)) buckets[h] += 1;
  }

  return {
    total: granted + denied,
    granted,
    denied,
    byReason: byReason.map((r: any) => ({ reason: r.reason, count: Number(r.count) })),
    byDoor: byDoor.map((r: any) => ({ door_code: r.door_code, count: Number(r.count) })),
    byHour: buckets.map((count, hour) => ({ hour, count })),
  };
};
