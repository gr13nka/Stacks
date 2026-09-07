// Flight.tsx — a print in flight from one rect to another (reject → pile,
// grid cell → pile). Pure presentation: the caller computes both rects in
// frame coords; this springs between them with a single transform, laying
// its child out at `from` size and scaling it to `to`. Reports once, when
// the flight lands.

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import type { RectRot } from '../tokens';
import { LAYER, MOTION, rectCenter } from '../tokens';
import { spring } from '../motion/springs';

type FlightProps = {
  from: RectRot;
  to: RectRot;
  layer?: number;
  /** ms before take-off (stagger). */
  delay?: number;
  onDone?: () => void;
  children?: ReactNode;
};

export function Flight({ from, to, layer = LAYER.flight, delay = 0, onDone, children }: FlightProps) {
  const fromCentre = rectCenter(from);
  const toCentre = rectCenter(to);
  const landed = useRef(false);

  return (
    <motion.div
      style={{
        position: 'absolute',
        left: from.x,
        top: from.y,
        width: from.w,
        height: from.h,
        transformOrigin: '50% 50%',
        zIndex: layer,
        pointerEvents: 'none',
      }}
      initial={{ x: 0, y: 0, scale: 1, rotate: from.rot }}
      animate={{
        x: toCentre.x - fromCentre.x,
        y: toCentre.y - fromCentre.y,
        scale: to.w / from.w,
        rotate: to.rot,
        transition: { ...spring(MOTION.flight), delay: delay / 1000 },
      }}
      onAnimationComplete={() => {
        if (landed.current) return;
        landed.current = true;
        onDone?.();
      }}
    >
      {children}
    </motion.div>
  );
}
