// DateStamp.tsx — the orange film date stamp burnt into a print's corner.
// One size (TYPE.stamp); the cell variant is the same glyphs scaled down
// from the bottom-right corner so it still looks like the same stamp.

import { PRINT, SHADOW, TYPE, COLOR } from '../tokens';
import { formatStamp } from '../domain/time';

type DateStampProps = {
  ms: number;
  variant?: 'card' | 'cell';
};

export function DateStamp({ ms, variant = 'card' }: DateStampProps) {
  const inset = PRINT.stampInset[variant];
  const scale = PRINT.stampScale[variant];
  return (
    <div
      style={{
        position: 'absolute',
        right: inset,
        bottom: inset,
        color: COLOR.stamp,
        fontSize: TYPE.stamp.size,
        lineHeight: `${TYPE.stamp.lineHeight}px`,
        fontWeight: TYPE.stamp.weight,
        letterSpacing: TYPE.stamp.letterSpacing,
        textShadow: SHADOW.stampGlow,
        transform: `scale(${scale})`,
        transformOrigin: '100% 100%',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {formatStamp(ms)}
    </div>
  );
}
