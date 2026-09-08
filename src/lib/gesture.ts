// gesture.ts — one pointer hook for every tap / long-press / drag in the
// app, tuned to the thresholds in tokens.GESTURE so the same feel ports to
// React Native gesture handlers. State lives in a ref, never React state,
// so a drag in progress does not cause re-renders on every move.

import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { GESTURE } from '../tokens';
import { toFrame } from './frame';

export type GesturePoint = { x: number; y: number };

export type DragState = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  axis: 'x' | 'y' | null;
  projectedDx: number;
  projectedDy: number;
};

export type PointerGestureHandlers = {
  onPress?: (p: GesturePoint) => void;
  onRelease?: () => void;
  onTap?: (p: GesturePoint) => void;
  onLongPress?: (p: GesturePoint) => void;
  onDragStart?: (g: DragState) => void;
  onDragMove?: (g: DragState) => void;
  onDragEnd?: (g: DragState) => void;
};

export type PointerGestureOptions = {
  /** Skip stopPropagation() on pointer down, letting an ancestor gesture see it too. */
  propagate?: boolean;
  /** Enable long-press detection (the caller decides this from onLongPress's presence). */
  longPress?: boolean;
  /** Lock the drag to whichever axis the first past-slop move commits to. */
  axisLock?: boolean;
};

export type PointerGestureProps = {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
};

type Tracking = {
  pointerId: number;
  startX: number;
  startY: number;
  startT: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
  axis: 'x' | 'y' | null;
  dragging: boolean;
  longPressFired: boolean;
  longPressTimer: ReturnType<typeof setTimeout> | null;
};

function dragState(t: Tracking, x: number, y: number): DragState {
  const dx = x - t.startX;
  const dy = y - t.startY;
  return {
    x,
    y,
    dx,
    dy,
    vx: t.vx,
    vy: t.vy,
    axis: t.axis,
    projectedDx: dx + t.vx * GESTURE.projectMs,
    projectedDy: dy + t.vy * GESTURE.projectMs,
  };
}

export function usePointerGesture(
  handlers: PointerGestureHandlers,
  options: PointerGestureOptions = {},
): PointerGestureProps {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const tracking = useRef<Tracking | null>(null);

  const clearLongPressTimer = (t: Tracking) => {
    if (t.longPressTimer !== null) {
      clearTimeout(t.longPressTimer);
      t.longPressTimer = null;
    }
  };

  const finish = (e: ReactPointerEvent, cancelled: boolean) => {
    const t = tracking.current;
    if (!t || e.pointerId !== t.pointerId) return;
    clearLongPressTimer(t);
    tracking.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture already released — fine
    }

    const p = toFrame(e.clientX, e.clientY);
    const dx = p.x - t.startX;
    const dy = p.y - t.startY;
    const travel = Math.hypot(dx, dy);
    const held = performance.now() - t.startT;

    if (t.dragging) {
      handlersRef.current.onDragEnd?.(dragState(t, p.x, p.y));
    } else if (!cancelled && !t.longPressFired && travel < GESTURE.tapSlop && held < GESTURE.tapTime) {
      handlersRef.current.onTap?.(p);
    }
    handlersRef.current.onRelease?.();
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!e.isPrimary) return;
    // A right- or middle-click is primary too; only the left button gestures,
    // or a right-click on an Overlay would read as a tap and navigate back.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!optionsRef.current.propagate) e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // some targets (e.g. text nodes' parents mid-unmount) can't capture — fine
    }

    const p = toFrame(e.clientX, e.clientY);
    const now = performance.now();
    const t: Tracking = {
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      startT: now,
      lastX: p.x,
      lastY: p.y,
      lastT: now,
      vx: 0,
      vy: 0,
      axis: null,
      dragging: false,
      longPressFired: false,
      longPressTimer: null,
    };
    tracking.current = t;
    handlersRef.current.onPress?.(p);

    if (optionsRef.current.longPress) {
      t.longPressTimer = setTimeout(() => {
        if (tracking.current !== t || t.dragging) return;
        t.longPressFired = true;
        handlersRef.current.onLongPress?.({ x: t.lastX, y: t.lastY });
      }, GESTURE.longPress);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const t = tracking.current;
    if (!t || e.pointerId !== t.pointerId) return;

    const p = toFrame(e.clientX, e.clientY);
    const now = performance.now();
    const dt = Math.max(1, now - t.lastT);
    const alpha = GESTURE.velocityEma;
    t.vx += alpha * ((p.x - t.lastX) / dt - t.vx);
    t.vy += alpha * ((p.y - t.lastY) / dt - t.vy);
    t.lastX = p.x;
    t.lastY = p.y;
    t.lastT = now;

    const dx = p.x - t.startX;
    const dy = p.y - t.startY;

    if (!t.dragging) {
      if (Math.hypot(dx, dy) < GESTURE.tapSlop) return;
      clearLongPressTimer(t);
      if (t.longPressFired) return;
      t.dragging = true;
      if (optionsRef.current.axisLock) {
        t.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
      handlersRef.current.onDragStart?.(dragState(t, p.x, p.y));
      return;
    }
    handlersRef.current.onDragMove?.(dragState(t, p.x, p.y));
  };

  const onPointerUp = (e: ReactPointerEvent) => finish(e, false);
  const onPointerCancel = (e: ReactPointerEvent) => finish(e, true);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
