import { apiFetch } from '@/lib/apiFetch';

const BASE = '/api/people';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body.message || `${res.status}`);
    err.fields = body.fields ?? {};
    throw err;
  }
  const json = await res.json();
  return (json.data ?? json) as T;
}

/**
 * One driver behind a score. `factor` is a key, not a sentence, so the reason
 * an operator reads is in their own language; `value` and `usual` are the two
 * things being compared, which is what makes a score checkable rather than
 * something to be believed.
 */
export type ScoreFactor = {
  factor: 'time_of_day' | 'day_of_week' | 'door' | 'interval' | 'first_of_day' | string;
  /** Share of everything pushing this event towards "unusual", 0..1. */
  share: number;
  delta: number;
  value: string;
  usual: string;
  /** The engine's own English sentence — a fallback, not the display text. */
  detail: string;
};

export type ScoredEvent = {
  id: string;
  occurred_at: string;
  door_code: string;
  door_name: string | null;
  decision: string;
  reason: string;
  /** 0..1, and 0.5 is the model's own boundary rather than a display midpoint. */
  anomaly_score: number | null;
  anomaly_flagged: boolean;
  anomaly_reason: string | null;
  factors: ScoreFactor[];
};

/** The baseline the model was fitted on, as the engine describes it. */
export type BehaviourProfile = {
  person_id: string;
  model_trained: boolean;
  events_in_baseline: number;
  min_events_to_fit: number;
  /** Generated history rather than observed — shown, never hidden. */
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
};

/** What the backend recorded, independent of whether the engine is up. */
export type ObservedBaseline = {
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
};

export type PersonBehaviour = {
  person_id: string;
  engine: { enabled: boolean; reachable: boolean };
  profile: BehaviourProfile | null;
  observed: ObservedBaseline;
  latest: ScoredEvent | null;
  recent: ScoredEvent[];
};

export const BehaviorService = {
  forPerson: (id: string) => req<PersonBehaviour>(`${BASE}/${id}/behavior`),

  /** Fit from the person's real history — the honest baseline. */
  train: (id: string) =>
    req<{ events: number; model_fitted: boolean; min_events_to_fit: number }>(
      `${BASE}/${id}/behavior/train`, { method: 'POST' },
    ),

  /** Generate one instead, for a person with no history yet. */
  seed: (id: string, days = 14) =>
    req<{ events_generated: number; model_fitted: boolean; synthetic: boolean }>(
      `${BASE}/${id}/behavior/seed`, { method: 'POST', body: JSON.stringify({ days }) },
    ),
};
