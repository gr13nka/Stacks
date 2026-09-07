// Overlay.tsx — the full-frame surface every non-main screen sits on: an
// opaque backdrop that fades in behind the hero, and a "chrome" slot (counter,
// buttons, hint) that rises in above it. The chrome slot itself is
// pointer-events: none so it never blocks taps on what's beneath it — only
// its own children (real buttons) opt back into receiving pointer events.
//
// Tapping anywhere a child did not claim (children built on usePointerGesture
// stop propagation on pointer down) calls `onTapEmpty` — the universal "go
// back" gesture, advertised by the muted hint at BACK.hintY.

import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import { BACK, CHROME, COLOR, FRAME, LAYER, MOTION, TYPE } from '../tokens';
import { usePointerGesture } from '../lib/gesture';
import { spring } from './springs';

type OverlayProps = {
  layer: number;
  chrome?: ReactNode;
  /** Tap on the backdrop (or any child that lets pointer events bubble). */
  onTapEmpty?: () => void;
  /** Hint line under the content; defaults to the back hint when onTapEmpty is set. */
  hint?: string | null;
  children?: ReactNode;
  style?: CSSProperties;
};

export function Overlay({ layer, chrome, onTapEmpty, hint, children, style }: OverlayProps) {
  const gesture = usePointerGesture({ onTap: () => onTapEmpty?.() });
  const hintText = hint === undefined ? (onTapEmpty ? 'tap here to go back' : null) : hint;

  return (
    <div {...gesture} style={{ position: 'absolute', inset: 0, zIndex: layer, ...style }}>
      <motion.div
        style={{ position: 'absolute', inset: 0, background: COLOR.ground }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: spring(MOTION.backdrop) }}
        exit={{ opacity: 0, transition: spring(MOTION.backdrop) }}
      />
      {children}
      <motion.div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: LAYER.chrome }}
        initial={{ y: CHROME.rise, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: spring(MOTION.chrome) }}
        exit={{ y: CHROME.rise, opacity: 0, transition: spring(MOTION.chrome) }}
      >
        {chrome}
        {hintText && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: BACK.hintY,
              width: FRAME.w,
              textAlign: 'center',
              color: COLOR.muted,
              fontSize: TYPE.caption.size,
              lineHeight: `${TYPE.caption.lineHeight}px`,
            }}
          >
            {hintText}
          </div>
        )}
      </motion.div>
    </div>
  );
}
