export type AccessDecisionValue = 'granted' | 'denied';

export interface AccessEvent {
  id: string;
  building_id: number | null;
  door_id: number | null;
  door_code: string;
  person_id: string | null;
  did: string;
  decision: AccessDecisionValue;
  reason: string;
  face_score: number | null;
  signature_verified: boolean;
  chain_checked: boolean;
  event_hash: string;
  signature: string | null;
  chain_tx: string | null;

  // Filled in by the behaviour engine after the fact, and null when it never
  // ran — a row with no score is unscored, not normal.
  anomaly_score: number | null;
  anomaly_flagged: boolean | null;
  anomaly_reason: string | null;
  /** JSON: the per-factor breakdown behind the score. */
  anomaly_factors: string | null;

  occurred_at: string;
  created_at: string;
  updated_at: string;
  // Present on list queries, which join people and doors for display.
  person_name?: string | null;
  person_employee_no?: string | null;
  door_name?: string | null;
}

export interface AccessEventSearchParams {
  q?: string;
  limit?: string;
  page?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  count?: string;
  decision?: AccessDecisionValue;
  reason?: string;
  did?: string;
  person_id?: string;
  door_code?: string;
  occurred_at_from?: string;
  occurred_at_to?: string;
}

export interface AccessEventPage {
  data: AccessEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}
