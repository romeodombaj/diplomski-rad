import { z } from 'zod';

export const ProximityReportSchema = z.object({
  did: z.string().trim().min(3).max(200),

  signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte hex signature'),

  door_code: z.string().trim().min(1).max(100),

  level: z.number().int().min(0).max(64),

  rssi: z.number().int().min(-127).max(20),

  timestamp: z.number().int().positive(),

  nonce: z.string().trim().regex(/^[0-9a-fA-F]{16,64}$/, 'expected 8-32 hex bytes'),
});

export type ProximityReportInput = z.infer<typeof ProximityReportSchema>;
