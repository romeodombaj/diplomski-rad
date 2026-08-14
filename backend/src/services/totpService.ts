import speakeasy from 'speakeasy';

/**
 * Generate a TOTP code for the given secret.
 */
export function generateTOTP(
  secret: string,
  digits: number = 6,
  step: number = 30,
): string {
  const token = speakeasy.totp({
    secret,
    digits,
    step,
    encoding: 'base32',
  });
  return token;
}

/**
 * Verify a TOTP code against the stored secret.
 * Uses verifyDelta with a window of 1 to allow +/-1 time step
 * (90 seconds total) to account for clock skew between client and server.
 */
export function verifyTOTP(
  secret: string,
  code: string,
  digits: number = 6,
  step: number = 30,
): boolean {
  // Validate the code format first
  if (!/^\d+$/.test(code) || code.length !== digits) {
    return false;
  }

  const result = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    digits,
    step,
    window: 1, // Allow +/-1 time step for clock skew
  });

  return result;
}
