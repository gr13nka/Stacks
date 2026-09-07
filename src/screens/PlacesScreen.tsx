// PlacesScreen.tsx — the main screen in places mode: one block per place
// (most recent first, the GPS-less "somewhere" last) in the shared scroller.

import { useMemo } from 'react';
import { FRAME, gridBlockHeight } from '../tokens';
import { Scroller } from '../components/Scroller';
import { Caption } from '../components/Caption';
import { actions, selectCaption, selectPlaces, useStore } from '../store/store';
import { PlaceBlock } from './places/PlaceBlock';

const EMPTY_CAPTION_Y = 200;

export function PlacesScreen() {
  const places = useStore(selectPlaces);
  const heights = useMemo(() => places.map((p) => gridBlockHeight(p.stackIds.length)), [places]);
  const keys = useMemo(() => places.map((p) => p.id), [places]);

  if (places.length === 0) return <EmptyState />;

  return (
    <Scroller
      heights={heights}
      keys={keys}
      render={(i, mounted, toFrame) => (
        <PlaceBlock
          place={places[i]}
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
