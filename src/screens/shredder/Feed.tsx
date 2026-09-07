// Feed.tsx — one reject on the shredder pile and everything that happens
// to it. First it may fly in from its reject-grid cell (Flight); then it
// sits at its pile seat. One progress value t (0 seated, 1 swallowed)
// drives its pose through feedPose; crossing SHREDDER.knee reports the
// swallow (the seam jolts) and mounts the seven strips, which read the same
// t. A failed shred springs t back to 0 (feedReturn).

import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../../api/types';
import { MOTION, REJECTS, SHREDDER } from '../../tokens';
import type { RectRot } from '../../tokens';
import { valueSpring } from '../../motion/springs';
import { feedPose, pileSeat } from '../../domain/shred';
import { Flight } from '../../components/Flight';
import { Print } from '../../components/Print';
import { Strip } from './Strip';

export type FeedPhase = 'seated' | 'feeding' | 'returning';

type FeedProps = {
  photo: Photo;
  /** Pile seat, 0 = bottom. */
  seat: number;
  /** Feed order, 0 = first to go. */
  order: number;
  /** performance.now() when the feed started; null while seated. */
  startAt: number | null;
  stagger: number;
  phase: FeedPhase;
  /** Grid print rect to fly in from, or null to just appear on the pile. */
  from: RectRot | null;
  /** Whether to draw the seated print (deep pile members wait unseen). */
  drawn: boolean;
  onSwallow: () => void;
  onDone: () => void;
};

export function Feed({ photo, seat, order, startAt, stagger, phase, from, drawn, onSwallow, onDone }: FeedProps) {
  const seatRect = pileSeat(seat);
  const t = useMotionValue(0);
  const [origin] = useState(from);
  const [landed, setLanded] = useState(origin === null);
  const [strips, setStrips] = useState(false);
  const stripsRef = useRef(false);
  const swallowed = useRef(false);
  const onSwallowRef = useRef(onSwallow);
  onSwallowRef.current = onSwallow;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const y = useTransform(t, (v) => feedPose(v, seatRect.rot).y);
  const rotate = useTransform(t, (v) => feedPose(v, seatRect.rot).rotate);
  const scale = useTransform(t, (v) => feedPose(v, seatRect.rot).scale);

  useMotionValueEvent(t, 'change', (v) => {
    const past = v >= SHREDDER.knee;
    if (past !== stripsRef.current) {
      stripsRef.current = past;
      setStrips(past);
    }
    if (past && !swallowed.current) {
      swallowed.current = true;
      onSwallowRef.current();
    }
  });

  useEffect(() => {
    if (phase === 'feeding') {
      swallowed.current = false;
      const delay = Math.max(0, (startAt ?? performance.now()) + order * stagger - performance.now());
      let cancelled = false;
      const controls = animate(t, 1, { ...valueSpring(MOTION.feed), delay: delay / 1000 });
      void controls.then(() => {
        if (!cancelled) onDoneRef.current();
      });
      return () => {
        cancelled = true;
        controls.stop();
      };
    }
    if (phase === 'returning') {
      const controls = animate(t, 0, valueSpring(MOTION.feedReturn));
      return () => controls.stop();
    }
    t.set(0);
    return undefined;
  }, [phase, startAt, order, stagger, t]);

  return (
    <>
      {!landed && origin ? (
        <Flight from={origin} to={seatRect} delay={order * SHREDDER.flightStagger} layer={SHREDDER.z.flight} onDone={() => setLanded(true)}>
          <Print photo={photo} w={REJECTS.print.w} h={REJECTS.print.h} border={SHREDDER.print.border} size={512} tape />
        </Flight>
      ) : drawn ? (
        <motion.div
          style={{
            position: 'absolute',
            left: seatRect.x,
            top: seatRect.y,
            width: seatRect.w,
            height: seatRect.h,
            y,
            rotate,
            scale,
            transformOrigin: '50% 50%',
            zIndex: SHREDDER.z.pile + seat,
            pointerEvents: 'none',
          }}
        >
          <Print photo={photo} w={SHREDDER.print.w} h={SHREDDER.print.h} border={SHREDDER.print.border} size={512} tape />
        </motion.div>
      ) : null}
      {strips && Array.from({ length: SHREDDER.strips }, (_, i) => <Strip key={i} t={t} i={i} photo={photo} />)}
    </>
  );
}
