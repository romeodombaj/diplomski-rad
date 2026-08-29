/**
 * Recurring access windows, and the commitment that makes them tamper-evident.
 *
 * `AccessPolicy.sol` holds one contiguous [startTime, endTime] and nothing
 * else, so "Mon-Fri 09:00-17:00" is inexpressible on chain. Enforcing it in the
 * backend alone would break the system's central claim — the operator who
 * enforces the window is the same one who could silently widen it, and the
 * chain would never disagree.
 *
 * Option C from specs/06_access_control.md section 4: enforcement stays here
 * (cheap, and it handles DST properly, which a fixed on-chain offset does not),
 * but the policy carries `keccak256(canonical form)`. The backend must present
 * a schedule matching that commitment, and changing a schedule is a new grant —
 * permanently visible as an AccessGranted event.
 *
 * The property this buys is tamper-EVIDENCE, not tamper-prevention. An operator
 * can still fail to enforce a schedule they committed to; what they cannot do
 * is rewrite it after the fact without leaving a trace. Overclaiming here is
 * the most likely thing a reviewer challenges (spec section 6).
 */
import { ethers } from 'ethers';

export interface Schedule {
  id?: number;
  rrule: string;        // e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
  start_minute: number; // 540 = 09:00, minutes from local midnight
  end_minute: number;   // 1020 = 17:00
  timezone: string;     // IANA, e.g. Europe/Zagreb
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/**
 * The exact string that gets hashed. Any drift between this and what a verifier
 * computes turns every scheduled policy into a denial, so it is deliberately
 * rigid: fixed field order, uppercased rrule, no optional whitespace.
 */
export function canonicalForm(s: Schedule): string {
  const rrule = s.rrule.trim().toUpperCase().replace(/\s+/g, '');
  return `${rrule}|${s.start_minute}|${s.end_minute}|${s.timezone}`;
}

/** The bytes32 commitment written to the policy. */
export function scheduleHash(s: Schedule | null | undefined): string {
  if (!s) return ethers.ZeroHash; // 24/7 — nothing to commit to
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalForm(s)));
}

/** Does this schedule hash to what the chain says was committed? */
export function matchesCommitment(s: Schedule | null | undefined, committed: string): boolean {
  return scheduleHash(s) === committed;
}

/**
 * Local wall-clock day and minute in the schedule's timezone.
 *
 * Uses Intl rather than an offset arithmetic so DST is handled by the platform's
 * tz database — the thing option B would have had to hardcode on chain.
 */
export function localDayAndMinute(at: Date, timezone: string): { day: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const weekday = get('weekday').toUpperCase().slice(0, 2);
  const day = DAY_CODES.indexOf(weekday as (typeof DAY_CODES)[number]);
  // 24-hour formatting renders midnight as "24" in some ICU versions.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return { day, minute: hour * 60 + minute };
}

/** The BYDAY codes an rrule allows; every day when it names none. */
function allowedDays(rrule: string): Set<number> {
  const match = /BYDAY=([A-Z,]+)/i.exec(rrule);
  if (!match) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = match[1]
    .toUpperCase()
    .split(',')
    .map((code) => DAY_CODES.indexOf(code.trim() as (typeof DAY_CODES)[number]))
    .filter((i) => i >= 0);
  return new Set(days);
}

/**
 * Is `at` inside the schedule's weekly window?
 *
 * A window whose end is not after its start is treated as crossing midnight
 * (e.g. a night shift, 22:00-06:00), and the day check applies to the day the
 * window OPENED — otherwise a Friday night shift would be refused at 01:00 on
 * Saturday, which is not what "Fri 22:00-06:00" means to anyone.
 */
export function isWithinSchedule(s: Schedule | null | undefined, at: Date = new Date()): boolean {
  if (!s) return true; // 24/7

  const { day, minute } = localDayAndMinute(at, s.timezone);
  const days = allowedDays(s.rrule);

  if (s.end_minute > s.start_minute) {
    return days.has(day) && minute >= s.start_minute && minute < s.end_minute;
  }

  // Crosses midnight.
  if (minute >= s.start_minute) return days.has(day);
  const previousDay = (day + 6) % 7;
  return minute < s.end_minute && days.has(previousDay);
}

/** Human-readable summary for the dashboard and the person detail page. */
export function describe(s: Schedule | null | undefined): string {
  if (!s) return '24/7';
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const days = [...allowedDays(s.rrule)].sort().map((d) => DAY_CODES[d]).join(',');
  return `${days} ${hhmm(s.start_minute)}-${hhmm(s.end_minute)} ${s.timezone}`;
}
