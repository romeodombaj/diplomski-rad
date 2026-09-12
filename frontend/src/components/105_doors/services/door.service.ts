import { apiFetch } from '@/lib/apiFetch';

const BASE = '/api/doors';

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

export type Door = {
  id: number;
  building_id: number;
  name: string;
  door_code: string;
  mqtt_topic: string;
  active: boolean;
  locked_down?: boolean;
  locked_down_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type DoorPage = { data: Door[]; nextCursor: string | null; hasMore: boolean; total?: number };

export type UnlockResult = {
  unlocked: boolean;
  event_id: string;
  event_hash: string;
  door: { id: number; code: string; name: string };
};

export const DoorService = {
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
    return req<DoorPage>(`${BASE}?${p}`);
  },
  exportAll: (filters: Record<string, string> = {}, sort = '', order: 'asc' | 'desc' = 'asc') => {
    const p = new URLSearchParams({ limit: '10000' });
    if (sort) { p.set('sort', sort); p.set('order', order); }
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    return req<DoorPage>(`${BASE}?${p}`);
  },
  getById: (id: number) => req<Door>(`${BASE}/${id}`),
  create:  (body: Partial<Door>)     => req<Door>(BASE,           { method: 'POST',   body: JSON.stringify(body) }),
  update:  (id: number, body: Partial<Door>) => req<Door>(`${BASE}/${id}`, { method: 'PATCH',    body: JSON.stringify(body) }),
  remove:  (id: number)                   => req<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  unlock: (id: number) => req<UnlockResult>(`${BASE}/${id}/unlock`, { method: 'POST' }),
};
