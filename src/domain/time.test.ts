import { describe, expect, it } from 'vitest';
import { dayKey, daysInMonth, formatStamp, monthKeyOf, monthName, wallClockToMs } from './time';

describe('wall-clock time', () => {
  it('parses EXIF wall clock as UTC so the zone never shifts a day', () => {
    const ms = wallClockToMs('2024-11-05T23:59:30');
    expect(dayKey(ms)).toBe('2024-11-05');
    expect(monthKeyOf(ms)).toBe('2024-11');
  });

  it('formats the film date stamp as dd.mm.yy', () => {
    expect(formatStamp(wallClockToMs('2024-11-05T08:30:00'))).toBe('05.11.24');
    expect(formatStamp(wallClockToMs('2031-01-09T00:00:00'))).toBe('09.01.31');
  });

  it('falls back to 0 for unparsable input', () => {
    expect(wallClockToMs('garbage')).toBe(0);
  });

  it('knows month lengths and names', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 10)).toBe(31);
    expect(monthName(10)).toBe('october');
  });
});
