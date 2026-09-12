import { z } from 'zod';
import { DEVICE_KINDS } from './device.types';
import { LOCK_PROFILES } from '../../services/lockService';

const base = {
  name: z.string().trim().min(1).max(120),
  kind: z.enum(DEVICE_KINDS),
  address: z.string().trim().max(200).nullable().optional(),
  door_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),

  lock_profile: z.enum(LOCK_PROFILES).nullable().optional(),
  command_topic: z.string().trim().max(200).nullable().optional(),
  unlock_payload: z.string().max(500).nullable().optional(),
  lock_payload: z.string().max(500).nullable().optional(),
  hold_seconds: z.number().int().min(1).max(300).nullable().optional(),
};

export const CreateDeviceSchema = z.object(base);

export const UpdateDeviceSchema = z
  .object({ ...base, name: base.name.optional(), kind: base.kind.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const ScanSchema = z.object({
  seconds: z.number().int().min(2).max(30).optional(),
});

export type CreateDeviceInput = z.infer<typeof CreateDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;
