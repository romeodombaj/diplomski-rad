import { apiFetch } from '@/lib/apiFetch';

const BASE = '/api/devices';

export const DEVICE_KINDS = ['beacon', 'indicator', 'lock', 'other'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface Device {
  id: number;
  building_id: number;
  name: string;
  kind: DeviceKind;
  address: string | null;
  door_id: number | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined from the door, so the list can show where hardware lives. */
  door_name: string | null;
  door_code: string | null;
}

/** One raw topic heard while listening to the broker. */
export interface DiscoveredTopic {
  topic: string;
  messages: number;
  sample: string | null;
}

/**
 * One device heard while listening to the broker.
 *
 * The backend groups an ESPHome node's topics — discovery, debug and one per
 * entity — onto a single entry, so a ReSpeaker ring is one row rather than five.
 * `topics` carries the evidence for that grouping.
 */
export interface DiscoveredDevice {
  topic: string;
  name: string | null;
  ip: string | null;
  messages: number;
  sample: string | null;
  /** Already registered — the UI offers this as a hint, not an add. */
  known: boolean;
  topics: DiscoveredTopic[];
}

export interface DevicePage {
  data: Device[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`);
  return (body.data ?? body) as T;
}

export const DeviceService = {
  /**
   * The list endpoint returns the page fields at the top level
   * (`{ success, data, nextCursor, hasMore }`), not nested under `data` — so it
   * cannot go through `req`, which unwraps `body.data` and would hand back just
   * the array with `.data` undefined.
   */
  getAll: async (params: Record<string, string> = {}): Promise<DevicePage> => {
    const qs = new URLSearchParams({ count: 'true', limit: '100', ...params }).toString();
    const res = await apiFetch(`${BASE}?${qs}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`);
    return {
      data: Array.isArray(body.data) ? body.data : [],
      nextCursor: body.nextCursor ?? null,
      hasMore: Boolean(body.hasMore),
      total: body.total,
    };
  },
  create: (body: Partial<Device>) =>
    req<Device>(BASE, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: Partial<Device>) =>
    req<Device>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => req<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  /**
   * Listen to the broker and report what is talking. Slow by nature — the
   * request stays open for the listen window rather than returning a job to
   * poll, so give it a generous client timeout.
   */
  scan: (seconds = 8) =>
    req<DiscoveredDevice[]>(`${BASE}/scan`, {
      method: 'POST',
      body: JSON.stringify({ seconds }),
    }),

  /** Everything attached to one door. */
  forDoor: (doorId: number) => req<Device[]>(`/api/doors/${doorId}/devices`),
};
