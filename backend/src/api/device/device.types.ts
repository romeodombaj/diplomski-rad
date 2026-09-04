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

/** One raw topic heard during an MQTT scan. */
export interface DiscoveredTopic {
  topic: string;
  messages: number;
  sample: string | null;
}

/**
 * One device heard during an MQTT scan.
 *
 * A device is not a topic: an ESPHome node publishes a discovery topic, a debug
 * topic and one topic per entity, all of which belong to the same piece of
 * hardware. `topics` keeps the evidence so the operator can see why these were
 * grouped.
 */
export interface DiscoveredDevice {
  /** The base topic, and what gets stored as the device's address. */
  topic: string;
  /** Friendly name, when the device announced one. */
  name: string | null;
  /** Address, when the device announced one. */
  ip: string | null;
  /** Messages across every topic this device published on. */
  messages: number;
  /** The most recent payload, truncated — enough to recognise the device. */
  sample: string | null;
  /** True when a device row already claims this topic. */
  known: boolean;
  /** Every topic seen for this device, most active first. */
  topics: DiscoveredTopic[];
}
