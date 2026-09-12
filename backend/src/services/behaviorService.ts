import db from '../db';
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

export interface ScoreFactor {
  factor: string;
  share: number;
  delta: number;
  value: string;
  usual: string;
  detail: string;
}

export interface BehaviorScore {
  event_id: string;
  anomaly_score: number;
  is_anomaly: boolean;
  reason: string;
  rule_hits: RuleHit[];
  factors: ScoreFactor[];
  model_trained: boolean;
  events_in_baseline: number;
}

export interface BehaviorProfile {
  person_id: string;
  model_trained: boolean;
  events_in_baseline: number;
  min_events_to_fit: number;
  synthetic: boolean;
  first_seen: string | null;
  last_seen: string | null;
  usual_from: string | null;
  usual_to: string | null;
  hour_histogram: number[];
  doors: { door_code: string; count: number; share: number }[];
  weekend_share: number;
  night_share: number;
  median_gap_minutes: number;
  events_per_day: number;
}

export const isEnabled = () => Boolean(config.behavior.url);

export const status = () => ({
  enabled: isEnabled(),
  url: config.behavior.url || null,
});

async function call<T>(
  path: string,
  init: RequestInit,
  timeoutMs = config.behavior.timeoutMs,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.behavior.url}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const post = <T>(path: string, body: unknown, timeoutMs = config.behavior.timeoutMs) =>
  call<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);

const get = <T>(path: string, timeoutMs = config.behavior.timeoutMs) =>
  call<T>(path, { method: 'GET' }, timeoutMs);

export async function score(
  event: BehaviorEvent,
  buildingId: number | null,
): Promise<BehaviorScore | null> {
  if (!isEnabled()) return null;

  let verdict: BehaviorScore;
  try {
    verdict = await post<BehaviorScore>('/behavior/event', event);
  } catch (err) {
    logger.error(`[behavior] scoring failed for ${event.event_id}: ${(err as Error).message}`);
    return null;
  }

  try {
    await db('access_events').where({ id: event.event_id }).update({
      anomaly_score: verdict.anomaly_score,
      anomaly_flagged: verdict.is_anomaly,
      anomaly_reason: verdict.reason,
      anomaly_factors: JSON.stringify(verdict.factors ?? []),
    });
  } catch (err) {
    logger.error(`[behavior] could not store score for ${event.event_id}: ${(err as Error).message}`);
  }

  if (!verdict.is_anomaly) return verdict;

  logger.warn(
    `[behavior] anomaly ${verdict.anomaly_score.toFixed(2)} | did=${event.did} ` +
      `door=${event.door_code} | ${verdict.reason}`,
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
      anomaly_score: verdict.anomaly_score,
      reason: verdict.reason,
      rule_hits: verdict.rule_hits,
      factors: verdict.factors,
      model_trained: verdict.model_trained,
      events_in_baseline: verdict.events_in_baseline,
    },
  });

  return verdict;
}

export function scoreAsync(event: BehaviorEvent, buildingId: number | null): void {
  void score(event, buildingId).catch((err: Error) => {
    logger.error(`[behavior] scoring crashed for ${event.event_id}: ${err.message}`);
  });
}

export async function profile(personId: string): Promise<BehaviorProfile | null> {
  if (!isEnabled()) return null;
  try {
    return await get<BehaviorProfile>(`/behavior/profile/${encodeURIComponent(personId)}`);
  } catch (err) {
    logger.error(`[behavior] profile failed for ${personId}: ${(err as Error).message}`);
    return null;
  }
}

export async function train(personId: string, history: BehaviorEvent[]): Promise<unknown> {
  if (!isEnabled()) throw new Error('behaviour engine not configured');
  return post(`/behavior/train?person_id=${encodeURIComponent(personId)}`, history, 30_000);
}

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

export async function forget(personId: string): Promise<void> {
  if (!isEnabled()) return;
  try {
    await call(`/behavior/${encodeURIComponent(personId)}`, { method: 'DELETE' });
  } catch (err) {
    logger.error(`[behavior] forget failed for ${personId}: ${(err as Error).message}`);
  }
}
