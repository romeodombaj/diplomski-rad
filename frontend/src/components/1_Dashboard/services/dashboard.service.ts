import { apiFetch } from '@/lib/apiFetch';

export type DoorCard = {
  id: number;
  name: string;
  door_code: string;
  active: boolean;
  mqtt_topic: string;
  opens_today: number;
  denials_today: number;
  last_opened_at: string | null;
  last_opened_by: string | null;
  lock: {
    id: number;
    name: string;
    profile: string;
    address: string | null;
    active: boolean;
  } | null;
  device_count: number;
};

export type OpenerRow = {
  person_id: string | null;
  full_name: string;
  opens: number;
  last_at: string;
  last_door: string;
};

export type DashboardOverview = {
  totals: {
    granted_today: number;
    denied_today: number;
    doors: number;
    doors_inactive: number;
    locks_configured: number;
    people_active: number;
  };
  doors: DoorCard[];
  openers: OpenerRow[];
  activity: { hour: number; granted: number; denied: number }[];
  health: { mqtt: boolean; chain: boolean };
};

export const DashboardService = {
  overview: async (): Promise<DashboardOverview> => {
    const res = await apiFetch('/api/dashboard/overview');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`);
    return (body.data ?? body) as DashboardOverview;
  },
};
