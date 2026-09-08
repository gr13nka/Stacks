// ShredderScreen.tsx — the confirmation step for deleting. Rejects fly from
// the grid onto a pile; "shred n" feeds them one by one through the seam
// (each Feed owns its progress; the last one to finish calls shredFed, and
// only then does the store move files). Success shows the tally and a
// timed undo; failure springs the failed prints back onto the pile with
// the report's message. The store refuses goBack while feeding/trashing.

import { useEffect, useRef, useState } from 'react';
import { FRAME, LAYER, SHREDDER } from '../tokens';
import type { RectRot } from '../tokens';
import { cellPrintRect, layoutRejects } from '../domain/rejects';
import { feedStagger, isLocked, shredMessage } from '../domain/shred';
import { setScreenKeys } from '../lib/keys';
import { Overlay } from '../motion/Overlay';
import { Caption } from '../components/Caption';
import { TextButton } from '../components/TextButton';
import { actions, selectRejectGroups, selectRejects, useStore } from '../store/store';
import { Feed } from './shredder/Feed';
import type { FeedPhase } from './shredder/Feed';
import { Seam } from './shredder/Seam';
import { rejectsGrid } from './rejects/gridScroll';

const OFFSCREEN_MARGIN = 100;

export function ShredderScreen() {
  const rejects = useStore(selectRejects);
  const groups = useStore(selectRejectGroups);
  const volumes = useStore((s) => s.volumes);
  const shred = useStore((s) => s.shred);
  const lastShred = useStore((s) => s.lastShred);

  const [swallowed, setSwallowed] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const feedTotal = useRef(0);
  const doneCount = useRef(0);
  const [undoVisible, setUndoVisible] = useState(false);

  // Where each print takes off from: its reject-grid cell, for the ones on
  // screen (captured once, at mount, from the grid beneath this overlay).
  const [origins] = useState(() => {
    const layout = layoutRejects(groups);
    const map = new Map<string, RectRot>();
    for (const p of rejects) {
      if (map.size >= SHREDDER.maxFlights) break;
      const cell = layout.cells.get(p.id);
      if (!cell) continue;
      const rect = cellPrintRect(cell, rejectsGrid.scrollTop);
      if (rect.y + rect.h < -OFFSCREEN_MARGIN || rect.y > FRAME.h + OFFSCREEN_MARGIN) continue;
      map.set(p.id, rect);
    }
    return map;
  });

  const n = rejects.length;
  const phase = shred.phase;
  const locked = isLocked(rejects, volumes);
  const busy = phase === 'feeding' || phase === 'trashing';
  const feedPhase: FeedPhase = busy ? 'feeding' : phase === 'failed' ? 'returning' : 'seated';

  const start = () => {
    if (busy || locked || n === 0) return;
    feedTotal.current = n;
    doneCount.current = 0;
    setSwallowed(0);
    setStartAt(performance.now());
    actions.beginShred();
  };

  const onFeedDone = () => {
    doneCount.current += 1;
    if (doneCount.current >= feedTotal.current) void actions.shredFed();
  };

  // Enter and z do exactly what the two buttons do — including their guards,
  // which live in this screen's feed state, not in the store.
  useEffect(() => {
    setScreenKeys('shredder', {
      'shred:start': start,
      'undo:shred': () => {
        if (undoVisible && lastShred) void actions.undoShred();
      },
    });
    return () => setScreenKeys('shredder', null);
  });

  useEffect(() => {
    if (phase !== 'done') {
      setUndoVisible(false);
      return undefined;
    }
    setUndoVisible(true);
    const timer = setTimeout(() => setUndoVisible(false), SHREDDER.undoMs);
    return () => clearTimeout(timer);
  }, [phase]);

  const status = (() => {
    switch (phase) {
      case 'trashing':
        return 'moving to the trash…';
      case 'done':
        return `gone. ${shred.removed} print${shred.removed === 1 ? '' : 's'} in the trash`;
      case 'failed':
        return shred.report ? shredMessage(shred.report) : 'files could not be moved';
      case 'restored':
        return 'back in their stacks';
      default:
        return n === 0 ? 'nothing to shred' : null;
    }
  })();

  const stagger = feedStagger(feedTotal.current || n);
  const remaining = busy ? Math.max(0, feedTotal.current - swallowed) : null;

  return (
    <Overlay
      layer={LAYER.shredder}
      onTapEmpty={actions.goBack}
      hint={busy ? null : undefined}
      chrome={
        <>
          {status && (
            <Caption tone="ink" style={{ position: 'absolute', left: 0, top: SHREDDER.statusY, width: FRAME.w, textAlign: 'center' }}>
              {status}
            </Caption>
          )}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: SHREDDER.button.y - 22,
              width: FRAME.w,
              display: 'flex',
              justifyContent: 'center',
              gap: 32,
            }}
          >
            {!busy && n > 0 && (phase === 'idle' || phase === 'failed') && (
              <>
                {locked ? (
                  <TextButton label="card is locked" tone="muted" />
                ) : (
                  <TextButton label={`shred ${n}`} tone="accent" onTap={start} />
                )}
                <TextButton label="not yet" tone="muted" onTap={actions.goBack} />
              </>
            )}
            {phase === 'done' && undoVisible && lastShred && (
              <TextButton label="undo" tone="accent" onTap={() => void actions.undoShred()} />
            )}
          </div>
        </>
      }
    >
      {rejects.map((photo, i) => (
        <Feed
          key={photo.id}
          photo={photo}
          seat={n - 1 - i}
          order={i}
          startAt={startAt}
          stagger={stagger}
          phase={feedPhase}
          from={origins.get(photo.id) ?? null}
          drawn={i < swallowed + SHREDDER.pileVisible}
          onSwallow={() => setSwallowed((c) => c + 1)}
          onDone={onFeedDone}
        />
      ))}
      <Seam jolts={swallowed} remaining={remaining} />
    </Overlay>
  );
}
