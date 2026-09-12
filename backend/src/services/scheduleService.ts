import { ethers } from 'ethers';

export interface Schedule {
  id?: number;
  rrule: string;
  start_minute: number;
  end_minute: number;
  timezone: string;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function canonicalForm(s: Schedule): string {
  const rrule = s.rrule.trim().toUpperCase().replace(/\s+/g, '');
  return `${rrule}|${s.start_minute}|${s.end_minute}|${s.timezone}`;
}

export function scheduleHash(s: Schedule | null | undefined): string {
  if (!s) return ethers.ZeroHash;
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalForm(s)));
}

export function matchesCommitment(s: Schedule | null | undefined, committed: string): boolean {
  return scheduleHash(s) === committed;
}

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
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return { day, minute: hour * 60 + minute };
}

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

export function isWithinSchedule(s: Schedule | null | undefined, at: Date = new Date()): boolean {
  if (!s) return true;

  const { day, minute } = localDayAndMinute(at, s.timezone);
  const days = allowedDays(s.rrule);

  if (s.end_minute > s.start_minute) {
    return days.has(day) && minute >= s.start_minute && minute < s.end_minute;
  }

  if (minute >= s.start_minute) return days.has(day);
  const previousDay = (day + 6) % 7;
  return minute < s.end_minute && days.has(previousDay);
}

export function describe(s: Schedule | null | undefined): string {
  if (!s) return '24/7';
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const days = [...allowedDays(s.rrule)].sort().map((d) => DAY_CODES[d]).join(',');
  return `${days} ${hhmm(s.start_minute)}-${hhmm(s.end_minute)} ${s.timezone}`;
}
