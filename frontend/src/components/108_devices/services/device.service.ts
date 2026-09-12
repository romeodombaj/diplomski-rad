import { apiFetch } from '@/lib/apiFetch';

const BASE = '/api/devices';

export const DEVICE_KINDS = ['proximity', 'lock'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const LOCK_PROFILES = [
  'native_json', 'tasmota', 'shelly', 'esphome_switch', 'zigbee2mqtt', 'custom',
] as const;
export type LockProfile = (typeof LOCK_PROFILES)[number];

export interface Device {
  id: number;
  building_id: number;
  name: string;
  kind: DeviceKind;
  address: string | null;
  door_id: number | null;
  active: boolean;
  notes: string | null;
  lock_profile: string | null;
  command_topic: string | null;
  unlock_payload: string | null;
  lock_payload: string | null;
  hold_seconds: number | null;
  created_at: string;
  updated_at: string;
  door_name: string | null;
  door_code: string | null;
}

export interface DiscoveredTopic {
  topic: string;
  messages: number;
  sample: string | null;
}

export interface DiscoveredDevice {
  source: 'mqtt' | 'tuya';
  topic: string;
  name: string | null;
  ip: string | null;
  messages: number;
  sample: string | null;
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

  scan: (seconds = 8) =>
    req<DiscoveredDevice[]>(`${BASE}/scan`, {
      method: 'POST',
      body: JSON.stringify({ seconds }),
    }),

  forDoor: (doorId: number) => req<Device[]>(`/api/doors/${doorId}/devices`),
};
