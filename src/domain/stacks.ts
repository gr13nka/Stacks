// stacks.ts — turns a flat catalog into shooting sessions. A stack is a run
// of photos from one volume whose neighbours are at most `gapHours` apart;
// it attaches to the calendar day of its first photo. Pure: the store
// memoises the call on (photos, gapHours) identity.

import type { Photo, Stack } from '../api/types';
import { HOUR_MS, dayKey, wallClockToMs } from './time';

export function takenMs(photo: Photo): number {
  return wallClockToMs(photo.takenAt);
}

function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Photos grouped per volume, sorted by capture time then path, split wherever
 * the gap to the previous photo exceeds `gapHours` (a gap of exactly gapHours
 * still joins). Returns stacks newest first; each stack lists its photo ids in
 * capture order.
 */
export function buildStacks(photos: readonly Photo[], gapHours: number): Stack[] {
  const gapMs = gapHours * HOUR_MS;
  const byVolume = new Map<string, { photo: Photo; ms: number }[]>();
  for (const photo of photos) {
    const list = byVolume.get(photo.volumeId);
    const entry = { photo, ms: takenMs(photo) };
    if (list) list.push(entry);
    else byVolume.set(photo.volumeId, [entry]);
  }

  const stacks: Stack[] = [];
  for (const [volumeId, list] of byVolume) {
    list.sort((a, b) => a.ms - b.ms || comparePath(a.photo.path, b.photo.path));
    let current: Stack | null = null;
    for (const { photo, ms } of list) {
      if (current && ms - current.endMs <= gapMs) {
        current.photoIds.push(photo.id);
        current.endMs = ms;
      } else {
        current = {
          id: `${volumeId}:${photo.id}`,
          volumeId,
          photoIds: [photo.id],
          startMs: ms,
          endMs: ms,
          day: dayKey(ms),
        };
        stacks.push(current);
      }
    }
  }

  return stacks.sort((a, b) => b.startMs - a.startMs || comparePath(a.id, b.id));
}
