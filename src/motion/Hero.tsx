// Hero.tsx — the shared-element FLIP every screen transition is built from.
// It is positioned at `to` and expresses `from` purely as an initial
// transform (translate + scale + rotate), so entering/exiting never needs
// to measure the DOM: every hero origin is a static rect from tokens.ts.

import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import { useRef } from 'react';
import type { RectRot } from '../tokens';
import { MOTION, rectCenter } from '../tokens';
import { spring } from './springs';

type HeroProps = {
  from: RectRot;
  to: RectRot;
  layer?: number;
  onEntered?: () => void;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Hero({ from, to, layer, onEntered, style, children }: HeroProps) {
  const fromCentre = rectCenter(from);
  const toCentre = rectCenter(to);
  const displaced = {
    x: fromCentre.x - toCentre.x,
    y: fromCentre.y - toCentre.y,
    scale: from.w / to.w,
    rotate: from.rot,
  };
  const entered = useRef(false);

  return (
    <motion.div
      style={{
        position: 'absolute',
        left: to.x,
        top: to.y,
        width: to.w,
        height: to.h,
        transformOrigin: '50% 50%',
        zIndex: layer,
        ...style,
      }}
      initial={displaced}
      animate={{ x: 0, y: 0, scale: 1, rotate: to.rot, transition: spring(MOTION.heroIn) }}
      exit={{ ...displaced, transition: spring(MOTION.heroOut) }}
      onAnimationComplete={() => {
        if (!entered.current) {
          entered.current = true;
          onEntered?.();
        }
      }}
    >
      {children}
    </motion.div>
  );
}
