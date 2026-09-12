import db from '../../db';
import logger from '../../lib/logger';
import { jsonParseNull } from '../../utils/response';
import * as behavior from '../../services/behaviorService';
import type { ScoreFactor } from '../../services/behaviorService';
import type { AccessEvent } from '../access_event/access_event.types';

const WINDOW = 500;
const RECENT = 20;
const BACKFILL_TAIL = 25;

export interface ScoredEvent {
  id: string;
  occurred_at: string;
  door_code: string;
  door_name: string | null;
  decision: string;
  reason: string;
  anomaly_score: number | null;
  anomaly_flagged: boolean;
  anomaly_reason: string | null;
  factors: ScoreFactor[];
}

export interface ObservedBaseline {
  total: number;
  granted: number;
  denied: number;
  scored: number;
  flagged: number;
  first_seen: string | null;
  last_seen: string | null;
  byHour: { hour: number; count: number }[];
  byDoor: { door_code: string; count: number; share: number }[];
  events_per_day: number;
}

export interface PersonBehaviour {
  person_id: string;
  engine: { enabled: boolean; reachable: boolean };
  profile: behavior.BehaviorProfile | null;
  observed: ObservedBaseline;
  latest: ScoredEvent | null;
  recent: ScoredEvent[];
}

const parseFactors = (raw: string | null): ScoreFactor[] =>
  (raw ? jsonParseNull<ScoreFactor[]>(raw) : null) ?? [];

const toScored = (row: AccessEvent): ScoredEvent => ({
  id: row.id,
  occurred_at: row.occurred_at,
  door_code: row.door_code,
  door_name: row.door_name ?? null,
  decision: row.decision,
  reason: row.reason,
  anomaly_score: row.anomaly_score,
  anomaly_flagged: Boolean(row.anomaly_flagged),
  anomaly_reason: row.anomaly_reason,
  factors: parseFactors(row.anomaly_factors),
});

function observe(rows: AccessEvent[]): ObservedBaseline {
  const ordered = [...rows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const total = ordered.length;

  const hours = new Array(24).fill(0);
  const doors = new Map<string, number>();
  for (const row of ordered) {
    const hour = new Date(row.occurred_at).getHours();
    if (!Number.isNaN(hour)) hours[hour] += 1;
    doors.set(row.door_code, (doors.get(row.door_code) ?? 0) + 1);
  }

  const first = ordered[0]?.occurred_at ?? null;
  const last = ordered[total - 1]?.occurred_at ?? null;
  const spanDays = first && last
    ? Math.max(1, (Date.parse(last) - Date.parse(first)) / 86_400_000)
    : 1;

  return {
    total,
    granted: ordered.filter((r) => r.decision === 'granted').length,
    denied: ordered.filter((r) => r.decision === 'denied').length,
    scored: ordered.filter((r) => r.anomaly_score !== null).length,
    flagged: ordered.filter((r) => r.anomaly_flagged).length,
    first_seen: first,
    last_seen: last,
    byHour: hours.map((count: number, hour: number) => ({ hour, count })),
    byDoor: [...doors.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([door_code, count]) => ({
        door_code,
        count,
        share: total ? Number((count / total).toFixed(4)) : 0,
      })),
    events_per_day: Number((total / spanDays).toFixed(2)),
  };
}

const backfilling = new Set<string>();

export async function backfill(personId: string): Promise<number> {
  if (!behavior.isEnabled() || backfilling.has(personId)) return 0;
  backfilling.add(personId);
  try {
    const history = (await db('access_events')
      .where({ person_id: personId })
      .orderBy('occurred_at', 'asc')
      .limit(WINDOW)) as AccessEvent[];

    const toEvent = (row: AccessEvent) => ({
      event_id: row.id,
      person_id: personId,
      did: row.did,
      door_code: row.door_code,
      building_id: row.building_id,
      timestamp: new Date(row.occurred_at).toISOString(),
      success: row.decision === 'granted',
    });

    const tail = history.slice(-BACKFILL_TAIL);
    const baseline = history.slice(0, -tail.length);
    if (!baseline.length) return 0;

    await behavior.train(personId, baseline.map(toEvent));

    let scored = 0;
    for (const row of tail) {
      const verdict = await behavior.score(toEvent(row), row.building_id);
      if (verdict) scored += 1;
    }
    return scored;
  } catch (err) {
    logger.error(`[behavior] backfill failed for ${personId}: ${(err as Error).message}`);
    return 0;
  } finally {
    backfilling.delete(personId);
  }
}

export async function forPerson(personId: string): Promise<PersonBehaviour> {
  let rows = (await db('access_events as e')
    .where('e.person_id', personId)
    .leftJoin('doors as d', 'd.id', 'e.door_id')
    .select('e.*', 'd.name as door_name')
    .orderBy('e.occurred_at', 'desc')
    .limit(WINDOW)) as AccessEvent[];

  let scored = rows.filter((r) => r.anomaly_score !== null).map(toScored);
  let profile = await behavior.profile(personId);

  if (profile && profile.events_in_baseline === 0 && rows.length >= profile.min_events_to_fit) {
    if (await backfill(personId)) {
      rows = (await db('access_events as e')
        .where('e.person_id', personId)
        .leftJoin('doors as d', 'd.id', 'e.door_id')
        .select('e.*', 'd.name as door_name')
        .orderBy('e.occurred_at', 'desc')
        .limit(WINDOW)) as AccessEvent[];
      scored = rows.filter((r) => r.anomaly_score !== null).map(toScored);
      profile = (await behavior.profile(personId)) ?? profile;
    }
  }

  return {
    person_id: personId,
    engine: { enabled: behavior.isEnabled(), reachable: profile !== null },
    profile,
    observed: observe(rows),
    latest: scored[0] ?? null,
    recent: scored.slice(0, RECENT),
  };
}

export async function train(personId: string): Promise<unknown> {
  const history = (await db('access_events')
    .where({ person_id: personId })
    .orderBy('occurred_at', 'asc')
    .limit(WINDOW)) as AccessEvent[];

  return behavior.train(
    personId,
    history.map((row) => ({
      event_id: row.id,
      person_id: personId,
      did: row.did,
      door_code: row.door_code,
      building_id: row.building_id,
      timestamp: new Date(row.occurred_at).toISOString(),
      success: row.decision === 'granted',
    })),
  );
}

export async function seed(
  person: { id: string; did: string | null; building_id: number },
  days = 14,
): Promise<unknown> {
  const doors = (await db('doors')
    .where({ building_id: person.building_id })
    .whereNull('deleted_at')
    .orderBy('id', 'asc')
    .pluck('door_code')) as string[];

  const isEntry = (code: string) => /MAIN|ENTRY|ENTRANCE|LOBBY|ULAZ|FRONT|GATE|RECEPTION/i.test(code);
  const entry = doors.find(isEntry) ?? doors[0] ?? 'MAIN-01';
  const interior = doors.filter((code) => code !== entry && !isEntry(code)).slice(0, 3);

  return behavior.seed({
    person_id: person.id,
    did: person.did ?? person.id,
    days,
    building_id: person.building_id,
    entry_door: entry,
    interior_doors: interior,
  });
}
