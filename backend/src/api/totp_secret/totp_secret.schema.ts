import { z } from 'zod';

export const CreateTotp_secretSchema = z.object({
  did: z.string().min(1),
  secret: z.string().min(1),
  period: z.number(),
  digits: z.number(),
});

export const UpdateTotp_secretSchema = z.object({
  did: z.string().min(1).optional(),
  secret: z.string().min(1).optional(),
  period: z.number().optional(),
  digits: z.number().optional(),
});
