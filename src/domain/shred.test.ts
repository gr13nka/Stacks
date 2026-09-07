import { describe, expect, it } from 'vitest';
import { SHREDDER } from '../tokens';
import { feedPose, feedStagger, isLocked, pileSeat, shredMessage, stripPose } from './shred';
import { photo } from './fixtures';

describe('feedStagger', () => {
  it('uses the nominal stagger for small piles and compresses big ones', () => {
    expect(feedStagger(1)).toBe(0);
    expect(feedStagger(5)).toBe(SHREDDER.feedStagger);
    expect(feedStagger(101)).toBe(SHREDDER.maxFeedMs / 100);
    expect(100 * feedStagger(101)).toBeLessThanOrEqual(SHREDDER.maxFeedMs);
  });
});

describe('feedPose', () => {
  it('starts seated and ends 60% below the seam, straight and slightly smaller', () => {
    expect(feedPose(0, -4)).toEqual({ y: 0, rotate: -4, scale: 1 });
    const end = feedPose(1, -4);
    expect(SHREDDER.pile.y + end.y).toBeCloseTo(SHREDDER.seam.y + SHREDDER.print.h * SHREDDER.sink);
    expect(end.rotate).toBeCloseTo(0);
    expect(end.scale).toBeCloseTo(SHREDDER.feedScale);
  });
});

describe('stripPose', () => {
  it('has no strips before the knee and fades them out by the bottom of the fall', () => {
    expect(stripPose(0.5, 0)).toBeNull();
    const atKnee = stripPose(SHREDDER.knee, 2)!;
    expect(atKnee.y).toBe(2 * SHREDDER.stripStep);
    expect(atKnee.opacity).toBe(1);
    const done = stripPose(1, 1)!;
    expect(done.y).toBe(SHREDDER.stripFall + SHREDDER.stripStep);
    expect(done.opacity).toBe(0);
    expect(done.rotate).toBe(SHREDDER.stripTilt);
    expect(stripPose(1, 0)!.rotate).toBe(-SHREDDER.stripTilt);
    expect(stripPose(1.2, 0)!.opacity).toBe(0); // spring overshoot is clamped
  });
});

describe('pile and locks', () => {
  it('cycles the pile tilts', () => {
    expect(pileSeat(0).rot).toBe(SHREDDER.pileTilt[0]);
    expect(pileSeat(SHREDDER.pileTilt.length).rot).toBe(SHREDDER.pileTilt[0]);
    expect(pileSeat(1)).toMatchObject(SHREDDER.pile);
  });

  it('is locked only when a reject sits on a read-only volume', () => {
    const volumes = [
      { id: 'card', name: 'card', path: '/Volumes/CARD', kind: 'card' as const, readOnly: true, hasDcim: true },
      { id: 'local', name: 'local', path: '/Users/me', kind: 'folder' as const, readOnly: false, hasDcim: false },
    ];
    expect(isLocked([photo('a', '2024-11-01T10:00:00', { volumeId: 'local' })], volumes)).toBe(false);
    expect(isLocked([photo('a', '2024-11-01T10:00:00')], volumes)).toBe(true);
  });

  it('words the failure by reason', () => {
    const failure = (reason: 'read-only' | 'missing' | 'other') => ({ id: 'x', path: '/x', reason, message: '' });
    expect(shredMessage({ trashed: [], failed: [failure('other'), failure('read-only')] })).toBe(
      'card is write-protected — flip the lock tab',
    );
    expect(shredMessage({ trashed: [], failed: [failure('missing')] })).toBe('1 file could not be moved');
    expect(shredMessage({ trashed: [], failed: [failure('other'), failure('other')] })).toBe('2 files could not be moved');
  });
});
