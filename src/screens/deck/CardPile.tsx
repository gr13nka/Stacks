// CardPile.tsx — the top DECK.pileSize cards of the queue as per-item Card
// components keyed by photo id, so a decision simply drops the first key
// and every remaining card springs one slot forward.

import type { Ref } from 'react';
import type { Decision, Photo } from '../../api/types';
import { DECK } from '../../tokens';
import type { RectRot } from '../../tokens';
import { Card } from './Card';
import type { CardHandle } from './Card';

type CardPileProps = {
  queue: Photo[];
  anchor: RectRot;
  topRef: Ref<CardHandle>;
  onDecided: (photo: Photo, d: Decision) => void;
};

export function CardPile({ queue, anchor, topRef, onDecided }: CardPileProps) {
  return (
    <>
      {queue.slice(0, DECK.pileSize).map((photo, i) => (
        <Card key={photo.id} ref={i === 0 ? topRef : null} photo={photo} depth={i} anchor={anchor} onDecided={onDecided} />
      ))}
    </>
  );
}
