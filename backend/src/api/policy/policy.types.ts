export type SyncStatus = 'pending' | 'synced' | 'failed' | 'revoking' | 'revoked';
export type GrantSource = 'group' | 'direct';

export interface MirrorRow {
  id: number;
  person_id: string;
  door_id: number;
  did: string;
  door_code: string;
  source: GrantSource;
  source_group_id: number | null;
  schedule_id: number | null;
  schedule_hash: string | null;
  chain_policy_id: string | null;
  chain_tx_hash: string | null;
  start_time: number;
  end_time: number;
  sync_status: SyncStatus;
  sync_error: string | null;
  last_synced_at: string | null;
  attempts: number;
  granted_by_operator_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccessGroup {
  id: number;
  building_id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AccessScheduleRow {
  id: number;
  building_id: number;
  name: string;
  rrule: string;
  start_minute: number;
  end_minute: number;
  timezone: string;
}

export interface DriftRow {
  id: number;
  building_id: number;
  kind: 'unauthorised' | 'missing_on_chain' | 'mismatch';
  severity: 'high' | 'medium';
  did: string | null;
  door_code: string | null;
  chain_policy_id: string | null;
  mirror_id: number | null;
  detail: string | null;
  detected_at: string;
  resolved_at: string | null;
}
