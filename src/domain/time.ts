// time.ts — wall-clock arithmetic for capture times. EXIF carries no time
// zone, so a capture time is treated as a naive wall clock: it is parsed and
// formatted with UTC getters so the machine's zone and DST never shift a
// photo across a day boundary.

export const HOUR_MS = 3_600_000;

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;

/** 'YYYY-MM-DDTHH:MM:SS' → ms; unparsable input sorts first (0) rather than poisoning a sort with NaN. */
export function wallClockToMs(s: string): number {
  const m = WALL_CLOCK.exec(s);
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  const fallback = Date.parse(s);
  return Number.isFinite(fallback) ? fallback : 0;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ms → 'YYYY-MM-DD'. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** ms → 'YYYY-MM'. */
export function monthKeyOf(ms: number): string {
  return dayKey(ms).slice(0, 7);
}

/** ms → 'dd.mm.yy', the film date-stamp format. */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCFullYear() % 100)}`;
}

/** 'YYYY-MM-DD' → its parts. */
export function splitDayKey(key: string): { year: number; month: number; day: number } {
  return { year: +key.slice(0, 4), month: +key.slice(5, 7), day: +key.slice(8, 10) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

/** 1..12 → lowercase english month name. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}
