// Scroller.tsx — the native vertical scroller both list screens share. It
// stacks blocks of known heights (pure arithmetic from tokens), mounts only
// the blocks within ±CAL.windowScreens of the viewport, and gives each block
// a converter from block-local rects to frame rects so a tapped print can
// hand the hero an exact take-off rect without anyone measuring the DOM.

import type { ReactNode, UIEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CAL, FRAME } from '../tokens';
import type { RectRot } from '../tokens';
import { blockOffsets } from '../domain/calendar';

export type ToFrame = (local: RectRot) => RectRot;
export type BlockRender = (i: number, mounted: boolean, toFrame: ToFrame) => ReactNode;

type ScrollerProps = {
  /** Block heights in order; keep the array identity stable between renders. */
  heights: number[];
  keys: string[];
  render: BlockRender;
};

type Range = readonly [number, number];

function windowRange(offsets: number[], scrollTop: number): Range {
  const n = offsets.length - 1;
  const lo = scrollTop - CAL.windowScreens * CAL.scrollerH;
  const hi = scrollTop + CAL.scrollerH + CAL.windowScreens * CAL.scrollerH;
  let first = 0;
  while (first < n && offsets[first + 1] <= lo) first += 1;
  let last = n - 1;
  while (last >= 0 && offsets[last] >= hi) last -= 1;
  return [first, last];
}

const sameRange = (a: Range, b: Range) => a[0] === b[0] && a[1] === b[1];

export function Scroller({ heights, keys, render }: ScrollerProps) {
  const offsets = useMemo(() => blockOffsets(heights), [heights]);
  const scrollTop = useRef(0);
  const frame = useRef<number | null>(null);
  const [range, setRange] = useState<Range>(() => windowRange(offsets, 0));

  useEffect(() => {
    const next = windowRange(offsets, scrollTop.current);
    setRange((r) => (sameRange(r, next) ? r : next));
  }, [offsets]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    scrollTop.current = e.currentTarget.scrollTop;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const next = windowRange(offsets, scrollTop.current);
      setRange((r) => (sameRange(r, next) ? r : next));
    });
  };

  const toFrameFor =
    (i: number): ToFrame =>
    (local) => ({ ...local, y: local.y + offsets[i] - scrollTop.current + CAL.scrollerY });

  return (
    <div
      className="scroller"
      onScroll={onScroll}
      style={{ position: 'absolute', left: 0, top: CAL.scrollerY, width: FRAME.w, height: CAL.scrollerH }}
    >
      <div style={{ position: 'relative', width: FRAME.w, height: offsets[offsets.length - 1] }}>
        {heights.map((h, i) => (
          <div key={keys[i]} style={{ position: 'absolute', left: 0, top: offsets[i], width: FRAME.w, height: h }}>
            {render(i, i >= range[0] && i <= range[1], toFrameFor(i))}
          </div>
        ))}
      </div>
    </div>
  );
}
