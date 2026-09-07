// RejectsScreen.tsx — Phase 1 placeholder: the overlay and its back gesture
// are final; Phase 2 adds the hero from DECK.edge, the grid and "shred n".

import { DECK, LAYER } from '../tokens';
import { Overlay } from '../motion/Overlay';
import { Caption } from '../components/Caption';
import { actions, selectRejectCount, useStore } from '../store/store';

export function RejectsScreen() {
  const count = useStore(selectRejectCount);
  return (
    <Overlay
      layer={LAYER.rejects}
      onTapEmpty={actions.goBack}
      chrome={
        <Caption style={{ position: 'absolute', left: DECK.counter.x, top: DECK.counter.y }}>
          rejects · {count} out
        </Caption>
      }
    />
  );
}
