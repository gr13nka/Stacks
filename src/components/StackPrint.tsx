// StackPrint.tsx — the seated 58×58 print that stands for one stack in a
// list cell (calendar day or place). It shows the stack's top photo, carries
// the partial-progress hairline, hides while its stack is open (the deck's
// hero is standing in for it), and hands its own rect up on tap so the
// hero can take off from exactly here. A long press opens the location
// picker for the stack, from either list.

import { CAL, COLOR } from '../tokens';
import type { RectRot } from '../tokens';
import type { Stack } from '../api/types';
import { actions, selectStackState, useStore } from '../store/store';
import { Pickable } from './Pickable';
import { Print } from './Print';

export type OpenStack = (stackId: string, localRect: RectRot) => void;

type StackPrintProps = {
  stack: Stack;
  /** Top-left of the print in the block's coordinate space. */
  x: number;
  y: number;
  rot: number;
  z: number;
  stamp?: boolean;
  onOpen: OpenStack;
};

export function StackPrint({ stack, x, y, rot, z, stamp = false, onOpen }: StackPrintProps) {
  const state = useStore((s) => selectStackState(s, stack.id));
  const hidden = useStore((s) => s.openStackId === stack.id);
  const photo = state?.top;
  if (!state || !photo) return null;

  const { w, h, border } = CAL.print;
  const progress = state.total > 0 ? state.decided / state.total : 0;
  const partial = progress > 0 && progress < 1;

  return (
    <>
      <Pickable
        rot={rot}
        hidden={hidden}
        onTap={() => onOpen(stack.id, { x, y, w, h, rot })}
        onLongPress={() => actions.openLocate(stack.id)}
        style={{ position: 'absolute', left: x, top: y, zIndex: z }}
      >
        <Print photo={photo} w={w} h={h} border={border} size={512} stamp={stamp ? 'cell' : false} />
      </Pickable>
      {partial && (
        <div
          style={{
            position: 'absolute',
            left: x,
            top: y + h + CAL.hairline.gap,
            width: w * progress,
            height: CAL.hairline.h,
            background: COLOR.accent,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
}
