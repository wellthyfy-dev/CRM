import { TIME_ZONE, WEEKDAYS, type Weekday } from './constants';

// All timestamps are stored in UTC. These helpers interpret instants in Asia/Kolkata.

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

export function istParts(date: Date): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: (map.weekday ?? 'Mon') as Weekday,
  };
}

/** Offset of Asia/Kolkata from UTC at the given instant, in minutes (IST has no DST: +330). */
function istOffsetMinutes(date: Date): number {
  const p = istParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant for a wall-clock time in Asia/Kolkata. */
export function istWallClockToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - istOffsetMinutes(guess) * 60000);
}

export function startOfIstDay(date: Date): Date {
  const p = istParts(date);
  return istWallClockToUtc(p.year, p.month, p.day);
}

export function startOfIstHour(date: Date): Date {
  const p = istParts(date);
  return istWallClockToUtc(p.year, p.month, p.day, p.hour);
}

export function startOfIstMonth(date: Date): Date {
  const p = istParts(date);
  return istWallClockToUtc(p.year, p.month, 1);
}

export function istWeekday(date: Date): Weekday {
  return istParts(date).weekday;
}

/** "HH:MM" → minutes since midnight. Returns NaN for malformed input. */
export function parseHhMm(value: string): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isWithinSendWindow(now: Date, start: string, end: string): boolean {
  const p = istParts(now);
  const minutes = p.hour * 60 + p.minute;
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  return minutes >= s && minutes < e;
}

export function isSendDay(now: Date, sendDays: readonly string[]): boolean {
  return sendDays.includes(istWeekday(now));
}

/**
 * Next instant at or after `from` that is inside the send window on a send day.
 * Returns null when the configuration can never be satisfied.
 */
export function nextSendOpportunity(
  from: Date,
  start: string,
  end: string,
  sendDays: readonly string[],
): Date | null {
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (Number.isNaN(s) || Number.isNaN(e) || s >= e) return null;
  if (!sendDays.some((d) => (WEEKDAYS as readonly string[]).includes(d))) return null;
  if (isSendDay(from, sendDays) && isWithinSendWindow(from, start, end)) return from;
  const p = istParts(from);
  for (let i = 0; i < 8; i++) {
    const candidate = istWallClockToUtc(p.year, p.month, p.day + i, Math.floor(s / 60), s % 60);
    if (candidate.getTime() >= from.getTime() && isSendDay(candidate, sendDays)) return candidate;
  }
  return null;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

const displayFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateOnlyFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** Display helper: UTC instant → "27 Oct 2026, 02:30 pm" in IST. */
export function formatIst(value: Date | string | null | undefined, withTime = true): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return (withTime ? displayFormatter : dateOnlyFormatter).format(d);
}

/** IST calendar date as YYYY-MM-DD. */
export function istDateKey(date: Date): string {
  const p = istParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** IST month as YYYY-MM. */
export function istMonthKey(date: Date): string {
  return istDateKey(date).slice(0, 7);
}
