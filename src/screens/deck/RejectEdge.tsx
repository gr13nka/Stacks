// RejectEdge.tsx — the reject pile peeking in at the deck's lower-left
// edge: the last removed print, taped and greyed, with the pile count. It
// bumps (jolt) whenever a card lands on it and opens the pile on tap.

import { animate, motion, useMotionValue } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { COLOR, DECK, MOTION, PRINT } from '../../tokens';
import { settled, valueSpring } from '../../motion/springs';
import { Caption } from '../../components/Caption';
import { Pickable } from '../../components/Pickable';
import { Print } from '../../components/Print';
import { actions, selectRejects, useStore } from '../../store/store';

export function RejectEdge() {
  const rejects = useStore(selectRejects);
  const top = rejects[0];
  const count = rejects.length;
  const scale = useMotionValue(1);
  const seen = useRef(count);

  useEffect(() => {
    if (count > seen.current) {
      void settled(animate(scale, DECK.edgeJolt, valueSpring(MOTION.jolt))).then(() =>
        animate(scale, 1, valueSpring(MOTION.release)),
      );
    }
    seen.current = count;
  }, [count, scale]);

  if (!top) return null;

  return (
    <>
      <motion.div
        style={{
          position: 'absolute',
          left: DECK.edge.x,
          top: DECK.edge.y,
          width: DECK.edge.w,
          height: DECK.edge.h,
          rotate: DECK.edge.rot,
          scale,
          transformOrigin: '50% 50%',
          pointerEvents: 'auto',
        }}
      >
        <Pickable onTap={() => actions.openRejects({ ...DECK.edge })}>
          <Print
            photo={top}
            w={DECK.edge.w}
            h={DECK.edge.h}
            border={PRINT.border.reject}
            size={512}
            tape
            style={{ filter: 'grayscale(0.6)' }}
          />
        </Pickable>
      </motion.div>
      <Caption tone="ink" style={{ position: 'absolute', left: DECK.edgeCount.x, top: DECK.edgeCount.y, color: COLOR.ink }}>
        {count} out
      </Caption>
    </>
  );
}
