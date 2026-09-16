import { describe, expect, it } from 'vitest';
import { rotateOrientation } from './orientation';

describe('rotateOrientation', () => {
  it('turns the unmirrored values clockwise 1 → 6 → 3 → 8 → 1', () => {
    expect([1, 6, 3, 8].map((o) => rotateOrientation(o, 1))).toEqual([6, 3, 8, 1]);
  });

  it('turns the mirrored values clockwise 2 → 7 → 4 → 5 → 2', () => {
    expect([2, 7, 4, 5].map((o) => rotateOrientation(o, 1))).toEqual([7, 4, 5, 2]);
  });

  it('composes turns, wraps full circles and accepts counter-clockwise', () => {
    expect(rotateOrientation(1, 2)).toBe(3);
    expect(rotateOrientation(6, 4)).toBe(6);
    expect(rotateOrientation(1, -1)).toBe(8);
    expect(rotateOrientation(7, -3)).toBe(4);
  });

  it('treats an out-of-range value as upright', () => {
    expect(rotateOrientation(0, 1)).toBe(6);
    expect(rotateOrientation(9, 0)).toBe(1);
  });
});
