import { describe, expect, it } from 'vitest';
import { CAL } from '../tokens';
import { dayCellIndex, dayCellRect, monthBlockHeight, monthOffsets, monthsOf } from './calendar';
import { buildStacks } from './stacks';
import { photo } from './fixtures';

describe('calendar geometry', () => {
  it('seats the last day of the month at cell 0, top-left', () => {
    expect(dayCellIndex(31, 31)).toBe(0);
    expect(dayCellIndex(1, 31)).toBe(30);
    expect(dayCellRect(0)).toEqual({ x: CAL.marginX, y: CAL.headerH, w: CAL.cell.w, h: CAL.cell.h });
    expect(dayCellRect(1).x).toBe(CAL.marginX + CAL.cell.w + CAL.gutterX);
    expect(dayCellRect(CAL.cols).y).toBe(CAL.headerH + CAL.cell.h + CAL.rowGap);
    expect(dayCellRect(CAL.cols).x).toBe(CAL.marginX);
  });

  it('sizes a month block by the rows its days need', () => {
    const row = CAL.cell.h + CAL.rowGap;
    const block = (days: number) =>
      CAL.headerH + Math.ceil(days / CAL.cols) * row - CAL.rowGap + CAL.padBottom;
    expect(monthBlockHeight(31)).toBe(block(31));
    expect(monthBlockHeight(28)).toBe(block(28));
    // A month that exactly fills its last row is not given an empty extra one.
    expect(monthBlockHeight(CAL.cols)).toBe(CAL.headerH + row - CAL.rowGap + CAL.padBottom);
  });

  it('accumulates month tops without measuring anything', () => {
    const months = monthsOf(
      buildStacks([photo('a', '2024-11-05T08:00:00'), photo('b', '2024-10-28T09:00:00')], 3),
    );
    expect(months.map((m) => m.key)).toEqual(['2024-11', '2024-10']);
    expect(monthOffsets(months)).toEqual([0, monthBlockHeight(30), monthBlockHeight(30) + monthBlockHeight(31)]);
  });
});

describe('monthsOf', () => {
  it('groups stacks by month, newest first, and lists a day’s stacks in capture order', () => {
    const stacks = buildStacks(
      [
        photo('a', '2024-10-29T09:00:00'),
        photo('b', '2024-10-29T18:00:00'),
        photo('c', '2024-11-01T10:00:00'),
      ],
      3,
    );
    const months = monthsOf(stacks);
    expect(months).toHaveLength(2);
    expect(months[0]).toMatchObject({ key: '2024-11', year: 2024, month: 11, days: 30 });
    expect(months[1].byDay[29]).toEqual(['card:a', 'card:b']);
    expect(months[1].byDay[30]).toBeUndefined();
  });
});
