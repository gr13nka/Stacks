// deck.ts — what the deck shows for a stack: the queue of photos still
// undecided (in capture order), the stack's progress, and where the top card
// sits. Decisions are keyed by photo path, so every helper takes the photo
// index to resolve a stack's ids. Pure; memoised by the store.

import type { Decision, DecisionMap, Photo, Stack } from '../api/types';
import type { RectRot } from '../tokens';
import { DECK, PRINT } from '../tokens';

export type PhotoIndex = ReadonlyMap<string, Photo>;

export type StackStatus = 'untouched' | 'partial' | 'done';

/** Everything a list cell needs to know about a stack, computed in one pass. */
export type StackState = {
  status: StackStatus;
  decided: number;
  kept: number;
  removed: number;
  total: number;
  /** The first undecided photo, or the last photo once the stack is done. */
  top: Photo | null;
};

export const DEFAULT_ASPECT = 1.5;

export function stackPhotos(stack: Stack, byId: PhotoIndex): Photo[] {
  const out: Photo[] = [];
  for (const id of stack.photoIds) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}

/** Undecided photos of the stack in capture order — the deck's card pile. */
export function deckQueue(stack: Stack, byId: PhotoIndex, decisions: DecisionMap): Photo[] {
  return stackPhotos(stack, byId).filter((p) => decisions[p.path] === undefined);
}

export function stackState(stack: Stack, byId: PhotoIndex, decisions: DecisionMap): StackState {
  const photos = stackPhotos(stack, byId);
  let kept = 0;
  let removed = 0;
  let top: Photo | null = null;
  for (const p of photos) {
    const d = decisions[p.path]?.d;
    if (d === 'keep') kept += 1;
    else if (d === 'remove') removed += 1;
    else if (!top) top = p;
  }
  const decided = kept + removed;
  const total = photos.length;
  const status: StackStatus = decided === 0 ? 'untouched' : decided >= total ? 'done' : 'partial';
  return { status, decided, kept, removed, total, top: top ?? photos[photos.length - 1] ?? null };
}

export function stackStatus(stack: Stack, byId: PhotoIndex, decisions: DecisionMap): StackStatus {
  return stackState(stack, byId, decisions).status;
}

/** Fraction of the stack decided, 0..1. */
export function stackProgress(stack: Stack, byId: PhotoIndex, decisions: DecisionMap): number {
  const { decided, total } = stackState(stack, byId, decisions);
  return total === 0 ? 0 : decided / total;
}

/**
 * The top card's rect: a paper slab whose image area has `aspect` (w/h),
 * fitted inside DECK.box and centred. RAW-only photos have no aspect until
 * their thumb loads; they get DEFAULT_ASPECT.
 */
export function cardFitRect(aspect: number | null, border: number = PRINT.border.card): RectRot {
  const a = aspect && aspect > 0 ? aspect : DEFAULT_ASPECT;
  const innerW = DECK.box.w - 2 * border;
  const innerH = DECK.box.h - 2 * border;
  let w: number;
  let h: number;
  if (a >= innerW / innerH) {
    w = innerW;
    h = innerW / a;
  } else {
    h = innerH;
    w = innerH * a;
  }
  w += 2 * border;
  h += 2 * border;
  return {
    x: DECK.box.x + (DECK.box.w - w) / 2,
    y: DECK.box.y + (DECK.box.h - h) / 2,
    w,
    h,
    rot: 0,
  };
}

/**
 * Scale for a card laid out at cardFitRect(aspect) but shown turned by
 * `turns` quarter turns: after an odd number of turns it must cover the rect
 * the turned photo will get, cardFitRect(1 / aspect). Both rects are centred
 * in DECK.box, so turning about the card's centre needs no translation.
 */
export function turnedCardScale(aspect: number | null, turns: number): number {
  if (turns % 2 === 0) return 1;
  const a = aspect && aspect > 0 ? aspect : DEFAULT_ASPECT;
  const laid = cardFitRect(a);
  const turned = cardFitRect(1 / a);
  // Turned, the laid card is laid.h wide and laid.w tall.
  return Math.min(turned.w / laid.h, turned.h / laid.w);
}

/**
 * What a released swipe means: the projected travel (position + velocity ×
 * GESTURE.projectMs) or the release velocity alone can commit; right keeps,
 * left removes; anything else returns the card. vx is px/ms.
 */
export function swipeDecision(projectedDx: number, vx: number): Decision | null {
  const byTravel = Math.abs(projectedDx) >= DECK.commitDx;
  const byVelocity = Math.abs(vx) >= DECK.commitVx;
  if (!byTravel && !byVelocity) return null;
  const direction = byVelocity && Math.sign(vx) !== 0 ? Math.sign(vx) : Math.sign(projectedDx);
  return direction > 0 ? 'keep' : direction < 0 ? 'remove' : null;
}
