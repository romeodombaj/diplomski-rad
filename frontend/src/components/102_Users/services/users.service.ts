import { apiFetch } from '@/lib/apiFetch';

const BASE = '/auth/users';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  return (json.data ?? json) as T;
}

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  has_password: boolean;
  created_at: string;
};

export const UsersService = {
  getAll: () => req<AppUser[]>(BASE),
  create: (body: { email: string; name: string; role: string; password: string; allBuildings?: boolean; buildingIds?: number[] }) =>
    req<void>(BASE, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { name?: string; role?: string }) =>
    req<void>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => req<void>(`${BASE}/${id}`, { method: 'DELETE' }),
  getBuildings: (id: string) => req<{ allBuildings: boolean; buildingIds: number[] }>(`${BASE}/${id}/buildings`),
  setBuildings: (id: string, body: { allBuildings: boolean; buildingIds: number[] }) =>
    req<void>(`${BASE}/${id}/buildings`, { method: 'PUT', body: JSON.stringify(body) }),
};
