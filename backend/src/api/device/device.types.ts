export const DEVICE_KINDS = ['proximity', 'lock'] as const;
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

  lock_profile: string | null;
  command_topic: string | null;
  unlock_payload: string | null;
  lock_payload: string | null;
  hold_seconds: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DeviceWithDoor extends Device {
  door_name: string | null;
  door_code: string | null;
}

export interface CreateDeviceDto {
  name: string;
  kind: DeviceKind;
  address?: string | null;
  door_id?: number | null;
  active?: boolean;
  notes?: string | null;
  lock_profile?: string | null;
  command_topic?: string | null;
  unlock_payload?: string | null;
  lock_payload?: string | null;
  hold_seconds?: number | null;
}

export type UpdateDeviceDto = Partial<CreateDeviceDto>;

export interface DeviceSearchParams {
  q?: string;
  kind?: string;
  door_id?: string;
  active?: string;
  cursor?: string;
  limit?: string;
  page?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  count?: string;
}

export interface DeviceCursorPage {
  data: DeviceWithDoor[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
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
