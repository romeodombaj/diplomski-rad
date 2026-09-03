/**
 * Read an enrolment code, however it arrived.
 *
 * The dashboard's QR does not hold the bare token — it holds a JSON envelope
 * (see frontend/src/components/106_people/person/EnrollmentDialog.tsx):
 *
 *     {"v":1,"backend":"https://…","token":"…","person_id":"…"}
 *
 * while the same dialog's "Copy token" button puts the bare 43-character
 * base64url token on the clipboard. Both land in the same field here, so this
 * accepts either rather than making the operator care which one they used.
 */

export interface EnrollmentPayload {
  token: string;
  /**
   * The dashboard's own origin, carried so a future build could point itself at
   * the right backend from the QR alone. Parsed but deliberately unused: the
   * app's API base is inlined at build time (EXPO_PUBLIC_API_URL), and the
   * dialog fills this from `window.location.origin` — which is whatever the
   * operator typed, commonly `localhost`, and unreachable from a phone.
   */
  backend?: string;
  personId?: string;
}

/** A base64url token from `crypto.randomBytes(32)` — 43 chars, no padding. */
const BARE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * Returns null when the input is neither a valid envelope nor a plausible
 * token, so a QR from some unrelated poster is rejected before it can consume
 * a real enrolment attempt.
 */
export function parseEnrollmentPayload(raw: string): EnrollmentPayload | null {
  const text = raw.trim();
  if (!text) return null;

  // The envelope. Checked first because a JSON string is never a bare token.
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
