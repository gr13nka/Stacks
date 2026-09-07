// RejectCell.tsx — one taped print in the reject grid. Sits at its cell via
// a transform (so re-layouts after a rescue glide rather than jump) and,
// on tap, does the rescue spring (1 → 1.08 → 0, fading) before the store
// forgets the decision and the cell disappears.

import { animate, motion, useMotionValue } from 'framer-motion';
import { useRef } from 'react';
import type { Photo } from '../../api/types';
import { MOTION, PRINT, REJECTS } from '../../tokens';
import type { Rect } from '../../tokens';
import { settled, spring, valueSpring } from '../../motion/springs';
import { Pickable } from '../../components/Pickable';
import { Print } from '../../components/Print';
import { actions } from '../../store/store';

const RESCUE_LIFT = 1.08;

type RejectCellProps = {
  photo: Photo;
  cell: Rect;
  /** While the hero still stands in for this print. */
  hidden: boolean;
};

export function RejectCell({ photo, cell, hidden }: RejectCellProps) {
  const scale = useMotionValue(1);
  const opacity = useMotionValue(1);
  const rescuing = useRef(false);

  const rescue = () => {
    if (rescuing.current) return;
    rescuing.current = true;
    const snap = valueSpring(MOTION.rescue);
    void settled(animate(scale, RESCUE_LIFT, snap))
      .then(() => Promise.all([settled(animate(scale, 0, snap)), settled(animate(opacity, 0, snap))]))
      .then(() => actions.undecide(photo.id));
  };

  const inset = (cell.w - REJECTS.print.w) / 2;

  return (
    <motion.div
      style={{ position: 'absolute', left: 0, top: 0, width: cell.w, height: cell.h }}
      initial={false}
      animate={{ x: cell.x, y: cell.y }}
      transition={spring(MOTION.chrome)}
    >
      <motion.div
        style={{
          position: 'absolute',
          left: inset,
          top: inset,
          scale,
          opacity,
          transformOrigin: '50% 50%',
          visibility: hidden ? 'hidden' : 'visible',
        }}
      >
        <Pickable onTap={rescue}>
          <Print photo={photo} w={REJECTS.print.w} h={REJECTS.print.h} border={PRINT.border.reject} size={512} tape stamp="cell" />
        </Pickable>
      </motion.div>
    </motion.div>
  );
}
