import speakeasy from 'speakeasy';

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

export function verifyTOTP(
  secret: string,
  code: string,
  digits: number = 6,
  step: number = 30,
): boolean {
  if (!/^\d+$/.test(code) || code.length !== digits) {
    return false;
  }

  const result = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    digits,
    step,
    window: 1,
  });

  return result;
}
