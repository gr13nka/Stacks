// DayCell.tsx — one day of a month block: the day number (muted; accent
// once every stack of the day is sorted) and the fan of the day's stacks
// that still have cards to sort.

import { CAL, COLOR, TYPE } from '../../tokens';
import { dayCellRect } from '../../domain/calendar';
import type { OpenStack } from '../../components/StackPrint';
import { selectStackStates, selectStacksById, useStore } from '../../store/store';
import { StackFan } from './StackFan';

type DayCellProps = {
  /** Cell index: the last day of the month is 0. */
  i: number;
  day: number;
  stackIds: readonly string[];
  onOpen: OpenStack;
};

export function DayCell({ i, day, stackIds, onOpen }: DayCellProps) {
  const stacksById = useStore(selectStacksById);
  const states = useStore(selectStackStates);
  const cell = dayCellRect(i);

  const stacks = stackIds.flatMap((id) => stacksById.get(id) ?? []);
  const undone = stacks.filter((st) => states.get(st.id)?.status !== 'done');
  const allDone = stacks.length > 0 && undone.length === 0;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: cell.x + CAL.dayNumber.x,
          top: cell.y + CAL.dayNumber.y,
          color: allDone ? COLOR.accent : COLOR.muted,
          fontSize: TYPE.day.size,
          lineHeight: `${TYPE.day.lineHeight}px`,
          pointerEvents: 'none',
        }}
      >
        {day}
      </div>
      {undone.length > 0 && (
        <StackFan
          stacks={undone}
          cell={cell}
          tilt={CAL.tilt[i % CAL.tilt.length]}
          row={Math.floor(i / CAL.cols)}
          onOpen={onOpen}
        />
      )}
    </>
  );
}
