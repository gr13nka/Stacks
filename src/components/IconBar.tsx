// IconBar.tsx — the top band: window drag region plus the four glyphs
// (calendar, places, rejects, settings). It sits above every screen so the
// user can jump between them from anywhere, by tap or by number key; the
// active one is in accent and the rejects glyph carries a count when the pile
// is non-empty. Where a tap goes is actions.showDestination's business, so the
// bar and the keyboard cannot drift apart.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { COLOR, FRAME, LAYER, TOPBAR, TOPBAR_SLOTS, TYPE, topbarTargetRect } from '../tokens';
import type { Destination } from '../tokens';
import { usePointerGesture } from '../lib/gesture';
import { actions, selectRejectCount, useStore } from '../store/store';
import { CalendarGlyph, PlacesGlyph, RejectsGlyph, SettingsGlyph } from './Icons';

const GLYPH: Record<Destination, ReactNode> = {
  calendar: <CalendarGlyph />,
  places: <PlacesGlyph />,
  rejects: <RejectsGlyph />,
  settings: <SettingsGlyph />,
};

export function IconBar() {
  const screen = useStore((s) => s.screen);
  const mode = useStore((s) => s.mode);
  const rejectCount = useStore(selectRejectCount);

  const active: Destination = screen === 'rejects' ? 'rejects' : screen === 'settings' ? 'settings' : mode;

  return (
    <div
      data-tauri-drag-region
      style={{ position: 'absolute', left: 0, top: 0, width: FRAME.w, height: TOPBAR.h, zIndex: LAYER.iconBar }}
    >
      {TOPBAR_SLOTS.map((slot, i) => (
        <IconButton
          key={slot}
          index={i}
          active={active === slot}
          count={slot === 'rejects' ? rejectCount : 0}
          onTap={() => actions.showDestination(slot)}
        >
          {GLYPH[slot]}
        </IconButton>
      ))}
    </div>
  );
}

type IconButtonProps = {
  index: number;
  active: boolean;
  count: number;
  onTap: () => void;
  children: ReactNode;
};

function IconButton({ index, active, count, onTap, children }: IconButtonProps) {
  const [pressed, setPressed] = useState(false);
  const gesture = usePointerGesture({
    onPress: () => setPressed(true),
    onRelease: () => setPressed(false),
    onTap,
  });
  const target = topbarTargetRect(index);
  const color = pressed ? COLOR.muted : active ? COLOR.accent : COLOR.ink;

  return (
    <div
      {...gesture}
      style={{
        position: 'absolute',
        left: target.x,
        top: target.y,
        width: target.w,
        height: target.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
      }}
    >
      {children}
      {count > 0 && (
        <div
          style={{
            position: 'absolute',
            left: target.w - 10,
            top: 0,
            color: COLOR.accent,
            fontSize: TYPE.badge.size + 1,
            lineHeight: `${TYPE.badge.lineHeight}px`,
            pointerEvents: 'none',
          }}
        >
          {count}
        </div>
      )}
    </div>
  );
}
