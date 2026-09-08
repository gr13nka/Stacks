// DeckScreen.tsx — the Tinder-style pass over one stack. The hero flies
// the tapped cell print into the fit rect of the first card and then hosts
// the CardPile; the counter and the reject edge live in the chrome slot.
// The keyboard's decide commands are claimed here because only the mounted
// top card can run them; everything else it binds is a plain store action.

import { useEffect, useRef, useState } from 'react';
import type { Decision, Photo } from '../api/types';
import { LAYER } from '../tokens';
import { cardFitRect } from '../domain/deck';
import { setScreenKeys } from '../lib/keys';
import { Overlay } from '../motion/Overlay';
import { Hero } from '../motion/Hero';
import { actions, selectDeckQueue, selectStackState, useStore } from '../store/store';
import { CardPile } from './deck/CardPile';
import type { CardHandle } from './deck/Card';
import { Counter } from './deck/Counter';
import { RejectEdge } from './deck/RejectEdge';

export function DeckScreen() {
  const stackId = useStore((s) => s.openStackId);
  const origin = useStore((s) => s.heroOrigin);
  const queue = useStore((s) => selectDeckQueue(s, stackId));
  const state = useStore((s) => (stackId ? selectStackState(s, stackId) : undefined));

  // The hero box is fixed by the first card's aspect; later cards lay themselves out inside it.
  const [anchor] = useState(() => cardFitRect(queue[0]?.aspect ?? state?.top?.aspect ?? null));
  const from = origin ?? anchor;
  const topRef = useRef<CardHandle>(null);

  useEffect(() => {
    setScreenKeys('deck', {
      reject: () => topRef.current?.commit('remove'),
      keep: () => topRef.current?.commit('keep'),
    });
    return () => setScreenKeys('deck', null);
  }, []);

  const onDecided = (photo: Photo, d: Decision) => actions.decide(photo.id, d);

  return (
    <Overlay
      layer={LAYER.deck}
      onTapEmpty={actions.goBack}
      hint="← out · → keep · ↓ undo · tap to go back"
      chrome={
        <>
          <Counter state={state} remaining={queue.length} />
          <RejectEdge />
        </>
      }
    >
      {/* Always mounted: Hero expresses `from` as an initial transform, so
          remounting it after an undo emptied the pile would replay the whole
          opening flight from the calendar cell. */}
      <Hero from={from} to={anchor} layer={LAYER.deck}>
        <CardPile queue={queue} anchor={anchor} topRef={topRef} onDecided={onDecided} />
      </Hero>
    </Overlay>
  );
}
