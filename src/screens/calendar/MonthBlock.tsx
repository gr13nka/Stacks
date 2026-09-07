// MonthBlock.tsx — one month of the calendar: a header (what's left to do,
// or the year for older months; the month name in accent on the right) and
// a cell per day counting down from the last day. Unmounted blocks render
// nothing: their height is fixed by the scroller, so scrolling never jumps.

import { CAL, COLOR, TYPE } from '../../tokens';
import type { Month } from '../../api/types';
import { monthName } from '../../domain/time';
import { dayCellIndex } from '../../domain/calendar';
import { Caption } from '../../components/Caption';
import type { OpenStack } from '../../components/StackPrint';
import { selectCaption, useStore } from '../../store/store';
import { DayCell } from './DayCell';

const NO_STACKS: readonly string[] = [];

type MonthBlockProps = {
  month: Month;
  newest: boolean;
  mounted: boolean;
  onOpen: OpenStack;
};

export function MonthBlock({ month, newest, mounted, onOpen }: MonthBlockProps) {
  const caption = useStore((s) => (newest ? selectCaption(s) : String(month.year)));
  if (!mounted) return null;

  const days = Array.from({ length: month.days }, (_, k) => month.days - k);

  return (
    <>
      <Caption style={{ position: 'absolute', left: CAL.marginX, top: CAL.header.captionY }}>{caption}</Caption>
      <div
        style={{
          position: 'absolute',
          right: CAL.marginX,
          top: CAL.header.monthY,
          color: COLOR.accent,
          fontSize: TYPE.month.size,
          lineHeight: `${TYPE.month.lineHeight}px`,
        }}
      >
        {monthName(month.month)}
      </div>
      {days.map((day) => (
        <DayCell
          key={day}
          i={dayCellIndex(day, month.days)}
          day={day}
          stackIds={month.byDay[day] ?? NO_STACKS}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}
