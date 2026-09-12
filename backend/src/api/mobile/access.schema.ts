import { z } from 'zod';

export const AccessRequestSchema = z.object({
  did: z.string().trim().min(3).max(200),

  signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte hex signature'),

  totp: z.string().length(6).regex(/^\d{6}$/),

  door_code: z.string().trim().min(1).max(100),

  timestamp: z.number().int().positive(),

  nonce: z.string().trim().regex(/^[0-9a-fA-F]{16,64}$/, 'expected 8-32 hex bytes'),

  faceScore: z.number().min(-1).max(1).optional(),
});

export type AccessRequestInput = z.infer<typeof AccessRequestSchema>;
