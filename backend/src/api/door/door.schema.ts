import { z } from 'zod';

export const CreateDoorSchema = z.object({
  name: z.string().min(1),
  door_code: z.string().min(1),
  mqtt_topic: z.string().min(1),
  active: z.boolean(),
});

export const UpdateDoorSchema = z.object({
  name: z.string().min(1).optional(),
  door_code: z.string().min(1).optional(),
  mqtt_topic: z.string().min(1).optional(),
  active: z.boolean().optional(),
});
