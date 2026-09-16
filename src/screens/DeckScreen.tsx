// DeckScreen.tsx — the Tinder-style pass over one stack. The hero flies
// the tapped cell print into the fit rect of the first card and then hosts
// the CardPile; the counter and the reject edge live in the chrome slot.
// Arrow keys decide, Escape goes back, a tap on the top card turns it.

import { useEffect, useRef, useState } from 'react';
import type { Decision, Photo } from '../api/types';
import { LAYER } from '../tokens';
import { cardFitRect } from '../domain/deck';
import { Overlay } from '../motion/Overlay';
import { Hero } from '../motion/Hero';
import { actions, getState, selectDeckQueue, selectStackState, useStore } from '../store/store';
import { CardPile } from './deck/CardPile';
import type { CardHandle } from './deck/Card';
import { Counter } from './deck/Counter';
import { RejectEdge } from './deck/RejectEdge';

export function DeckScreen() {
  const stackId = useStore((s) => s.openStackId);
  const origin = useStore((s) => s.heroOrigin);
  const queue = useStore((s) => selectDeckQueue(s, stackId));
  const state = useStore((s) => (stackId ? selectStackState(s, stackId) : undefined));
  const notice = useStore((s) => s.notice);

  // The hero box is fixed by the first card's aspect; later cards lay themselves out inside it.
  const [anchor] = useState(() => cardFitRect(queue[0]?.aspect ?? state?.top?.aspect ?? null));
  const from = origin ?? anchor;
  const topRef = useRef<CardHandle>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (getState().screen !== 'deck') return;
      if (e.key === 'ArrowLeft') topRef.current?.commit('remove');
      else if (e.key === 'ArrowRight') topRef.current?.commit('keep');
      else if (e.key === 'Escape') actions.goBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDecided = (photo: Photo, d: Decision) => actions.decide(photo.id, d);

  return (
    <Overlay
      layer={LAYER.deck}
      onTapEmpty={actions.goBack}
      hint={notice ?? undefined} // e.g. why a tapped card would not turn; the back hint otherwise
      chrome={
        <>
          <Counter state={state} remaining={queue.length} />
          <RejectEdge />
        </>
      }
    >
      {queue.length > 0 && (
        <Hero from={from} to={anchor} layer={LAYER.deck}>
          <CardPile queue={queue} anchor={anchor} topRef={topRef} onDecided={onDecided} />
        </Hero>
      )}
    </Overlay>
  );
}
