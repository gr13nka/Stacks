// Card.tsx — one card of the deck pile. Its own motion values (x, y,
// rotate, scale, opacity) are the single source of truth for where it is:
// the depth prop only ever springs them toward a pose (top, or one of
// DECK.behind), the pointer drags the top card's values directly, and a
// committed swipe drives them off-screen (keep) or onto the reject edge
// (remove) before the decision is recorded. Positioned inside the deck's
// hero box at its own fit rect so cards of different aspects all sit
// centred in DECK.box.
//
// A tap turns the top card clockwise. The turn lives on an inner layer with
// its own motion values (the card's `rotate` already carries pose, tilt and
// fly-out): it shows the store's pending turns at once, scaled to the rect
// the turned photo will get, and hands them over to the layout in the same
// frame the re-read photo (new aspect, new thumb) lands.

import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { Decision, Photo } from '../../api/types';
import { COLOR, DECK, MOTION, PRINT, rectCenter } from '../../tokens';
import type { RectRot } from '../../tokens';
import { usePointerGesture } from '../../lib/gesture';
import { settled, valueSpring } from '../../motion/springs';
import { cardFitRect, swipeDecision, turnedCardScale } from '../../domain/deck';
import { actions, useStore } from '../../store/store';
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

/** The short ease-out every deliberate card motion (decision, turn) shares. */
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * The inner turn layer's values: `turns` quarter turns shown on top of the
 * photo as its file currently has it, animated toward on every tap (and back
 * when a write fails). When a write lands, the file has absorbed n of those
 * turns and the card is re-laid out for its new aspect in the same render:
 * the current pose is re-expressed in the new layout (n·90° less, scale
 * divided by the n-turn factor) so nothing visibly moves, then any turns
 * still pending carry on from there.
 */
function useTurn(photo: Photo) {
  const turns = useStore((s) => s.pendingTurns[photo.id] ?? 0);
  const turn = useMotionValue(turns * 90);
  const turnScale = useMotionValue(turnedCardScale(photo.aspect, turns));
  const prev = useRef({ turns, orientation: photo.orientation, aspect: photo.aspect });

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { turns, orientation: photo.orientation, aspect: photo.aspect };
    if (before.turns === turns && before.orientation === photo.orientation) return;
    const rotate = turns * 90;
    const scale = turnedCardScale(photo.aspect, turns);
    if (before.orientation !== photo.orientation) {
      const n = before.turns - turns;
      turn.jump(turn.get() - n * 90);
      turnScale.jump(turnScale.get() / turnedCardScale(before.aspect, n));
    } else if ((turns - before.turns) % 4 === 0) {
      // A full circle settled without a write: the card already looks like this.
      turn.jump(rotate);
      turnScale.jump(scale);
    }
    if (Math.abs(turn.get() - rotate) < 1e-6 && Math.abs(turnScale.get() - scale) < 1e-6) return;
    const tween = { duration: DECK.turnMs / 1000, ease: EASE_OUT };
    const controls = [animate(turn, rotate, tween), animate(turnScale, scale, tween)];
    return () => controls.forEach((c) => c.stop());
  }, [turns, photo.orientation, photo.aspect, turn, turnScale]);

  return { turn, turnScale };
}

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
  const { turn, turnScale } = useTurn(photo);

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
    // Sorting is intentionally serialized, but the old springs could take
    // close to a second to report completion. A fixed short tween gives clear
    // feedback and makes the next card available in a predictable 150 ms.
    const flight = { duration: DECK.decisionMs / 1000, ease: EASE_OUT };
    let flights: Promise<void>[];
    if (d === 'keep') {
      flights = [
        settled(animate(x, DECK.flyX, flight)),
        settled(animate(rotate, DECK.flyRot, flight)),
      ];
    } else {
      // FLIP onto the reject edge: centre to centre, scaled by width, taking its tilt.
      const from = rectCenter(fit);
      const to = rectCenter(DECK.edge);
      flights = [
        settled(animate(x, to.x - from.x, flight)),
        settled(animate(y, to.y - from.y, flight)),
        settled(animate(scale, DECK.edge.w / fit.w, flight)),
        settled(animate(rotate, DECK.edge.rot, flight)),
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
      onTap: () => {
        if (flying.current) return;
        actions.rotate(photo.id);
      },
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
      <motion.div style={{ position: 'absolute', inset: 0, rotate: turn, scale: turnScale, transformOrigin: '50% 50%' }}>
        <Print photo={photo} w={fit.w} h={fit.h} border={PRINT.border.card} size={1600} stamp="card" />
      </motion.div>
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
