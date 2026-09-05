/** What role a device plays at a door. */
/**
 * The two roles a device plays at a door.
 *
 * A ReSpeaker is one object doing one job — telling the phone it is at this
 * door and showing how close somebody is — so it is one kind, not a "beacon"
 * plus an "indicator". Anything that releases the door is a lock, whatever the
 * relay behind it happens to be.
 */
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

  /** Lock actuation. Null on every kind but `lock` — see services/lockService. */
  lock_profile: string | null;
  command_topic: string | null;
  unlock_payload: string | null;
  lock_payload: string | null;
  hold_seconds: number | null;
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
  /**
   * How this was found.
   *
   * 'mqtt' results identify themselves — a topic and payload say what they are.
   * 'tuya' results are only an address that answered on the right port: the
   * device id travels in a UDP broadcast that cannot cross this container's
   * bridge network, so there is nothing more honest to report.
   */
  source: 'mqtt' | 'tuya';
  /** The base topic, or an IP for a device that speaks its own protocol. */
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
