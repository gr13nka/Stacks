// Caption.tsx — one line of small secondary text (counters, hints, headers).

import type { CSSProperties, ReactNode } from 'react';
import { COLOR, TYPE } from '../tokens';

type CaptionProps = {
  tone?: 'muted' | 'ink' | 'accent';
  style?: CSSProperties;
  children?: ReactNode;
};

const TONE = { muted: COLOR.muted, ink: COLOR.ink, accent: COLOR.accent } as const;

export function Caption({ tone = 'muted', style, children }: CaptionProps) {
  return (
    <div
      style={{
        color: TONE[tone],
        fontSize: TYPE.caption.size,
        lineHeight: `${TYPE.caption.lineHeight}px`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
