// calendar.ts — the month list behind the calendar screen. Months are laid
// out newest first with the days of each month counting down (the last day
// at the top-left cell), and every offset is arithmetic on tokens.CAL so a
// hero origin never has to measure the DOM.

import type { Month, Stack } from '../api/types';
import { daysInMonth, splitDayKey } from './time';

export { dayCellRect, monthBlockHeight } from '../tokens';
import { monthBlockHeight } from '../tokens';

/** Stacks grouped into months, newest month first; each day lists its stacks in capture order. */
export function monthsOf(stacks: readonly Stack[]): Month[] {
  const months = new Map<string, Month>();
  const ordered = stacks.slice().sort((a, b) => a.startMs - b.startMs);
  for (const stack of ordered) {
    const { year, month, day } = splitDayKey(stack.day);
    const key = stack.day.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { key, year, month, days: daysInMonth(year, month), byDay: {} };
      months.set(key, m);
    }
    (m.byDay[day] ??= []).push(stack.id);
  }
  return [...months.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** Cell index of `day` inside its month: the last day is cell 0, day 1 is the last cell. */
export function dayCellIndex(day: number, days: number): number {
  return days - day;
}

/**
 * Cumulative tops of the month blocks in scroller-content coords. Has one
 * more entry than `months`: the last value is the total content height.
 */
export function monthOffsets(months: readonly Month[]): number[] {
  return blockOffsets(months.map((m) => monthBlockHeight(m.days)));
}

/** Cumulative tops for any list of block heights (same shape as monthOffsets). */
export function blockOffsets(heights: readonly number[]): number[] {
  const offsets = [0];
  for (const h of heights) offsets.push(offsets[offsets.length - 1] + h);
  return offsets;
}
