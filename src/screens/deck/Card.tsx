// Card.tsx — one card of the deck pile. Its own motion values (x, y,
// rotate, scale, opacity) are the single source of truth for where it is:
// the depth prop only ever springs them toward a pose (top, or one of
// DECK.behind), the pointer drags the top card's values directly, and a
// committed swipe drives them off-screen (keep) or onto the reject edge
// (remove) before the decision is recorded. Positioned inside the deck's
// hero box at its own fit rect so cards of different aspects all sit
// centred in DECK.box.

import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Decision, Photo } from '../../api/types';
import { COLOR, DECK, MOTION, PRINT, rectCenter } from '../../tokens';
import type { RectRot } from '../../tokens';
import { usePointerGesture } from '../../lib/gesture';
import { settled, valueSpring } from '../../motion/springs';
import { cardFitRect, swipeDecision } from '../../domain/deck';
import { Print, RejectTape } from '../../components/Print';

export type CardHandle = { commit(d: Decision): void };

type CardProps = {
  photo: Photo;
  depth: number;
  /** The hero box (frame coords) this card is laid out inside. */
  anchor: RectRot;
  onDecided: (photo: Photo, d: Decision) => void;
};

type Pose = { y: number; rot: number; scale: number };

const TOP_POSE: Pose = { y: 0, rot: 0, scale: 1 };

function behindPose(depth: number): Pose {
  const b = DECK.behind[Math.min(depth, DECK.behind.length) - 1];
  return { y: b.dy, rot: b.rot, scale: b.scale };
}

/** Newcomers deal in from the deepest slot. */
const ENTER_POSE = behindPose(DECK.behind.length);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const Card = forwardRef<CardHandle, CardProps>(function Card({ photo, depth, anchor, onDecided }, ref) {
  const fit = cardFitRect(photo.aspect);
  const isTop = depth === 0;
  const start = isTop ? TOP_POSE : ENTER_POSE;

  const x = useMotionValue(0);
  const y = useMotionValue(start.y);
  const rotate = useMotionValue(start.rot);
  const scale = useMotionValue(start.scale);
  const opacity = useMotionValue(isTop ? 1 : 0);
  const flying = useRef(false);
  const mounted = useRef(false);

  const outOpacity = useTransform(x, (v) => clamp01((-v - DECK.hint.dx) / DECK.hint.fade));
  const keepOpacity = useTransform(x, (v) => clamp01((v - DECK.hint.dx) / DECK.hint.fade));

  // Settle into the pose for this depth: promoted cards glide forward
  // (cardPromote); a card mounting behind deals in from the back (behindEnter).
  useEffect(() => {
    if (flying.current) return;
    const entering = !mounted.current && !isTop;
    mounted.current = true;
    const pose = isTop ? TOP_POSE : behindPose(depth);
    const preset = valueSpring(entering ? MOTION.behindEnter : MOTION.cardPromote);
    const controls = [
      animate(y, pose.y, preset),
      animate(rotate, pose.rot, preset),
      animate(scale, pose.scale, preset),
      animate(opacity, 1, preset),
    ];
    return () => controls.forEach((c) => c.stop());
  }, [depth, isTop, y, rotate, scale, opacity]);

  const fly = (d: Decision, vx: number) => {
    if (flying.current) return;
    flying.current = true;
    const velocity = vx * 1000; // px/ms → px/s, the unit framer-motion springs take
    let flights: Promise<void>[];
    if (d === 'keep') {
      flights = [
        settled(animate(x, DECK.flyX, valueSpring(MOTION.cardKeep, velocity))),
        settled(animate(rotate, DECK.flyRot, valueSpring(MOTION.cardKeep))),
      ];
    } else {
      // FLIP onto the reject edge: centre to centre, scaled by width, taking its tilt.
      const from = rectCenter(fit);
      const to = rectCenter(DECK.edge);
      const s = valueSpring(MOTION.cardReject);
      flights = [
        settled(animate(x, to.x - from.x, valueSpring(MOTION.cardReject, velocity))),
        settled(animate(y, to.y - from.y, s)),
        settled(animate(scale, DECK.edge.w / fit.w, s)),
        settled(animate(rotate, DECK.edge.rot, s)),
      ];
    }
    void Promise.all(flights).then(() => onDecided(photo, d));
  };
  const flyRef = useRef(fly);
  flyRef.current = fly;

  useImperativeHandle(ref, () => ({ commit: (d) => flyRef.current(d, 0) }), []);

  const returnHome = () => {
    const s = valueSpring(MOTION.cardReturn);
    animate(x, 0, s);
    animate(y, 0, s);
    animate(rotate, 0, s);
  };

  const gesture = usePointerGesture(
    {
      onDragMove: (g) => {
        if (flying.current) return;
        y.set(g.dy * DECK.dragY);
        if (g.axis === 'y') return;
        x.set(g.dx);
        rotate.set(g.dx * DECK.tiltPerPx);
      },
      onDragEnd: (g) => {
        if (flying.current) return;
        const d = g.axis === 'y' ? null : swipeDecision(g.projectedDx, g.vx);
        if (d) fly(d, g.vx);
        else returnHome();
      },
    },
    { axisLock: true },
  );

  // Cards behind the top one are inert, but must not let a tap fall through to the overlay's back gesture.
  const pointerProps = isTop ? gesture : { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  return (
    <motion.div
      {...pointerProps}
      style={{
        position: 'absolute',
        left: fit.x - anchor.x,
        top: fit.y - anchor.y,
        width: fit.w,
        height: fit.h,
        x,
        y,
        rotate,
        scale,
        opacity,
        zIndex: DECK.pileSize - depth,
        transformOrigin: '50% 50%',
        touchAction: 'none',
      }}
    >
      <Print photo={photo} w={fit.w} h={fit.h} border={PRINT.border.card} size={1600} stamp="card" />
      <motion.div style={{ position: 'absolute', inset: 0, opacity: outOpacity, pointerEvents: 'none' }}>
        <RejectTape w={fit.w} />
      </motion.div>
      <motion.div
        style={{ position: 'absolute', right: DECK.tick.inset, top: DECK.tick.inset, opacity: keepOpacity, pointerEvents: 'none' }}
      >
        <KeepTick />
      </motion.div>
    </motion.div>
  );
});

function KeepTick() {
  const s = DECK.tick.size;
  return (
    <svg width={s} height={s} viewBox="0 0 56 56" fill="none">
      <path d="M12 30l11 11 21-26" stroke={COLOR.paper} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 30l11 11 21-26" stroke={COLOR.accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
