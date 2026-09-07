// shred.ts — the shredder's choreography as pure functions of one progress
// value per print (t: 0 seated on the pile, 1 swallowed). Feed timing,
// print pose, strip pose and the failure message all live here so the
// screen components only map motion values through them.

import type { Photo, TrashReport, Volume } from '../api/types';
import type { RectRot } from '../tokens';
import { SHREDDER } from '../tokens';

export const STRIP_W = SHREDDER.print.w / SHREDDER.strips;

/** Where print `seat` sits on the pile (0 = bottom); tilts cycle SHREDDER.pileTilt. */
export function pileSeat(seat: number): RectRot {
  return { ...SHREDDER.pile, rot: SHREDDER.pileTilt[seat % SHREDDER.pileTilt.length] };
}

/** ms between successive feeds: the nominal stagger, compressed so `n` prints finish within maxFeedMs. */
export function feedStagger(n: number): number {
  if (n <= 1) return 0;
  return Math.min(SHREDDER.feedStagger, SHREDDER.maxFeedMs / (n - 1));
}

/** Print pose at feed progress t, relative to its seat: sinks below the seam, straightens, shrinks a little. */
export function feedPose(t: number, seatRot: number): { y: number; rotate: number; scale: number } {
  const sinkY = SHREDDER.seam.y + SHREDDER.print.h * SHREDDER.sink - SHREDDER.pile.y;
  return {
    y: sinkY * t,
    rotate: seatRot * (1 - t),
    scale: 1 - (1 - SHREDDER.feedScale) * t,
  };
}

/** Strip i at feed progress t, or null before the knee (no strips yet). y is below the seam slot. */
export function stripPose(t: number, i: number): { y: number; rotate: number; opacity: number } | null {
  if (t < SHREDDER.knee) return null;
  const f = Math.min(1, (t - SHREDDER.knee) / (1 - SHREDDER.knee));
  return {
    y: f * SHREDDER.stripFall + i * SHREDDER.stripStep,
    rotate: (i % 2 === 0 ? -1 : 1) * SHREDDER.stripTilt * f,
    opacity: 1 - f,
  };
}

/** A reject on a read-only volume cannot be trashed: the shredder refuses before feeding. */
export function isLocked(rejects: readonly Photo[], volumes: readonly Volume[]): boolean {
  const readOnly = new Set(volumes.filter((v) => v.readOnly).map((v) => v.id));
  return rejects.some((p) => readOnly.has(p.volumeId));
}

export function shredMessage(report: TrashReport): string {
  if (report.failed.some((f) => f.reason === 'read-only')) return 'card is write-protected — flip the lock tab';
  const n = report.failed.length;
  return `${n} file${n === 1 ? '' : 's'} could not be moved`;
}
