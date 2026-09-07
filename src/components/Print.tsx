// Print.tsx — a physical photo print: a paper slab with a white border
// around the thumbnail, the paper shadow stack every flat paper object in
// the app uses, and the marks a print can carry — the RAW badge, the film
// date stamp and the orange reject tape. The image is a lazily loaded
// thumbnail served by the api at one of its two sizes.

import type { CSSProperties } from 'react';
import { api } from '../api/api';
import type { ThumbSize } from '../api/api';
import type { Photo } from '../api/types';
import { COLOR, PRINT, REJECTS, SHADOW, TYPE } from '../tokens';
import { takenMs } from '../domain/stacks';
import { DateStamp } from './DateStamp';

type PrintProps = {
  photo: Photo;
  w: number;
  h: number;
  /** Paper border width (PRINT.border.*). */
  border: number;
  size: ThumbSize;
  stamp?: 'card' | 'cell' | false;
  tape?: boolean;
  /** Show the "raw" pill when the photo has a RAW twin (default on). */
  badge?: boolean;
  shadow?: boolean;
  style?: CSSProperties;
};

export function Print({ photo, w, h, border, size, stamp = false, tape = false, badge = true, shadow = true, style }: PrintProps) {
  return (
    <div
      style={{
        position: 'relative',
        width: w,
        height: h,
        background: COLOR.paper,
        boxShadow: shadow ? `${SHADOW.paperInset}, ${SHADOW.rest}` : SHADOW.paperInset,
        ...style,
      }}
    >
      <div style={{ position: 'absolute', inset: border, overflow: 'hidden', background: COLOR.edge }}>
        <img
          src={api.thumbUrl(photo, size)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
        />
        {badge && photo.rawPath && <RawBadge />}
        {stamp && <DateStamp ms={takenMs(photo)} variant={stamp} />}
      </div>
      {tape && <RejectTape w={w} />}
      <div style={{ position: 'absolute', right: 0, top: 0, width: 1, height: '100%', background: COLOR.edge }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 1, background: COLOR.edge }} />
    </div>
  );
}

function RawBadge() {
  return (
    <div
      style={{
        position: 'absolute',
        left: PRINT.rawBadge.pad,
        top: PRINT.rawBadge.pad,
        height: PRINT.rawBadge.h,
        padding: `0 ${PRINT.rawBadge.pad}px`,
        borderRadius: PRINT.rawBadge.h / 2,
        background: COLOR.ink,
        color: COLOR.paper,
        fontSize: TYPE.badge.size,
        lineHeight: `${TYPE.badge.lineHeight}px`,
        pointerEvents: 'none',
      }}
    >
      raw
    </div>
  );
}

/** The reject tape: an orange strip across the whole slab, multiplied into the print. */
export function RejectTape({ w }: { w: number }) {
  const tapeW = w * PRINT.tape.w;
  const tapeH = Math.round(PRINT.tape.h * Math.min(1, w / REJECTS.print.w)); // full height from the reject grid size up
  return (
    <div
      style={{
        position: 'absolute',
        left: (w - tapeW) / 2,
        top: '50%',
        marginTop: -tapeH / 2,
        width: tapeW,
        height: tapeH,
        background: COLOR.stamp,
        opacity: PRINT.tape.opacity,
        mixBlendMode: 'multiply',
        transform: `rotate(${PRINT.tape.rot}deg)`,
        pointerEvents: 'none',
      }}
    />
  );
}
