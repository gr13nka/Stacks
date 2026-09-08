// CalendarScreen.tsx — the main screen in calendar mode: months newest
// first in the shared scroller, each a MonthBlock of countdown days. A
// tapped print's block-local rect is converted to frame coords by the
// scroller (month top − scrollTop + scroller top) and becomes the deck's
// hero origin.

import { useMemo } from 'react';
import { FRAME } from '../tokens';
import { monthBlockHeight } from '../domain/calendar';
import { Scroller } from '../components/Scroller';
import { Caption } from '../components/Caption';
import { actions, selectCaption, selectMonths, useStore } from '../store/store';
import { MonthBlock } from './calendar/MonthBlock';

const EMPTY_CAPTION_Y = 280;

export function CalendarScreen() {
  const months = useStore(selectMonths);
  const heights = useMemo(() => months.map((m) => monthBlockHeight(m.days)), [months]);
  const keys = useMemo(() => months.map((m) => m.key), [months]);

  if (months.length === 0) return <EmptyState />;

  return (
    <Scroller
      heights={heights}
      keys={keys}
      render={(i, mounted, toFrame) => (
        <MonthBlock
          month={months[i]}
          newest={i === 0}
          mounted={mounted}
          onOpen={(stackId, local) => actions.openStack(stackId, toFrame(local))}
        />
      )}
    />
  );
}

function EmptyState() {
  const caption = useStore(selectCaption);
  return (
    <Caption style={{ position: 'absolute', left: 0, top: EMPTY_CAPTION_Y, width: FRAME.w, textAlign: 'center' }}>
      {caption}
    </Caption>
  );
}
