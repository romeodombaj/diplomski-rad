import { apiFetch } from '@/lib/apiFetch';

// Vite proxies /api → http://localhost:5000 (see vite.config.ts)
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
  id: number;
  user_email: string | null;
  project_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  ip: string | null;
  created_at: string;
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
  update:  (id: number, body: Partial<AuditLog>) => req<AuditLog>(`${BASE}/${id}`, { method: 'PUT',    body: JSON.stringify(body) }),
  remove:  (id: number)                   => req<void>(`${BASE}/${id}`, { method: 'DELETE' }),
};
