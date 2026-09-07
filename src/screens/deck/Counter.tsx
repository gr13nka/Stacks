// Counter.tsx — "7 of 24" with the running keep / out tally beneath; reads
// "stack done :)" once the queue is empty.

import { COLOR, DECK, TYPE } from '../../tokens';
import type { StackState } from '../../domain/deck';
import { Caption } from '../../components/Caption';

type CounterProps = { state: StackState | undefined; remaining: number };

export function Counter({ state, remaining }: CounterProps) {
  if (!state) return null;
  const main = remaining === 0 ? 'stack done :)' : `${state.decided + 1} of ${state.total}`;
  const tally = state.decided > 0 ? `kept ${state.kept} · out ${state.removed}` : null;
  return (
    <div style={{ position: 'absolute', left: DECK.counter.x, top: DECK.counter.y }}>
      <div style={{ color: COLOR.ink, fontSize: TYPE.label.size, lineHeight: `${TYPE.label.lineHeight}px` }}>{main}</div>
      {tally && <Caption>{tally}</Caption>}
    </div>
  );
}
