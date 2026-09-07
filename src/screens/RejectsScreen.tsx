// RejectsScreen.tsx — the reject pile. The newest reject heroes in from
// wherever it was tapped (the deck's edge or the icon bar) to REJECTS.hero;
// once it lands, it fades into the grid that rises beneath: three columns
// grouped by stack day, a caption per day, a taped print per reject. Tap a
// print to rescue it; "shred n" at the bottom feeds the pile to the shredder.

import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { CHROME, FRAME, LAYER, MOTION, PRINT, REJECTS } from '../tokens';
import { formatDay } from '../domain/time';
import { layoutRejects } from '../domain/rejects';
import { Overlay } from '../motion/Overlay';
import { Hero } from '../motion/Hero';
import { spring } from '../motion/springs';
import { Caption } from '../components/Caption';
import { Print } from '../components/Print';
import { TextButton } from '../components/TextButton';
import { actions, selectRejectGroups, selectRejects, useStore } from '../store/store';
import { RejectCell } from './rejects/RejectCell';
import { rejectsGrid } from './rejects/gridScroll';

export function RejectsScreen() {
  const rejects = useStore(selectRejects);
  const groups = useStore(selectRejectGroups);
  const origin = useStore((s) => s.heroOrigin);
  const layout = useMemo(() => layoutRejects(groups), [groups]);

  // The print that flies in is whichever was newest when the screen opened.
  const [heroPhoto] = useState(() => rejects[0] ?? null);
  const [landed, setLanded] = useState(heroPhoto === null || origin === null);
  const count = rejects.length;

  return (
    <Overlay
      layer={LAYER.rejects}
      onTapEmpty={actions.goBack}
      chrome={
        count > 0 ? (
          <TextButton
            label={`shred ${count}`}
            tone="accent"
            onTap={actions.openShredder}
            style={{ position: 'absolute', left: 0, width: FRAME.w, top: REJECTS.button.y - 22, justifyContent: 'center' }}
          />
        ) : null
      }
    >
      {heroPhoto && origin && (
        <Hero from={origin} to={REJECTS.hero} layer={LAYER.rejects} onEntered={() => setLanded(true)}>
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: landed ? 0 : 1, transition: spring(MOTION.modeSwap) }}
            exit={{ opacity: 1, transition: { duration: 0 } }}
          >
            <Print photo={heroPhoto} w={REJECTS.hero.w} h={REJECTS.hero.h} border={PRINT.border.reject} size={512} tape />
          </motion.div>
        </Hero>
      )}
      <motion.div
        className="scroller"
        onScroll={(e) => {
          rejectsGrid.scrollTop = e.currentTarget.scrollTop;
        }}
        style={{ position: 'absolute', left: 0, top: REJECTS.gridY, width: FRAME.w, height: REJECTS.scrollerH }}
        initial={{ opacity: 0, y: CHROME.rise }}
        animate={landed ? { opacity: 1, y: 0 } : { opacity: 0, y: CHROME.rise }}
        transition={spring(MOTION.chrome)}
        exit={{ opacity: 0, transition: spring(MOTION.modeSwap) }}
      >
        <div style={{ position: 'relative', width: FRAME.w, height: layout.height }}>
          {layout.captions.map((c) => (
            <Caption key={c.day} style={{ position: 'absolute', left: REJECTS.marginX, top: c.y }}>
              {formatDay(c.day)}
            </Caption>
          ))}
          {groups.flatMap((g) => g.photos).map((photo) => {
            const cell = layout.cells.get(photo.id);
            return cell ? (
              <RejectCell key={photo.id} photo={photo} cell={cell} hidden={!landed && heroPhoto?.id === photo.id} />
            ) : null;
          })}
        </div>
      </motion.div>
      {count === 0 && (
        <Caption style={{ position: 'absolute', left: 0, top: REJECTS.emptyY, width: FRAME.w, textAlign: 'center' }}>
          nothing to shred
        </Caption>
      )}
    </Overlay>
  );
}
