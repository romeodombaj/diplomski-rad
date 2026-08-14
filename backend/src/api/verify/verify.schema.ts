import { z } from 'zod';

export const VerifyAccessSchema = z.object({
  door_code: z.string().min(1, 'Door code is required'),
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
  method: z.enum(['totp', 'face'], {
    required_error: 'Verification method is required',
  }),
  timestamp: z.number().int().positive('Timestamp must be a positive integer'),
});

export type VerifyAccessInput = z.infer<typeof VerifyAccessSchema>;
