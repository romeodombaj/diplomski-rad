import { apiFetch } from '@/lib/apiFetch';

// Building's CRUD lives under /auth (not a plain REST /api resource) because a
// building doubles as the switchable, sandboxed "current context" the rest of
// the gt-generated auth flow manages — see building-switcher.tsx.
const BASE = '/auth/buildings';

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
  return res.json();
}

export type Building = {
  id: number;
  name: string;
  address: string;
  contract_address: string;
};

export type BuildingPage = { data: Building[]; nextCursor: string | null; hasMore: boolean; total?: number };

type ApiBuilding = { id: number; name: string; address: string; contractAddress: string; sandboxBuildingId: number | null };

function fromApi(b: ApiBuilding): Building {
  return { id: b.id, name: b.name, address: b.address, contract_address: b.contractAddress };
}

function toApi(body: Partial<Building>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) out.name = body.name;
  if (body.address !== undefined) out.address = body.address;
  if (body.contract_address !== undefined) out.contractAddress = body.contract_address;
  return out;
}

// /auth/buildings returns a small, flat, unpaginated list (admins manage a handful
// of physical locations, not thousands) — search/sort/pagination happen client-side here.
function paginate(all: Building[], q: string, sortField: string, sortDir: 'asc' | 'desc'): BuildingPage {
  let rows = all;
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((b) => b.name.toLowerCase().includes(needle) || b.address.toLowerCase().includes(needle));
  }
  if (sortField && (sortField === 'name' || sortField === 'address' || sortField === 'contract_address' || sortField === 'id')) {
    rows = [...rows].sort((a, b) => {
      const av = String(a[sortField as keyof Building]);
      const bv = String(b[sortField as keyof Building]);
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  return { data: rows, nextCursor: null, hasMore: false, total: rows.length };
}

export const BuildingService = {
  getAll: async (q = '', _cursor: string | null = null, _limit = 20, _count = false, _filters: Record<string, string> = {}, sort = '', order: 'asc' | 'desc' = 'asc', _page = 1) => {
    const all = (await req<ApiBuilding[]>(BASE)).map(fromApi);
    return paginate(all, q, sort, order);
  },
  exportAll: async (_filters: Record<string, string> = {}, sort = '', order: 'asc' | 'desc' = 'asc') => {
    const all = (await req<ApiBuilding[]>(BASE)).map(fromApi);
    return paginate(all, '', sort, order);
  },
  getById: async (id: number) => {
    const all = (await req<ApiBuilding[]>(BASE)).map(fromApi);
    const found = all.find((b) => b.id === id);
    if (!found) throw new Error('404');
    return found;
  },
  create: (body: Partial<Building>) => req<{ id: number }>(BASE, { method: 'POST', body: JSON.stringify(toApi(body)) }),
  update: (id: number, body: Partial<Building>) => req<{ ok: true }>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(toApi(body)) }),
  remove: (id: number) => req<void>(`${BASE}/${id}`, { method: 'DELETE' }),
};
