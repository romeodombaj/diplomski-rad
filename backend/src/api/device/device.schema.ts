import { z } from 'zod';
import { DEVICE_KINDS } from './device.types';

const base = {
  name: z.string().trim().min(1).max(120),
  kind: z.enum(DEVICE_KINDS),
  /**
   * An MQTT topic, or a hostname/IP for anything not on the broker. Nullable
   * because a device can be registered before anyone knows where it will live.
   */
  address: z.string().trim().max(200).nullable().optional(),
  door_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};

export const CreateDeviceSchema = z.object(base);

// Every field optional on update, but at least one present — an empty PATCH is
// a mistake worth reporting rather than a no-op that looks like success.
export const UpdateDeviceSchema = z
  .object({ ...base, name: base.name.optional(), kind: base.kind.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const ScanSchema = z.object({
  /** How long to listen. Bounded so one request cannot hold a broker client open. */
  seconds: z.number().int().min(2).max(30).optional(),
});

export type CreateDeviceInput = z.infer<typeof CreateDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;
