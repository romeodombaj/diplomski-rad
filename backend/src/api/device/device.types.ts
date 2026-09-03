/** What role a device plays at a door. */
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
  deleted_at: string | null;
}

/** A device row plus the door it is attached to, for list views. */
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

/** One topic seen during an MQTT scan. */
export interface DiscoveredDevice {
  topic: string;
  /** How many messages arrived on it during the scan. */
  messages: number;
  /** The most recent payload, truncated — enough to recognise the device. */
  sample: string | null;
  /** True when a device row already claims this topic. */
  known: boolean;
}
