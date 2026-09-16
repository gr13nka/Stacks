// PlaceName.tsx — a place's name in the block header: the user's label,
// else the offline geocode, else a placeholder. Tap to edit in place in a
// TextField, which keeps the case the user types.

import { useState } from 'react';
import { CAL, COLOR, FRAME, TYPE } from '../../tokens';
import type { Place } from '../../api/types';
import { usePointerGesture } from '../../lib/gesture';
import { TextField } from '../../components/TextField';
import { actions, selectPlaceName, useStore } from '../../store/store';

const NAME_W = FRAME.w - 2 * CAL.marginX - 110; // leaves room for the "n stacks" caption

type PlaceNameProps = { place: Place };

export function PlaceName({ place }: PlaceNameProps) {
  const name = useStore((s) => selectPlaceName(s, place));
  const editable = useStore((s) => s.placeLabels[place.id] ?? s.placeNames[place.id]?.name ?? '');
  const [draft, setDraft] = useState<string | null>(null);
  const gesture = usePointerGesture({ onTap: () => setDraft(editable) });

  const commit = () => {
    if (draft === null) return;
    actions.setPlaceLabel(place.id, draft);
    setDraft(null);
  };

  const textStyle = {
    position: 'absolute' as const,
    left: CAL.marginX,
    top: CAL.header.monthY,
    width: NAME_W,
    color: COLOR.accent,
    fontSize: TYPE.month.size,
    lineHeight: `${TYPE.month.lineHeight}px`,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  if (draft !== null) {
    return (
      <TextField
        value={draft}
        placeholder={name}
        onChange={setDraft}
        onEnter={commit}
        onEscape={() => setDraft(null)}
        onBlur={commit}
        style={textStyle}
      />
    );
  }

  return (
    <div {...gesture} style={textStyle}>
      {name}
    </div>
  );
}
