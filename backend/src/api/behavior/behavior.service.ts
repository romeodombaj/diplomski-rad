/**
 * What the dashboard shows on a person's behaviour tab.
 *
 * Two halves, deliberately kept apart. The *observed* half is computed here
 * from `access_events` — the durable record this backend owns — and is always
 * available, even with the engine switched off or unreachable. The *model* half
 * comes from the Python engine and can be missing at any moment.
 *
 * That split is the point: a score with nothing to check it against is not
 * something an operator can act on, and the evidence it was measured from must
 * not disappear when a microservice does.
 */
import db from '../../db';
import logger from '../../lib/logger';
import { jsonParseNull } from '../../utils/response';
import * as behavior from '../../services/behaviorService';
import type { ScoreFactor } from '../../services/behaviorService';
import type { AccessEvent } from '../access_event/access_event.types';

/** How much history the observed baseline is built from. */
const WINDOW = 500;
/** How many scored events the tab lists. */
const RECENT = 20;
/**
 * How many of the most recent events a backfill scores individually.
 *
 * The rest become the baseline. Scoring everything would be both slow and
 * wrong: the earliest events would be scored against a model fitted on almost
 * nothing, and the tab would lead with a number produced by a model that had
 * not yet learned anything.
 */
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

/** The person's own history, as the backend recorded it. */
export interface ObservedBaseline {
  total: number;
  granted: number;
  denied: number;
  /** Of those, how many the engine actually scored — usually far fewer. */
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
  /** The most recently scored event — the number the tab leads with. */
  latest: ScoredEvent | null;
  recent: ScoredEvent[];
}

// A malformed blob costs the breakdown, not the page.
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
  // At least a day, so a person seen twice in one morning does not report a
  // rate of several hundred events a day.
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

/**
 * People currently being backfilled, so two tab opens do not race.
 *
 * The engine's history is a list it appends to, so running the same backfill
 * twice concurrently would train it on this person's week twice over and
 * halve the apparent rarity of everything in it.
 */
const backfilling = new Set<string>();

/**
 * Teach the engine a person it has never seen, from history already recorded.
 *
 * The engine keeps its working history in memory, so a restart forgets every
 * baseline while the events that produced it are still sitting in the
 * database. Without this, a demo would show an empty behaviour tab for a person
 * with two months of history behind them, and the fix would be to re-run a
 * seed — which is the wrong answer, because the history is not missing.
 *
 * The order is the point: fit on everything but the tail, then score the tail
 * one event at a time, in the order it happened. That is exactly what would
 * have happened had the engine been running all along, so the numbers are the
 * model's own and not a reconstruction.
 */
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
      // Sequential on purpose: each score is measured against the history up
      // to that point, which is only true if they arrive in order.
      const verdict = await behavior.score(toEvent(row), row.building_id);
      if (verdict) scored += 1;
    }
    return scored;
  } catch (err) {
    // A backfill is an improvement to the page, never a precondition for it.
    logger.error(`[behavior] backfill failed for ${personId}: ${(err as Error).message}`);
    return 0;
  } finally {
    backfilling.delete(personId);
  }
}

/**
 * Everything known about one person's behaviour.
 *
 * The engine is asked last and its failure is reported rather than thrown:
 * `engine.reachable` false with a full observed baseline is a useful page, and
 * a 502 is not.
 */
export async function forPerson(personId: string): Promise<PersonBehaviour> {
  let rows = (await db('access_events as e')
    .where('e.person_id', personId)
    .leftJoin('doors as d', 'd.id', 'e.door_id')
    .select('e.*', 'd.name as door_name')
    .orderBy('e.occurred_at', 'desc')
    .limit(WINDOW)) as AccessEvent[];

  let scored = rows.filter((r) => r.anomaly_score !== null).map(toScored);
  let profile = await behavior.profile(personId);

  // The engine is up but has never heard of this person, while the backend is
  // holding enough history to fit them. That is the state after any engine
  // restart, and after a seed — teach it from what is already recorded rather
  // than showing an empty tab for somebody with months behind them.
  if (profile && profile.events_in_baseline === 0 && rows.length >= profile.min_events_to_fit) {
    if (await backfill(personId)) {
      // Re-read into `rows` itself, not into a local: the observed baseline is
      // computed from it below, and reporting "0 scored" on the very page load
      // that just scored twenty-five events is the one number a reader would
      // check first.
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

/**
 * Fit this person's baseline from the history already in `access_events`.
 *
 * The honest path, as opposed to seeding: it uses what actually happened. It
 * only produces a usable model once enough has — the engine reports back how
 * many events it got and whether that was enough.
 */
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

/**
 * Seed a synthetic baseline for this person.
 *
 * The cold-start answer from specs/BEHAVIOR_ENGINE_NOTES.md §1: a real baseline
 * wants one to two weeks of usage, and a model fitted on four events flags
 * everything. The doors come from the person's own building so the generated
 * history at least names real ones, and the engine marks everything it
 * generates as synthetic so a seeded baseline is never read as an observed one.
 */
export async function seed(
  person: { id: string; did: string | null; building_id: number },
  days = 14,
): Promise<unknown> {
  const doors = (await db('doors')
    .where({ building_id: person.building_id })
    .whereNull('deleted_at')
    .orderBy('id', 'asc')
    .pluck('door_code')) as string[];

  // Same hints the engine's rules use for "did they pass an entrance first" —
  // a seeded history that never touches a main door would train the model on a
  // pattern the rules call suspicious.
  // Must match ENTRY_DOOR_HINTS in behavior-engine/app/rules.py. If this list
  // is narrower, a seeded history enters through a door the engine does not
  // consider an entrance, and its own rules call the result suspicious.
  const isEntry = (code: string) => /MAIN|ENTRY|ENTRANCE|LOBBY|ULAZ|FRONT|GATE|RECEPTION/i.test(code);
  const entry = doors.find(isEntry) ?? doors[0] ?? 'MAIN-01';
  const interior = doors.filter((code) => code !== entry && !isEntry(code)).slice(0, 3);

  return behavior.seed({
    person_id: person.id,
    // A person who has not enrolled has no DID; the engine keys on the person
    // either way, and the field is only carried through to the events.
    did: person.did ?? person.id,
    days,
    building_id: person.building_id,
    entry_door: entry,
    interior_doors: interior,
  });
}
