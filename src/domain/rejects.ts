// rejects.ts — the reject pile as a grid: rejects grouped by the day of
// the stack they came from (newest day first, most recently rejected first
// within a day) and laid out in three columns under a caption row per day.
// Every rect is arithmetic on tokens.REJECTS in scroller-content coords, so
// the shredder can compute where each print takes off from.

import type { Photo, Stack } from '../api/types';
import type { Rect, RectRot } from '../tokens';
import { REJECTS } from '../tokens';
import { dayKey } from './time';
import { takenMs } from './stacks';

export type RejectGroup = { day: string; photos: Photo[] };

export type RejectsLayout = {
  captions: { day: string; y: number }[];
  /** photo id → cell rect (the 106×106 cell, not the print). */
  cells: Map<string, Rect>;
  height: number;
};

/** Groups keep the incoming order of `rejects` (most recent first) inside each day. */
export function groupRejectsByDay(rejects: readonly Photo[], stacks: readonly Stack[]): RejectGroup[] {
  const dayOf = new Map<string, string>();
  for (const stack of stacks) for (const id of stack.photoIds) dayOf.set(id, stack.day);
  const groups = new Map<string, RejectGroup>();
  for (const photo of rejects) {
    const day = dayOf.get(photo.id) ?? dayKey(takenMs(photo));
    let g = groups.get(day);
    if (!g) {
      g = { day, photos: [] };
      groups.set(day, g);
    }
    g.photos.push(photo);
  }
  return [...groups.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

export function layoutRejects(groups: readonly RejectGroup[]): RejectsLayout {
  const captions: RejectsLayout['captions'] = [];
  const cells = new Map<string, Rect>();
  let y = 0;
  for (const group of groups) {
    captions.push({ day: group.day, y });
    y += REJECTS.captionH;
    group.photos.forEach((photo, i) => {
      const col = i % REJECTS.cols;
      const row = Math.floor(i / REJECTS.cols);
      cells.set(photo.id, {
        x: REJECTS.marginX + col * (REJECTS.cell.w + REJECTS.gutter),
        y: y + row * (REJECTS.cell.h + REJECTS.gutter),
        w: REJECTS.cell.w,
        h: REJECTS.cell.h,
      });
    });
    const rows = Math.ceil(group.photos.length / REJECTS.cols);
    y += rows * REJECTS.cell.h + Math.max(0, rows - 1) * REJECTS.gutter + REJECTS.groupGap;
  }
  return { captions, cells, height: y };
}

/** The print inside a cell, in frame coords for the scroller's current offset. */
export function cellPrintRect(cell: Rect, scrollTop: number): RectRot {
  return {
    x: cell.x + (cell.w - REJECTS.print.w) / 2,
    y: REJECTS.gridY + cell.y + (cell.h - REJECTS.print.h) / 2 - scrollTop,
    w: REJECTS.print.w,
    h: REJECTS.print.h,
    rot: 0,
  };
}
