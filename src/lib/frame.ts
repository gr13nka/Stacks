// frame.ts — the single client-coordinate ↔ frame-coordinate conversion.
// Every pointer handler in the app calls toFrame() so gesture math never
// has to know the phone is uniformly scaled down to fit short windows.

import { FRAME } from '../tokens';

let frameEl: HTMLElement | null = null;

/** Registered once by App on the .phone element (and cleared on unmount). */
export function setFrameElement(el: HTMLElement | null): void {
  frameEl = el;
}

/** Current uniform scale of the frame, derived from its live rendered size.
 *  This works for both mobile transform scaling and desktop layout zoom. */
export function frameScale(): number {
  if (!frameEl) return 1;
  const rect = frameEl.getBoundingClientRect();
  return rect.width > 0 ? rect.width / FRAME.w : 1;
}

/** Client (viewport) coordinates → frame-local coordinates. */
export function toFrame(clientX: number, clientY: number): { x: number; y: number } {
  if (!frameEl) return { x: clientX, y: clientY };
  const rect = frameEl.getBoundingClientRect();
  const scale = rect.width > 0 ? rect.width / FRAME.w : 1;
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}
