// Seam.tsx — the shredder's mouth: a dark cavity panel from the seam line
// to the bottom of the frame, with a lip highlight and lip shadow, and the
// lighter slot the prints go into. The cavity sits above the feeding prints
// (SHREDDER.z.cavity) so a print sliding down is cut off at the seam. The
// slot jolts (scaleY) every time a print is swallowed; the countdown sits
// beneath it.

import { animate, motion, useMotionValue } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { COLOR, FRAME, MOTION, SHADOW, SHREDDER } from '../../tokens';
import { settled, valueSpring } from '../../motion/springs';
import { Caption } from '../../components/Caption';

type SeamProps = {
  /** Increments on every swallowed print. */
  jolts: number;
  /** Prints still to go, or null to hide the countdown. */
  remaining: number | null;
};

export function Seam({ jolts, remaining }: SeamProps) {
  const scaleY = useMotionValue(1);
  const seen = useRef(jolts);

  useEffect(() => {
    if (jolts > seen.current) {
      void settled(animate(scaleY, SHREDDER.jolt, valueSpring(MOTION.jolt))).then(() =>
        animate(scaleY, 1, valueSpring(MOTION.release)),
      );
    }
    seen.current = jolts;
  }, [jolts, scaleY]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: SHREDDER.seam.y,
        width: FRAME.w,
        height: FRAME.h - SHREDDER.seam.y,
        background: COLOR.cavity,
        boxShadow: SHADOW.seamLip,
        zIndex: SHREDDER.z.cavity,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 1, background: 'rgba(255,255,255,0.14)' }} />
      <motion.div
        style={{
          position: 'absolute',
          left: (FRAME.w - SHREDDER.slotW) / 2,
          top: 0,
          width: SHREDDER.slotW,
          height: SHREDDER.seam.h,
          background: COLOR.seam,
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.7)',
          scaleY,
          transformOrigin: '50% 0%',
        }}
      />
      {remaining !== null && (
        <Caption
          style={{
            position: 'absolute',
            left: 0,
            top: SHREDDER.seam.h + SHREDDER.counterDy,
            width: FRAME.w,
            textAlign: 'center',
            color: 'rgba(251,251,247,0.6)',
          }}
        >
          {remaining} left
        </Caption>
      )}
    </div>
  );
}
