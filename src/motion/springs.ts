// springs.ts — turns a tokens.Spring preset into a framer-motion Transition.
// Keeping this conversion in one place is what lets tokens.ts stay a plain
// data file with no framer-motion (or React Native Reanimated) import.

import type { AnimationPlaybackControls, Transition } from 'framer-motion';
import type { Spring } from '../tokens';
import { hump } from '../tokens';

export function spring(s: Spring, velocity?: number): Transition {
  return {
    type: 'spring',
    stiffness: s.stiffness,
    damping: s.damping,
    mass: s.mass,
    ...(velocity !== undefined ? { velocity } : {}),
  };
}

// spring()'s return type is Transition — the type a motion.div's
// `transition` prop wants, which is too broad for standalone framer-motion
// animate(value, target, options): its imperative overloads only accept a
// literal `type: 'spring'`. valueSpring() narrows to that literal so every
// animate() call site can share one conversion instead of inlining it.
export function valueSpring(s: Spring, velocity?: number) {
  return {
    type: 'spring' as const,
    stiffness: s.stiffness,
    damping: s.damping,
    mass: s.mass,
    ...(velocity !== undefined ? { velocity } : {}),
  };
}

export { hump };

/** Resolves when an imperative animate() finishes (or is stopped). */
export function settled(controls: AnimationPlaybackControls): Promise<void> {
  return new Promise((resolve) => controls.then(() => resolve()));
}
