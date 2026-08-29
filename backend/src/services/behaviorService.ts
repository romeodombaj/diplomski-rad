/**
 * Forwards access decisions to the behaviour engine and relays what comes back.
 *
 * Fire-and-forget on purpose. The engine scores an event *after* the door
 * decision is already made and recorded, so a slow or dead engine must never
 * stop someone getting into a building — it produces an alert, not a verdict.
 * Everything here degrades to a no-op when BEHAVIOR_ENGINE_URL is unset.
 */
import logger from '../lib/logger';
import { config } from '../config/conifg';
import * as events from './eventBus';

export interface BehaviorEvent {
  event_id: string;
  person_id: string | null;
  did: string;
  door_code: string;
  building_id: number | null;
  timestamp: string;
  success: boolean;
}

export interface RuleHit {
  rule: string;
  severity: 'high' | 'medium';
  reason: string;
}

export interface BehaviorScore {
  event_id: string;
  anomaly_score: number;
  is_anomaly: boolean;
  reason: string;
  rule_hits: RuleHit[];
  model_trained: boolean;
  events_in_baseline: number;
}

export const isEnabled = () => Boolean(config.behavior.url);

export const status = () => ({
  enabled: isEnabled(),
  url: config.behavior.url || null,
});

async function post<T>(path: string, body: unknown, timeoutMs = config.behavior.timeoutMs): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.behavior.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Score an event and, if it is anomalous, publish an alert.
 *
 * Never throws and never awaits into the caller's critical path — call it
 * without `await` from the access path.
 */
export function scoreAsync(event: BehaviorEvent, buildingId: number | null): void {
  if (!isEnabled()) return;

  post<BehaviorScore>('/behavior/event', event)
    .then((score) => {
      if (!score.is_anomaly) return;

      logger.warn(
        `[behavior] anomaly ${score.anomaly_score.toFixed(2)} | did=${event.did} ` +
          `door=${event.door_code} | ${score.reason}`,
      );

      events.publish({
        type: 'anomaly',
        buildingId,
        payload: {
          event_id: event.event_id,
          did: event.did,
          person_id: event.person_id,
          door_code: event.door_code,
          occurred_at: event.timestamp,
          anomaly_score: score.anomaly_score,
          reason: score.reason,
          rule_hits: score.rule_hits,
          // Surfaced so nobody reads a score from a 20-event synthetic baseline
          // as though it came from months of observation.
          model_trained: score.model_trained,
          events_in_baseline: score.events_in_baseline,
        },
      });
    })
    .catch((err: Error) => {
      // An unreachable engine is an operational fault, not an access failure.
      logger.error(`[behavior] scoring failed for ${event.event_id}: ${err.message}`);
    });
}

/** Fit a person's baseline from history the backend already holds. */
export async function train(personId: string, history: BehaviorEvent[]): Promise<unknown> {
  if (!isEnabled()) throw new Error('behaviour engine not configured');
  return post(`/behavior/train?person_id=${encodeURIComponent(personId)}`, history, 30_000);
}

/**
 * Seed a synthetic baseline.
 *
 * The cold-start answer from specs/BEHAVIOR_ENGINE_NOTES.md: a real baseline
 * needs one to two weeks of usage that will not exist before a demo.
 */
export async function seed(body: {
  person_id: string;
  did: string;
  days?: number;
  building_id?: number;
  entry_door?: string;
  interior_doors?: string[];
}): Promise<unknown> {
  if (!isEnabled()) throw new Error('behaviour engine not configured');
  return post('/behavior/seed', body, 30_000);
}

/** Drop a person's model — used on offboard, so a retired identity leaves nothing. */
export async function forget(personId: string): Promise<void> {
  if (!isEnabled()) return;
  try {
    await fetch(`${config.behavior.url}/behavior/${encodeURIComponent(personId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    logger.error(`[behavior] forget failed for ${personId}: ${(err as Error).message}`);
  }
}
