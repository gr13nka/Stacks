// PlaceName.tsx — a place's name in the block header: the user's label,
// else the offline geocode, else a placeholder. Tap to edit in place; the
// input is the one element in the app that keeps its case.

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CAL, COLOR, FRAME, TYPE } from '../../tokens';
import type { Place } from '../../api/types';
import { usePointerGesture } from '../../lib/gesture';
import { actions, selectPlaceName, useStore } from '../../store/store';

const NAME_W = Math.min(440, FRAME.w - 2 * CAL.marginX - 110); // leaves room for the "n stacks" caption

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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setDraft(null);
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
      <input
        autoFocus
        value={draft}
        placeholder={name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ ...textStyle, textTransform: 'none', userSelect: 'text', WebkitUserSelect: 'text' }}
      />
    );
  }

  return (
    <div {...gesture} style={textStyle}>
      {name}
    </div>
  );
}
