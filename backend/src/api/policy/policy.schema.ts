import { z } from 'zod';

export const GrantDirectSchema = z.object({
  person_id: z.string().trim().min(1),
  door_id: z.number().int().positive(),
  schedule_id: z.number().int().positive().nullable().optional(),
  start_time: z.number().int().nonnegative().optional(),
  end_time: z.number().int().nonnegative().optional(),
});

export const AssignGroupSchema = z.object({
  person_id: z.string().trim().min(1),
  group_id: z.number().int().positive(),
});

export const CreateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  is_default: z.boolean().optional(),
});

export const UpdateGroupSchema = CreateGroupSchema.partial();

export const SetGroupDoorsSchema = z.object({
  doors: z.array(
    z.object({
      door_id: z.number().int().positive(),
      schedule_id: z.number().int().positive().nullable().optional(),
    }),
  ),
});

export const CreateScheduleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rrule: z.string().trim().min(1).max(200),
  start_minute: z.number().int().min(0).max(1439),
  end_minute: z.number().int().min(0).max(1440),
  timezone: z.string().trim().min(1).max(60).default('Europe/Zagreb'),
});
