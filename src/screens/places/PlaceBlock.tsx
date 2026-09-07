// PlaceBlock.tsx — one place: its editable name and stack count in the
// header, then a cell per stack (newest first) showing the stack's top
// print with a small date stamp, on the same grid as the calendar.

import { CAL } from '../../tokens';
import { gridCellRect } from '../../tokens';
import type { Place } from '../../api/types';
import { Caption } from '../../components/Caption';
import { StackPrint } from '../../components/StackPrint';
import type { OpenStack } from '../../components/StackPrint';
import { selectStacksById, useStore } from '../../store/store';
import { PlaceName } from './PlaceName';

type PlaceBlockProps = {
  place: Place;
  mounted: boolean;
  onOpen: OpenStack;
};

export function PlaceBlock({ place, mounted, onOpen }: PlaceBlockProps) {
  const stacksById = useStore(selectStacksById);
  if (!mounted) return null;

  const n = place.stackIds.length;

  return (
    <>
      <PlaceName place={place} />
      <Caption style={{ position: 'absolute', right: CAL.marginX, top: CAL.header.captionY }}>
        {n} {n === 1 ? 'stack' : 'stacks'}
      </Caption>
      {place.stackIds.map((id, i) => {
        const stack = stacksById.get(id);
        if (!stack) return null;
        const cell = gridCellRect(i);
        return (
          <StackPrint
            key={id}
            stack={stack}
            x={cell.x + CAL.printInset.x}
            y={cell.y + CAL.printInset.y}
            rot={CAL.tilt[i % CAL.tilt.length]}
            z={CAL.z.seatedBase + Math.floor(i / CAL.cols)}
            stamp
            onOpen={onOpen}
          />
        );
      })}
    </>
  );
}
