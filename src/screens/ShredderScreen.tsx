// ShredderScreen.tsx — Phase 1 placeholder: the overlay and its back gesture
// are final; Phase 2 adds the pile, the seam, Feed and the trash call.

import { DECK, LAYER } from '../tokens';
import { Overlay } from '../motion/Overlay';
import { Caption } from '../components/Caption';
import { actions } from '../store/store';

export function ShredderScreen() {
  return (
    <Overlay
      layer={LAYER.shredder}
      onTapEmpty={actions.goBack}
      chrome={<Caption style={{ position: 'absolute', left: DECK.counter.x, top: DECK.counter.y }}>shredder</Caption>}
    />
  );
}
