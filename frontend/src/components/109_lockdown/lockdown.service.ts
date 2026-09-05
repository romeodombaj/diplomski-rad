import { apiFetch } from '@/lib/apiFetch';

const BASE = '/api/lockdown';

export interface LockdownState {
  building: { active: boolean; since: string | null; by: string | null };
  doors: {
    id: number; name: string; door_code: string;
    locked_down: boolean; since: string | null;
  }[];
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`);
  return body.data as T;
}

export const LockdownService = {
  get: () => req<LockdownState>(BASE),
  setBuilding: (active: boolean) =>
    req<LockdownState>(`${BASE}/building`, { method: 'POST', body: JSON.stringify({ active }) }),
  setDoor: (doorId: number, lockedDown: boolean) =>
    req<LockdownState>(`${BASE}/doors/${doorId}`, {
      method: 'POST', body: JSON.stringify({ locked_down: lockedDown }),
    }),
};
