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
  it('lays each group out in three columns under its caption', () => {
    const groups = groupRejectsByDay([photos[2], photos[3], photos[4], photos[5], photos[0]], stacks);
    const layout = layoutRejects(groups);
    expect(layout.captions).toEqual([
      { day: '2024-11-03', y: 0 },
      { day: '2024-10-31', y: REJECTS.captionH + 2 * REJECTS.cell.h + REJECTS.gutter + REJECTS.groupGap },
    ]);
    expect(layout.cells.get('c')).toEqual({ x: REJECTS.marginX, y: REJECTS.captionH, w: REJECTS.cell.w, h: REJECTS.cell.h });
    expect(layout.cells.get('e')?.x).toBe(REJECTS.marginX + 2 * (REJECTS.cell.w + REJECTS.gutter));
    expect(layout.cells.get('f')).toEqual({
      x: REJECTS.marginX,
      y: REJECTS.captionH + REJECTS.cell.h + REJECTS.gutter,
      w: REJECTS.cell.w,
      h: REJECTS.cell.h,
    });
    expect(layout.height).toBe(layout.captions[1].y + REJECTS.captionH + REJECTS.cell.h + REJECTS.groupGap);
  });

  it('is empty for no rejects', () => {
    expect(layoutRejects([])).toEqual({ captions: [], cells: new Map(), height: 0 });
  });

  it('converts a cell to the print rect in frame coords for a scroll offset', () => {
    const cell = { x: 24, y: 100, w: 106, h: 106 };
    expect(cellPrintRect(cell, 40)).toEqual({ x: 33, y: REJECTS.gridY + 100 + 9 - 40, w: 88, h: 88, rot: 0 });
  });
});
