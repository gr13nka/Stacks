// IconBar.tsx — the top band: window drag region plus the four glyphs
// (calendar, places, rejects, settings). It sits above every screen so the
// user can jump between them from anywhere; the active one is in accent and
// the rejects glyph carries a count when the pile is non-empty.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { COLOR, FRAME, LAYER, TOPBAR, TYPE, topbarTargetRect } from '../tokens';
import { usePointerGesture } from '../lib/gesture';
import { actions, selectRejectCount, useStore } from '../store/store';
import { CalendarGlyph, PlacesGlyph, RejectsGlyph, SettingsGlyph } from './Icons';

type Slot = 'calendar' | 'places' | 'rejects' | 'settings';

const SLOTS: { key: Slot; glyph: ReactNode }[] = [
  { key: 'calendar', glyph: <CalendarGlyph /> },
  { key: 'places', glyph: <PlacesGlyph /> },
  { key: 'rejects', glyph: <RejectsGlyph /> },
  { key: 'settings', glyph: <SettingsGlyph /> },
];

export function IconBar() {
  const screen = useStore((s) => s.screen);
  const mode = useStore((s) => s.mode);
  const rejectCount = useStore(selectRejectCount);

  const active: Slot = screen === 'rejects' ? 'rejects' : screen === 'settings' ? 'settings' : mode;

  const tap = (slot: Slot, i: number) => {
    switch (slot) {
      case 'calendar':
      case 'places':
        actions.showMain(slot);
        break;
      case 'rejects':
        if (screen === 'rejects') actions.goBack();
        else actions.openRejects({ ...topbarTargetRect(i), rot: 0 });
        break;
      case 'settings':
        if (screen === 'settings') actions.goBack();
        else actions.openSettings();
        break;
    }
  };

  return (
    <div
      data-tauri-drag-region
      style={{ position: 'absolute', left: 0, top: 0, width: FRAME.w, height: TOPBAR.h, zIndex: LAYER.iconBar }}
    >
      {SLOTS.map((slot, i) => (
        <IconButton
          key={slot.key}
          index={i}
          active={active === slot.key}
          count={slot.key === 'rejects' ? rejectCount : 0}
          onTap={() => tap(slot.key, i)}
        >
          {slot.glyph}
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
