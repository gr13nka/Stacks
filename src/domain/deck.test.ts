import { describe, expect, it } from 'vitest';
import type { DecisionMap } from '../api/types';
import { DECK, PRINT } from '../tokens';
import { cardFitRect, deckQueue, stackProgress, stackState, stackStatus } from './deck';
import { buildStacks } from './stacks';
import { photo } from './fixtures';

const photos = [
  photo('a', '2024-11-01T10:00:00'),
  photo('b', '2024-11-01T10:01:00'),
  photo('c', '2024-11-01T10:02:00'),
];
const byId = new Map(photos.map((p) => [p.id, p]));
const [stack] = buildStacks(photos, 3);
const decide = (...ids: string[]): DecisionMap =>
  Object.fromEntries(ids.map((id) => [`/vol/${id}.JPG`, { d: 'keep' as const, at: 1 }]));

describe('deckQueue', () => {
  it('lists undecided photos in capture order', () => {
    expect(deckQueue(stack, byId, {}).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(deckQueue(stack, byId, decide('b')).map((p) => p.id)).toEqual(['a', 'c']);
    expect(deckQueue(stack, byId, decide('a', 'b', 'c'))).toEqual([]);
  });

  it('ignores ids that are no longer in the catalog', () => {
    const partial = new Map([['b', photos[1]]]);
    expect(deckQueue(stack, partial, {}).map((p) => p.id)).toEqual(['b']);
  });
});

describe('stackStatus', () => {
  it('is untouched, partial, then done', () => {
    expect(stackStatus(stack, byId, {})).toBe('untouched');
    expect(stackStatus(stack, byId, decide('a'))).toBe('partial');
    expect(stackStatus(stack, byId, decide('a', 'b', 'c'))).toBe('done');
    expect(stackProgress(stack, byId, decide('a'))).toBeCloseTo(1 / 3);
  });

  it('exposes the first undecided photo as top, or the last photo once done', () => {
    expect(stackState(stack, byId, decide('a')).top?.id).toBe('b');
    expect(stackState(stack, byId, decide('a', 'b', 'c')).top?.id).toBe('c');
  });
});

describe('cardFitRect', () => {
  it('fits a landscape image area across the box, centred vertically', () => {
    const r = cardFitRect(1.5);
    const b = PRINT.border.card;
    expect(r.w).toBe(DECK.box.w);
    expect(r.h).toBeCloseTo((DECK.box.w - 2 * b) / 1.5 + 2 * b);
    expect(r.x).toBe(DECK.box.x);
    expect(r.y).toBeCloseTo(DECK.box.y + (DECK.box.h - r.h) / 2);
    expect(r.rot).toBe(0);
  });

  it('fits a portrait image area to the box height', () => {
    const r = cardFitRect(2 / 3);
    expect(r.h).toBe(DECK.box.h);
    expect(r.w).toBeLessThan(DECK.box.w);
  });

  it('assumes 3:2 for RAW-only photos with no aspect yet', () => {
    expect(cardFitRect(null)).toEqual(cardFitRect(1.5));
  });
});
