import { apiFetch } from '@/lib/apiFetch';

const BASE = '/api/audit-logs';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  return (json.data ?? json) as T;
}

export type AuditLog = {
  id: string;
  building_id: number | null;
  door_id: number | null;
  door_code: string;
  door_name: string | null;
  person_id: string | null;
  person_name: string | null;
  person_employee_no: string | null;
  did: string;
  decision: 'granted' | 'denied';
  reason: string;
  face_score: number | null;
  signature_verified: boolean;
  chain_checked: boolean;
  event_hash: string;
  chain_tx: string | null;
  occurred_at: string;
  created_at: string;
};

export type AccessStats = {
  total: number;
  granted: number;
  denied: number;
  byReason: { reason: string; count: number }[];
  byDoor: { door_code: string; count: number }[];
  byHour: { hour: number; count: number }[];
};

export type AuditLogPage = { data: AuditLog[]; nextCursor: string | null; hasMore: boolean; total?: number };

export const AuditLogService = {
  getAll: (q = '', cursor: string | null = null, limit = 20, count = false, filters: Record<string, string> = {}, sort = '', order: 'asc' | 'desc' = 'asc', page = 1) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (q) p.set('q', encodeURIComponent(q));
    if (sort && sort !== 'id') {
      p.set('page', String(page));
    } else if (cursor) {
      p.set('cursor', cursor);
    }
    if (count) p.set('count', 'true');
    if (sort) { p.set('sort', sort); p.set('order', order); }
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    return req<AuditLogPage>(`${BASE}?${p}`);
  },
  create:  (body: Partial<AuditLog>)     => req<AuditLog>(BASE,           { method: 'POST',   body: JSON.stringify(body) }),
  getById: (id: string) => req<AuditLog>(`${BASE}/${id}`),

  stats: (since?: string) =>
    req<AccessStats>(`${BASE}/stats${since ? `?since=${encodeURIComponent(since)}` : ''}`),
};
