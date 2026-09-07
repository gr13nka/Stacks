// StackFan.tsx — the prints of one calendar day: the first session seated
// at the cell's tilt, every further session fanned up and to the right by
// CAL.fan so a busy day reads as a small spread of prints.

import { CAL } from '../../tokens';
import type { Rect } from '../../tokens';
import type { Stack } from '../../api/types';
import { StackPrint } from '../../components/StackPrint';
import type { OpenStack } from '../../components/StackPrint';

type StackFanProps = {
  stacks: Stack[];
  cell: Rect;
  tilt: number;
  row: number;
  onOpen: OpenStack;
};

export function StackFan({ stacks, cell, tilt, row, onOpen }: StackFanProps) {
  return (
    <>
      {stacks.map((stack, k) => (
        <StackPrint
          key={stack.id}
          stack={stack}
          x={cell.x + CAL.printInset.x + k * CAL.fan.dx}
          y={cell.y + CAL.printInset.y + k * CAL.fan.dy}
          rot={tilt + k * CAL.fan.rot}
          z={CAL.z.seatedBase + row * CAL.cols + k}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}
