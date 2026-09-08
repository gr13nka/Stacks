// keys.ts — the app's only keydown listener. domain/keys decides what a chord
// means; this decides who runs it. Most commands are store actions, but a few
// need a screen's own imperative state — the deck's top card owns the fly-out,
// the shredder owns the feed counters — so a screen may claim those commands
// for as long as it is mounted, exactly as App claims the frame element in
// lib/frame.ts.

import { useEffect } from 'react';
import type { Command } from '../domain/keys';
import { resolveKey } from '../domain/keys';
import { actions, getState } from '../store/store';
import type { Screen } from '../store/types';

/** The commands a screen runs itself, because they need its local state. */
export type ScreenKeys = Partial<Record<Command, () => void>>;

const claimed = new Map<Screen, ScreenKeys>();

/** Claimed by a screen while it is mounted, and cleared on unmount. */
export function setScreenKeys(screen: Screen, keys: ScreenKeys | null): void {
  if (keys) claimed.set(screen, keys);
  else claimed.delete(screen);
}

/** Keys belong to a text field while one has focus (the place-name input). */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function run(screen: Screen, command: Command): void {
  const own = claimed.get(screen)?.[command];
  if (own) {
    own();
    return;
  }
  switch (command) {
    // Only the deck's top card can fly, and it claims these while it is mounted.
    case 'reject':
    case 'keep':
    case 'shred:start':
      break;
    case 'undo:decision':
      actions.undoLastDecision();
      break;
    case 'undo:shred':
      void actions.undoShred();
      break;
    case 'back':
      actions.goBack();
      break;
    case 'shred:open':
      actions.openShredder();
      break;
    case 'go:calendar':
      actions.showDestination('calendar');
      break;
    case 'go:places':
      actions.showDestination('places');
      break;
    case 'go:rejects':
      actions.showDestination('rejects');
      break;
    case 'go:settings':
      actions.showDestination('settings');
      break;
  }
}

/** Mounted once, by App. */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Auto-repeat would rip through a stack on a held arrow key.
      if (e.repeat || isTyping(e.target)) return;
      const screen = getState().screen;
      const command = resolveKey(screen, { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey });
      if (!command) return;
      e.preventDefault();
      run(screen, command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
