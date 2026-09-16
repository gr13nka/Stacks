// LocateScreen.tsx — where was this stack shot? Opened by a long press on a
// stack print. The field searches the offline city table, ranked near the
// stack's own GPS or that of the stack closest to it in time; the user's GPS
// places come first, filtered by the same text. Picking a row goes back at
// once and leaves the store to write the point into the stack's JPEGs
// (camera GPS is kept), reporting progress and the outcome as a notice.

import { useEffect, useMemo, useState } from 'react';
import type { City } from '../api/types';
import type { LatLon } from '../domain/places';
import { formatDay } from '../domain/time';
import { COLOR, FRAME, LAYER, LOCATE, TYPE } from '../tokens';
import { Overlay } from '../motion/Overlay';
import { Caption } from '../components/Caption';
import { Section, TwoLineRow } from '../components/Rows';
import { TextField } from '../components/TextField';
import { actions, placeName, selectPhotosById, selectPlaces, selectStackById, useStore } from '../store/store';

type Choice = { key: string; title: string; caption: string; point: LatLon };

/** Case- and accent-insensitive form for matching place names as typed. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function LocateScreen() {
  const stackId = useStore((s) => s.locateStackId);
  const stack = useStore((s) => selectStackById(s, s.locateStackId));
  const byId = useStore(selectPhotosById);
  const places = useStore(selectPlaces);
  const labels = useStore((s) => s.placeLabels);
  const names = useStore((s) => s.placeNames);
  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<City[] | null>([]); // null while a search is pending

  const typed = query.trim();
  useEffect(() => {
    if (!typed || !stackId) {
      setCities([]);
      return;
    }
    setCities(null);
    let live = true;
    const timer = setTimeout(() => {
      actions.searchCities(stackId, typed).then(
        (result) => live && setCities(result),
        () => live && setCities([]),
      );
    }, LOCATE.debounceMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [typed, stackId]);

  const yours = useMemo<Choice[]>(() => {
    const q = fold(typed);
    return places.flatMap((p) => {
      if (!p.centroid) return [];
      const title = placeName(p, labels, names);
      if (q && !fold(title).includes(q)) return [];
      return [{ key: p.id, title, caption: plural(p.stackIds.length, 'stack'), point: p.centroid }];
    });
  }, [places, labels, names, typed]);

  const found: Choice[] = (cities ?? []).map((c, i) => ({
    key: `${i}:${c.lat},${c.lon}`,
    title: c.name,
    caption: `${c.admin1} · ${c.country}`,
    point: { lat: c.lat, lon: c.lon },
  }));

  const pick = (point: LatLon) => {
    if (!stackId) return;
    void actions.locateStack(stackId, point);
    actions.goBack();
  };
  const first = yours[0] ?? found[0];

  const total = stack?.photoIds.length ?? 0;
  const bare = stack ? stack.photoIds.filter((id) => !byId.get(id)?.gps).length : 0;

  return (
    <Overlay layer={LAYER.locate} onTapEmpty={actions.goBack}>
      <div
        style={{
          position: 'absolute',
          left: LOCATE.x,
          top: LOCATE.titleY,
          width: LOCATE.w,
          color: COLOR.accent,
          fontSize: TYPE.month.size,
          lineHeight: `${TYPE.month.lineHeight}px`,
        }}
      >
        where was this?
      </div>
      {stack && (
        <Caption style={{ position: 'absolute', left: LOCATE.x, top: LOCATE.captionY, width: LOCATE.w, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {formatDay(stack.day)} · {bare} of {total} without gps
        </Caption>
      )}
      <TextField
        value={query}
        placeholder="search a city"
        onChange={setQuery}
        onEnter={() => first && pick(first.point)}
        onEscape={actions.goBack}
        style={{
          position: 'absolute',
          left: LOCATE.x,
          top: LOCATE.field.y,
          width: LOCATE.w,
          height: LOCATE.field.h,
          color: COLOR.ink,
          fontSize: TYPE.label.size,
          lineHeight: `${TYPE.label.lineHeight}px`,
          borderBottom: `1px solid ${COLOR.muted}`,
        }}
      />
      <div
        className="scroller"
        style={{ position: 'absolute', left: 0, top: LOCATE.scroller.y, width: FRAME.w, height: LOCATE.scroller.h }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: `0 ${FRAME.w - LOCATE.x - LOCATE.w}px 40px ${LOCATE.x}px`,
          }}
        >
          {yours.length > 0 && <Section>your places</Section>}
          {yours.map((c) => (
            <TwoLineRow key={c.key} title={c.title} caption={c.caption} onTap={() => pick(c.point)} />
          ))}
          {typed && <Section>cities</Section>}
          {typed && cities === null && <Caption>looking…</Caption>}
          {typed && cities?.length === 0 && <Caption>no match</Caption>}
          {found.map((c) => (
            <TwoLineRow key={c.key} title={c.title} caption={c.caption} onTap={() => pick(c.point)} />
          ))}
        </div>
      </div>
    </Overlay>
  );
}
