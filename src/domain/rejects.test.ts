import { describe, expect, it } from 'vitest';
import { REJECTS } from '../tokens';
import { cellPrintRect, groupRejectsByDay, layoutRejects } from './rejects';
import { buildStacks } from './stacks';
import { photo } from './fixtures';

const photos = [
  photo('a', '2024-10-31T23:30:00'),
  photo('b', '2024-11-01T00:10:00'), // same stack as a, so grouped under 31 oct
  photo('c', '2024-11-03T12:00:00'),
  photo('d', '2024-11-03T12:01:00'),
  photo('e', '2024-11-03T12:02:00'),
  photo('f', '2024-11-03T12:03:00'),
];
const stacks = buildStacks(photos, 3);

describe('groupRejectsByDay', () => {
  it('groups by the stack day, newest day first, keeping reject order within a day', () => {
    const rejects = [photos[5], photos[1], photos[2], photos[0]]; // f, b, c, a (most recent first)
    const groups = groupRejectsByDay(rejects, stacks);
    expect(groups.map((g) => g.day)).toEqual(['2024-11-03', '2024-10-31']);
    expect(groups[0].photos.map((p) => p.id)).toEqual(['f', 'c']);
    expect(groups[1].photos.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('layoutRejects', () => {
  it('lays each group out in REJECTS.cols columns under its caption', () => {
    const groups = groupRejectsByDay([photos[2], photos[3], photos[4], photos[5], photos[0]], stacks);
    const layout = layoutRejects(groups);
    // The first group holds c, d, e, f; how many rows that is depends on REJECTS.cols.
    const rows = Math.ceil(4 / REJECTS.cols);
    const at = (i: number) => ({
      x: REJECTS.marginX + (i % REJECTS.cols) * (REJECTS.cell.w + REJECTS.gutter),
      y: REJECTS.captionH + Math.floor(i / REJECTS.cols) * (REJECTS.cell.h + REJECTS.gutter),
      w: REJECTS.cell.w,
      h: REJECTS.cell.h,
    });
    expect(layout.captions).toEqual([
      { day: '2024-11-03', y: 0 },
      {
        day: '2024-10-31',
        y: REJECTS.captionH + rows * REJECTS.cell.h + (rows - 1) * REJECTS.gutter + REJECTS.groupGap,
      },
    ]);
    expect(layout.cells.get('c')).toEqual(at(0));
    expect(layout.cells.get('e')).toEqual(at(2));
    expect(layout.cells.get('f')).toEqual(at(3));
    expect(layout.height).toBe(layout.captions[1].y + REJECTS.captionH + REJECTS.cell.h + REJECTS.groupGap);
  });

  it('is empty for no rejects', () => {
    expect(layoutRejects([])).toEqual({ captions: [], cells: new Map(), height: 0 });
  });

  it('converts a cell to the print rect in frame coords for a scroll offset', () => {
    const cell = { x: REJECTS.marginX, y: 100, w: REJECTS.cell.w, h: REJECTS.cell.h };
    const inset = (REJECTS.cell.w - REJECTS.print.w) / 2;
    const seated = cellPrintRect(cell, 0);
    // The print is centred in its cell and offset by the grid's top edge.
    expect(seated).toEqual({
      x: REJECTS.marginX + inset,
      y: REJECTS.gridY + 100 + (REJECTS.cell.h - REJECTS.print.h) / 2,
      w: REJECTS.print.w,
      h: REJECTS.print.h,
      rot: 0,
    });
    // Scrolling moves it up by exactly the scroll offset, and nothing else.
    expect(cellPrintRect(cell, 40)).toEqual({ ...seated, y: seated.y - 40 });
  });
});
