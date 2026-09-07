// Strip.tsx — one of the seven ribbons a swallowed print becomes: a slice
// of its 512 thumb that drops out from under the seam slot, tilting and
// fading, driven by the same progress value as the print it came from.

import { motion, useTransform } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import { api } from '../../api/api';
import type { Photo } from '../../api/types';
import { SHREDDER } from '../../tokens';
import { STRIP_W, stripPose } from '../../domain/shred';

type StripProps = { t: MotionValue<number>; i: number; photo: Photo };

export function Strip({ t, i, photo }: StripProps) {
  const y = useTransform(t, (v) => stripPose(v, i)?.y ?? 0);
  const rotate = useTransform(t, (v) => stripPose(v, i)?.rotate ?? 0);
  const opacity = useTransform(t, (v) => stripPose(v, i)?.opacity ?? 0);

  return (
    <motion.div
      style={{
        position: 'absolute',
        left: SHREDDER.pile.x + i * STRIP_W,
        top: SHREDDER.seam.y + SHREDDER.seam.h,
        width: STRIP_W,
        height: SHREDDER.print.h,
        overflow: 'hidden',
        y,
        rotate,
        opacity,
        transformOrigin: '50% 0%',
        zIndex: SHREDDER.z.strips,
        pointerEvents: 'none',
      }}
    >
      <img
        src={api.thumbUrl(photo, 512)}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: -i * STRIP_W,
          top: 0,
          width: SHREDDER.print.w,
          height: SHREDDER.print.h,
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </motion.div>
  );
}
