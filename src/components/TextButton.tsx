// TextButton.tsx — the only button in the app. No fill, no border, no
// icon, ever: pressed state is expressed purely as a text colour change.

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { COLOR, TYPE } from '../tokens';
import { usePointerGesture } from '../lib/gesture';

type TextButtonProps = {
  label: string;
  tone?: 'active' | 'muted' | 'accent' | 'paper';
  onTap?: () => void;
  style?: CSSProperties;
};

const TONE = { active: COLOR.ink, muted: COLOR.muted, accent: COLOR.accent, paper: COLOR.paper } as const;

export function TextButton({ label, tone = 'active', onTap, style }: TextButtonProps) {
  const [pressed, setPressed] = useState(false);
  const gesture = usePointerGesture({
    onPress: () => setPressed(true),
    onRelease: () => setPressed(false),
    onTap: () => onTap?.(),
  });

  const color = pressed ? COLOR.muted : TONE[tone];

  return (
    <button
      {...gesture}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 44,
        color,
        fontSize: TYPE.label.size,
        lineHeight: `${TYPE.label.lineHeight}px`,
        pointerEvents: 'auto',
        ...style,
      }}
    >
      {label}
    </button>
  );
}
