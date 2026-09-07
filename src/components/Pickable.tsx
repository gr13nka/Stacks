// Pickable.tsx — the press-and-hold "pick up" every physical object in the
// app shares: a small scale/tilt/shadow spring while held, driven entirely
// by the pointer-down state (no drag distance needed to feel it lift).

import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { MOTION, PICKUP, SHADOW } from '../tokens';
import type { DragState, GesturePoint } from '../lib/gesture';
import { usePointerGesture } from '../lib/gesture';
import { spring } from '../motion/springs';

type PickableProps = {
  rot?: number;
  /** 'box' lifts the paper shadow while held; 'none' leaves shadows to the child. */
  shadow?: 'box' | 'none';
  onTap?: () => void;
  onLongPress?: (p: GesturePoint) => void;
  onDragStart?: (g: DragState) => void;
  onDragMove?: (g: DragState) => void;
  onDragEnd?: (g: DragState) => void;
  hidden?: boolean;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
};

export function Pickable({
  rot = 0,
  shadow = 'none',
  onTap,
  onLongPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  hidden,
  style,
  className,
  children,
}: PickableProps) {
  const [picked, setPicked] = useState(false);
  const gesture = usePointerGesture(
    {
      onPress: () => setPicked(true),
      onRelease: () => setPicked(false),
      onTap,
      onLongPress,
      onDragStart,
      onDragMove,
      onDragEnd,
    },
    { longPress: Boolean(onLongPress) },
  );

  const shadowProp = shadow === 'box' ? { boxShadow: picked ? SHADOW.lifted : SHADOW.rest } : undefined;

  return (
    <motion.div
      {...gesture}
      className={className}
      style={{ display: 'inline-block', ...style, visibility: hidden ? 'hidden' : 'visible' }}
      animate={{
        scale: picked ? PICKUP.scale : 1,
        rotate: picked ? rot + PICKUP.rotate : rot,
        ...shadowProp,
      }}
      transition={spring(picked ? MOTION.press : MOTION.release)}
    >
      {children}
    </motion.div>
  );
}
