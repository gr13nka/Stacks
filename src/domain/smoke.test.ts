import { describe, expect, it } from 'vitest';
import { CAL, dayCellRect, monthBlockHeight } from '../tokens';

describe('vitest wiring', () => {
  it('places the first cell at the left margin', () => {
    expect(dayCellRect(0).x).toBe(24);
    expect(dayCellRect(0).y).toBe(CAL.headerH);
  });

  it('sizes a 31-day month as 8 rows', () => {
    expect(monthBlockHeight(31)).toBe(CAL.headerH + 8 * CAL.cell.h + 7 * CAL.rowGap + CAL.padBottom);
  });
});
