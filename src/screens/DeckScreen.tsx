// DeckScreen.tsx — Phase 1 placeholder for the deck: the overlay, the
// counter chrome and the hero flight from the tapped cell to the top card's
// rect are final; Phase 2 replaces the lone Print with CardPile / RejectEdge.

import { DECK, LAYER, PRINT } from '../tokens';
import { cardFitRect } from '../domain/deck';
import { Overlay } from '../motion/Overlay';
import { Hero } from '../motion/Hero';
import { Caption } from '../components/Caption';
import { Print } from '../components/Print';
import { actions, selectDeckQueue, selectStackState, useStore } from '../store/store';

export function DeckScreen() {
  const stackId = useStore((s) => s.openStackId);
  const origin = useStore((s) => s.heroOrigin);
  const queue = useStore((s) => selectDeckQueue(s, stackId));
  const stack = useStore((s) => (stackId ? selectStackState(s, stackId) : undefined));

  const top = queue[0] ?? stack?.top ?? null;
  const to = cardFitRect(top?.aspect ?? null);
  const from = origin ?? to;
  const counter = !stack
    ? ''
    : queue.length === 0
      ? 'stack done :)'
      : `${stack.decided + 1} of ${stack.total}`;

  return (
    <Overlay
      layer={LAYER.deck}
      onTapEmpty={actions.goBack}
      chrome={<Caption style={{ position: 'absolute', left: DECK.counter.x, top: DECK.counter.y }}>{counter}</Caption>}
    >
      {top && (
        <Hero from={from} to={to} layer={LAYER.deck}>
          <div onPointerDown={(e) => e.stopPropagation()}>
            <Print photo={top} w={to.w} h={to.h} border={PRINT.border.card} size={1600} stamp="card" />
          </div>
        </Hero>
      )}
    </Overlay>
  );
}
