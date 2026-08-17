import { z } from 'zod';

export const VerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});

export type VerifyInput = z.infer<typeof VerifySchema>;
