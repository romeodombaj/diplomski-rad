
export interface EnrollmentPayload {
  token: string;
  backend?: string;
  personId?: string;
}

const BARE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export function parseEnrollmentPayload(raw: string): EnrollmentPayload | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
      if (!token) return null;
      return {
        token,
        backend: typeof parsed.backend === 'string' ? parsed.backend : undefined,
        personId: typeof parsed.person_id === 'string' ? parsed.person_id : undefined,
      };
    } catch {
      return null;
    }
  }

  return BARE_TOKEN.test(text) ? { token: text } : null;
}
