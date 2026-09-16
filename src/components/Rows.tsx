// Rows.tsx — the list vocabulary of the settings and location screens: a
// ROW.h row with a label and trailing controls, a two-line row (title over a
// caption) that can itself be the tap target, and a muted section header.
// A row that is not tappable claims no pointer, so a tap on it falls through
// to the Overlay's back gesture like any other empty space.

import type { ReactNode } from 'react';
import { useState } from 'react';
import { COLOR, ROW, TYPE } from '../tokens';
import { usePointerGesture } from '../lib/gesture';
import { Caption } from './Caption';

const rowStyle = { height: ROW.h, display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as const;

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={rowStyle}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{children}</div>
    </div>
  );
}

export function Label({ children, color = COLOR.ink }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ color, fontSize: TYPE.label.size, lineHeight: `${TYPE.label.lineHeight}px`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {children}
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return <Caption style={{ marginTop: ROW.sectionGap, height: ROW.h / 2, lineHeight: `${ROW.h / 2}px` }}>{children}</Caption>;
}

type TwoLineRowProps = {
  title: ReactNode;
  caption?: ReactNode;
  /** Keep the caption's case (paths); everything else is lowercased by .phone. */
  keepCase?: boolean;
  /** Makes the whole row the tap target, dimming the title while pressed. */
  onTap?: () => void;
  /** Trailing controls. */
  children?: ReactNode;
};

export function TwoLineRow({ title, caption, keepCase = false, onTap, children }: TwoLineRowProps) {
  const [pressed, setPressed] = useState(false);
  const gesture = usePointerGesture({
    onPress: () => setPressed(true),
    onRelease: () => setPressed(false),
    onTap: () => onTap?.(),
  });

  return (
    <div {...(onTap ? gesture : {})} style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Label color={pressed ? COLOR.muted : COLOR.ink}>{title}</Label>
        {caption !== undefined && (
          <Caption style={{ overflow: 'hidden', textOverflow: 'ellipsis', ...(keepCase ? { textTransform: 'none' } : {}) }}>
            {caption}
          </Caption>
        )}
      </div>
      {children}
    </div>
  );
}
