import { describe, expect, it } from 'vitest';
import { buildStacks } from './stacks';
import { photo } from './fixtures';

describe('buildStacks', () => {
  it('joins at exactly the gap and splits one second past it', () => {
    const joined = buildStacks([photo('a', '2024-11-01T10:00:00'), photo('b', '2024-11-01T13:00:00')], 3);
    expect(joined).toHaveLength(1);
    expect(joined[0].photoIds).toEqual(['a', 'b']);

    const split = buildStacks([photo('a', '2024-11-01T10:00:00'), photo('b', '2024-11-01T13:00:01')], 3);
    expect(split).toHaveLength(2);
  });

  it('orders ties by path and lists photos in capture order', () => {
    const stacks = buildStacks(
      [
        photo('z', '2024-11-01T10:00:00', { path: '/vol/DSCF0002.JPG' }),
        photo('y', '2024-11-01T10:00:00', { path: '/vol/DSCF0001.JPG' }),
        photo('x', '2024-11-01T09:00:00'),
      ],
      3,
    );
    expect(stacks[0].photoIds).toEqual(['x', 'y', 'z']);
    expect(stacks[0].id).toBe('card:x');
  });

  it('never merges photos from different volumes', () => {
    const stacks = buildStacks(
      [photo('a', '2024-11-01T10:00:00'), photo('b', '2024-11-01T10:01:00', { volumeId: 'local' })],
      3,
    );
    expect(stacks).toHaveLength(2);
    expect(stacks.map((s) => s.volumeId).sort()).toEqual(['card', 'local']);
  });

  it('attaches a stack to the day of its first photo and returns newest first', () => {
    const stacks = buildStacks(
      [
        photo('a', '2024-10-31T22:30:00'),
        photo('b', '2024-11-01T00:30:00'),
        photo('c', '2024-11-05T08:00:00'),
      ],
      3,
    );
    expect(stacks.map((s) => s.day)).toEqual(['2024-11-05', '2024-10-31']);
    expect(stacks[1].photoIds).toEqual(['a', 'b']);
    expect(stacks[1].startMs).toBeLessThan(stacks[1].endMs);
  });

  it('treats mtime-fallback photos like any other capture time', () => {
    const stacks = buildStacks(
      [
        photo('a', '2024-11-01T10:00:00'),
        photo('b', '2024-11-01T10:05:00', { takenAtSource: 'mtime' }),
      ],
      3,
    );
    expect(stacks).toHaveLength(1);
    expect(stacks[0].photoIds).toEqual(['a', 'b']);
  });

  it('a wider gap merges what a narrower one split', () => {
    const photos = [photo('a', '2024-11-01T10:00:00'), photo('b', '2024-11-01T13:10:00')];
    expect(buildStacks(photos, 3)).toHaveLength(2);
    expect(buildStacks(photos, 4)).toHaveLength(1);
  });
});
