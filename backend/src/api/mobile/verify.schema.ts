import { z } from 'zod';

/**
 * Enroll a device DID and get back a freshly minted TOTP secret.
 * The mobile app stores the secret locally and generates codes on-device.
 */
export const EnrollSchema = z.object({
  did: z.string().min(3).max(200),
});

export type EnrollInput = z.infer<typeof EnrollSchema>;

/**
 * Verify a 6-digit TOTP code generated on-device for a given DID.
 */
export const VerifySchema = z.object({
  did: z.string().min(3).max(200),
  code: z.string().length(6).regex(/^\d{6}$/),
});

export type VerifyInput = z.infer<typeof VerifySchema>;
