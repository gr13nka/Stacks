// keys.ts — the app's whole keyboard language as one pure lookup. A laptop
// needs to cull without reaching for the trackpad: the arrows decide, z (or
// the down arrow) takes the last thing back, escape leaves a screen, enter
// carries the reject pile one step towards the shredder, and the digits reach
// the four icon-bar destinations from anywhere, because the icon bar floats
// over every screen.
//
// Every Command means exactly one thing, so the dispatcher never has to ask
// which screen it is on: undoing a swipe and undoing a shred are different
// commands even though both are bound to z.
//
// Modified chords are never ours: ⌘W, ⌘Q and friends belong to macOS.
//
// The Screen import is a type, erased at compile time, so this module stays
// pure and free of any runtime edge to the store.

import type { Screen } from '../store/types';

export type Command =
  | 'reject'
  | 'keep'
  | 'undo:decision'
  | 'undo:shred'
  | 'back'
  | 'shred:open'
  | 'shred:start'
  | 'go:calendar'
  | 'go:places'
  | 'go:rejects'
  | 'go:settings';

/** A KeyboardEvent reduced to what the language cares about. */
export type KeyChord = { key: string; meta: boolean; ctrl: boolean; alt: boolean };

type Bindings = Record<string, Command | undefined>;

/** The four icon-bar destinations, reachable from every screen. */
const DESTINATIONS: Bindings = {
  '1': 'go:calendar',
  '2': 'go:places',
  '3': 'go:rejects',
  '4': 'go:settings',
};

/** What a screen claims for itself. Escape and the destinations fill in the rest. */
const SCREEN_KEYS: Record<Screen, Bindings> = {
  main: {},
  deck: { ArrowLeft: 'reject', ArrowRight: 'keep', ArrowDown: 'undo:decision', z: 'undo:decision' },
  rejects: { Enter: 'shred:open' },
  shredder: { Enter: 'shred:start', ArrowDown: 'undo:shred', z: 'undo:shred' },
  settings: {},
};

/** The command this chord means on this screen, or null if the app ignores it. */
export function resolveKey(screen: Screen, chord: KeyChord): Command | null {
  if (chord.meta || chord.ctrl || chord.alt) return null;
  // Printable keys are matched case-insensitively; named keys arrive capitalised.
  const key = chord.key.length === 1 ? chord.key.toLowerCase() : chord.key;
  const bound = SCREEN_KEYS[screen][key];
  if (bound) return bound;
  // The main screen is the bottom of the stack: there is nothing to go back to.
  if (key === 'Escape') return screen === 'main' ? null : 'back';
  return DESTINATIONS[key] ?? null;
}
