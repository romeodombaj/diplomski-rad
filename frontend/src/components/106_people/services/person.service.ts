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

export type PersonType = 'employee' | 'contractor' | 'visitor' | 'service';
export type PersonStatus = 'invited' | 'enrolling' | 'active' | 'suspended' | 'offboarded';

export type Person = {
  id: string;
  building_id: number;
  full_name: string;
  employee_no: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  job_title: string | null;
  person_type: PersonType;
  status: PersonStatus;
  did: string | null;
  enrolled_at: string | null;
  employment_start: string | null;
  employment_end: string | null;
  created_at: string;
  updated_at: string;
};

export type PersonDevice = {
  id: number;
  person_id: string;
  did: string;
  platform: string | null;
  model: string | null;
  enrolled_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
};

/** The raw token comes back exactly once, at invite time. */
export type EnrollmentInvite = {
  token: string;
  expires_at: string;
  person_id: string;
};

export type PersonPage = { data: Person[]; nextCursor: string | null; hasMore: boolean; total?: number };

export const PersonService = {
  getAll: (q = '', cursor: string | null = null, limit = 20, count = false, filters: Record<string, string> = {}, sort = '', order: 'asc' | 'desc' = 'asc', page = 1) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (q) p.set('q', q);
    if (sort && sort !== 'id') p.set('page', String(page));
    else if (cursor) p.set('cursor', cursor);
    if (count) p.set('count', 'true');
    if (sort) { p.set('sort', sort); p.set('order', order); }
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    return req<PersonPage>(`${BASE}?${p}`);
  },
  exportAll: (filters: Record<string, string> = {}, sort = '', order: 'asc' | 'desc' = 'asc') => {
    const p = new URLSearchParams({ limit: '10000' });
    if (sort) { p.set('sort', sort); p.set('order', order); }
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    return req<PersonPage>(`${BASE}?${p}`);
  },
  getById: (id: string) => req<Person>(`${BASE}/${id}`),

  // Creating a person also mints their first enrolment token, so the QR can be
  // shown immediately without a second round-trip.
  create: (body: Partial<Person>) =>
    req<{ person: Person; invite: EnrollmentInvite }>(BASE, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Person>) => req<Person>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => req<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  // Lifecycle. Suspend keeps the DID valid so the person can return without
  // re-enrolling their face; offboard is terminal.
  suspend: (id: string, reason?: string) =>
    req<Person>(`${BASE}/${id}/suspend`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
  reinstate: (id: string) => req<Person>(`${BASE}/${id}/reinstate`, { method: 'POST' }),
  offboard: (id: string, reason?: string) =>
    req<Person>(`${BASE}/${id}/offboard`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),

  // Enrolment
  getEnrollment: (id: string) => req<{ active: boolean; expires_at?: string }>(`${BASE}/${id}/enrollment`),
  issueEnrollment: (id: string) => req<EnrollmentInvite>(`${BASE}/${id}/enrollment`, { method: 'POST' }),

  // Devices
  listDevices: (id: string) => req<PersonDevice[]>(`${BASE}/${id}/devices`),
  revokeDevice: (id: string, deviceId: number, reason?: string) =>
    req<PersonDevice>(`${BASE}/${id}/devices/${deviceId}/revoke`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
};
