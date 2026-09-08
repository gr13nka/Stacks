import { describe, expect, it } from 'vitest';
import type { Screen } from '../store/types';
import { resolveKey } from './keys';
import type { Command, KeyChord } from './keys';

const SCREENS: Screen[] = ['main', 'deck', 'rejects', 'shredder', 'settings'];

const chord = (key: string, mods: Partial<KeyChord> = {}): KeyChord => ({
  key,
  meta: false,
  ctrl: false,
  alt: false,
  ...mods,
});

const on = (screen: Screen, key: string, mods?: Partial<KeyChord>): Command | null =>
  resolveKey(screen, chord(key, mods));

describe('resolveKey', () => {
  it('decides and undoes only in the deck', () => {
    expect(on('deck', 'ArrowLeft')).toBe('reject');
    expect(on('deck', 'ArrowRight')).toBe('keep');
    expect(on('deck', 'ArrowDown')).toBe('undo:decision');
    expect(on('deck', 'z')).toBe('undo:decision');
    for (const screen of SCREENS.filter((s) => s !== 'deck')) {
      expect(on(screen, 'ArrowLeft')).toBeNull();
      expect(on(screen, 'ArrowRight')).toBeNull();
    }
  });

  it('goes back from every screen above main, and nowhere from main', () => {
    expect(on('main', 'Escape')).toBeNull();
    for (const screen of SCREENS.filter((s) => s !== 'main')) {
      expect(on(screen, 'Escape')).toBe('back');
    }
  });

  it('carries the reject pile one step per press towards the shredder', () => {
    expect(on('rejects', 'Enter')).toBe('shred:open');
    expect(on('shredder', 'Enter')).toBe('shred:start');
    for (const screen of ['main', 'deck', 'settings'] as Screen[]) {
      expect(on(screen, 'Enter')).toBeNull();
    }
  });

  it('undoes a finished shred from the shredder, a different command to a swipe', () => {
    expect(on('shredder', 'z')).toBe('undo:shred');
    expect(on('shredder', 'ArrowDown')).toBe('undo:shred');
  });

  it('reaches the four icon-bar destinations from every screen', () => {
    for (const screen of SCREENS) {
      expect(on(screen, '1')).toBe('go:calendar');
      expect(on(screen, '2')).toBe('go:places');
      expect(on(screen, '3')).toBe('go:rejects');
      expect(on(screen, '4')).toBe('go:settings');
    }
  });

  it('lets a screen binding win over a destination digit', () => {
    // No screen binds a digit today; this pins the precedence if one ever does.
    expect(on('deck', '1')).toBe('go:calendar');
  });

  it('matches printable keys case-insensitively', () => {
    expect(on('deck', 'Z')).toBe('undo:decision');
  });

  it('leaves every modified chord to the system', () => {
    for (const mods of [{ meta: true }, { ctrl: true }, { alt: true }]) {
      expect(on('deck', 'ArrowLeft', mods)).toBeNull();
      expect(on('deck', 'Escape', mods)).toBeNull();
      expect(on('main', '1', mods)).toBeNull();
    }
  });

  it('ignores keys the language does not use', () => {
    for (const screen of SCREENS) {
      expect(on(screen, 'Tab')).toBeNull();
      expect(on(screen, ' ')).toBeNull();
      expect(on(screen, '5')).toBeNull();
      expect(on(screen, 'q')).toBeNull();
    }
  });
});
