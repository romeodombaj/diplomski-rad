import { apiFetch } from '@/lib/apiFetch';

const BASE = '/api/policies';

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
 * How far a grant has got towards the chain. A policy only actually opens a
 * door once it is `synced` — everything else is a promise the chain has not
 * accepted yet, which is why the UI shows this rather than hiding it.
 */
export type SyncStatus = 'pending' | 'synced' | 'failed' | 'revoking' | 'revoked';
export type GrantSource = 'group' | 'direct';

export type AccessGroup = {
  id: number;
  building_id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  door_count: number;
  member_count: number;
  /** On-chain transactions one more member costs. */
  fan_out: number;
};

export type GroupDoor = {
  door_id: number;
  door_name: string;
  door_code: string;
  schedule_id: number | null;
  schedule_name: string | null;
};

export type GroupMember = {
  id: string;
  full_name: string;
  employee_no: string | null;
  status: string;
  granted_at: string;
};

export type GroupDetail = AccessGroup & { doors: GroupDoor[]; members: GroupMember[] };

export type AccessSchedule = {
  id: number;
  building_id: number;
  name: string;
  rrule: string;
  start_minute: number;
  end_minute: number;
  timezone: string;
};

export type EffectiveAccess = {
  /** The mirror row id — what a revoke targets. */
  id: number;
  door_id: number;
  door_code: string;
  door_name: string;
  source: GrantSource;
  /** Group name, or "direct grant" — what to change to take this away. */
  source_name: string;
  schedule: string;
  schedule_id: number | null;
  chain_policy_id: string | null;
  sync_status: SyncStatus;
  open_now: boolean;
};

export type DoorAccessRow = {
  id: number;
  person_id: string;
  did: string;
  full_name: string | null;
  employee_no: string | null;
  person_status: string;
  source: GrantSource;
  source_name: string;
  schedule: string;
  sync_status: SyncStatus;
  chain_policy_id: string | null;
  open_now: boolean;
};

export type DriftRow = {
  id: number;
  kind: 'unauthorised' | 'missing_on_chain' | 'mismatch';
  severity: 'high' | 'medium';
  did: string | null;
  door_code: string | null;
  chain_policy_id: string | null;
  detail: string | null;
  detected_at: string;
  resolved_at: string | null;
};

export type SyncHealth = {
  chain: { enabled: boolean; reason?: string; network: string; addresses: Record<string, string> | null; signer: string | null };
  byStatus: Record<string, number>;
  pending: number;
  failed: number;
  synced: number;
  drift: { open: number; unauthorised: number };
};

export const PolicyService = {
  health: () => req<SyncHealth>(`${BASE}/health`),
  sync: () => req<{ granted: number; revoked: number; failed: number; skipped: boolean }>(
    `${BASE}/sync`, { method: 'POST' }),
  reconcile: () => req<{ checked: number; unauthorised: number; missingOnChain: number; mismatched: number; skipped: boolean }>(
    `${BASE}/reconcile`, { method: 'POST' }),

  listDrift: (includeResolved = false) =>
    req<DriftRow[]>(`${BASE}/drift${includeResolved ? '?include_resolved=true' : ''}`),
  resolveDrift: (id: number) => req<void>(`${BASE}/drift/${id}/resolve`, { method: 'POST' }),

  listSchedules: () => req<AccessSchedule[]>(`${BASE}/schedules`),
  createSchedule: (body: Omit<AccessSchedule, 'id' | 'building_id'>) =>
    req<AccessSchedule>(`${BASE}/schedules`, { method: 'POST', body: JSON.stringify(body) }),
  deleteSchedule: (id: number) => req<void>(`${BASE}/schedules/${id}`, { method: 'DELETE' }),

  listGroups: () => req<AccessGroup[]>(`${BASE}/groups`),
  getGroup: (id: number) => req<GroupDetail>(`${BASE}/groups/${id}`),
  createGroup: (body: { name: string; description?: string | null }) =>
    req<AccessGroup>(`${BASE}/groups`, { method: 'POST', body: JSON.stringify(body) }),
  updateGroup: (id: number, body: { name?: string; description?: string | null }) =>
    req<AccessGroup>(`${BASE}/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setGroupDoors: (id: number, doors: { door_id: number; schedule_id?: number | null }[]) =>
    req<{ added: number; removed: number; affected: number }>(
      `${BASE}/groups/${id}/doors`, { method: 'PUT', body: JSON.stringify({ doors }) }),
  deleteGroup: (id: number) =>
    req<{ revoking: number }>(`${BASE}/groups/${id}`, { method: 'DELETE' }),

  grantDirect: (body: { person_id: string; door_id: number; schedule_id?: number | null }) =>
    req<{ id: number; sync_status: SyncStatus }>(`${BASE}/grants`, { method: 'POST', body: JSON.stringify(body) }),
  assignGroup: (person_id: string, group_id: number) =>
    req<{ created: number }>(`${BASE}/assignments`, { method: 'POST', body: JSON.stringify({ person_id, group_id }) }),
  unassignGroup: (person_id: string, group_id: number) =>
    req<{ revoking: number }>(`${BASE}/assignments/${person_id}/${group_id}`, { method: 'DELETE' }),
  revoke: (mirrorId: number) => req<void>(`${BASE}/${mirrorId}/revoke`, { method: 'POST' }),

  effectiveAccess: (personId: string) =>
    req<EffectiveAccess[]>(`/api/people/${personId}/effective-access`),
  whoHasAccess: (doorId: number) =>
    req<DoorAccessRow[]>(`/api/doors/${doorId}/who-has-access`),
};
