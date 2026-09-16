// App.tsx — the phone frame and the screen stack. The main screen (calendar
// or places, cross-faded by mode) is always mounted as the desk; deck,
// rejects, shredder, settings and the location picker are AnimatePresence
// overlays keyed by screen, each doing its own hero FLIP. The icon bar
// floats above them all.

import { AnimatePresence, motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { BACK, CHROME, DESKTOP, FRAME, LAYER, MOTION } from './tokens';
import { setFrameElement } from './lib/frame';
import { spring } from './motion/springs';
import { actions, useStore } from './store/store';
import type { Screen } from './store/types';
import { IconBar } from './components/IconBar';
import { Caption } from './components/Caption';
import { CalendarScreen } from './screens/CalendarScreen';
import { PlacesScreen } from './screens/PlacesScreen';
import { DeckScreen } from './screens/DeckScreen';
import { RejectsScreen } from './screens/RejectsScreen';
import { ShredderScreen } from './screens/ShredderScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LocateScreen } from './screens/LocateScreen';

/** The selected mobile or desktop frame always fits the window on both axes. */
function useFrameScale(): number {
  const fit = () => Math.min(window.innerWidth / FRAME.w, window.innerHeight / FRAME.h);
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

/** A list screen's cross-fade: the entering list rises 16px while both fade. */
function ModeLayer({ children }: { children: ReactNode }) {
  return (
    <motion.div
      style={{ position: 'absolute', inset: 0, zIndex: LAYER.main }}
      initial={{ opacity: 0, y: CHROME.rise }}
      animate={{ opacity: 1, y: 0, transition: { opacity: spring(MOTION.modeSwap), y: spring(MOTION.chrome) } }}
      exit={{ opacity: 0, transition: spring(MOTION.modeSwap) }}
    >
      {children}
    </motion.div>
  );
}

export function App() {
  const scale = useFrameScale();
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const screen = useStore((s) => s.screen);
  const history = useStore((s) => s.history);
  const mode = useStore((s) => s.mode);
  const notice = useStore((s) => s.notice);

  // A screen stays mounted while it is current or beneath another overlay.
  const mounted = (name: Screen) => screen === name || history.includes(name);

  useEffect(() => {
    setFrameElement(phoneRef.current);
    return () => setFrameElement(null);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        ref={phoneRef}
        className="phone"
        style={{
          // WKWebView can rasterize a transformed layer before scaling it,
          // which makes the desktop UI soft at fractional/fullscreen sizes.
          // CSS zoom participates in layout and paints at the final scale.
          ...(DESKTOP ? { zoom: scale } : { transform: `scale(${scale})` }),
          '--frame-width': `${FRAME.w}px`,
          '--frame-height': `${FRAME.h}px`,
        } as CSSProperties & {
          '--frame-width': string;
          '--frame-height': string;
          zoom?: number;
        }}
      >
        <div className="grain" />
        <AnimatePresence initial={false}>
          {mode === 'calendar' ? (
            <ModeLayer key="calendar">
              <CalendarScreen />
            </ModeLayer>
          ) : (
            <ModeLayer key="places">
              <PlacesScreen />
            </ModeLayer>
          )}
        </AnimatePresence>
        {notice && screen === 'main' && (
          <Caption
            style={{ position: 'absolute', left: 0, top: BACK.hintY, width: FRAME.w, textAlign: 'center', zIndex: LAYER.main + 1 }}
          >
            {notice}
          </Caption>
        )}
        <AnimatePresence onExitComplete={actions.exitComplete}>
          {mounted('deck') && <DeckScreen key="deck" />}
          {mounted('rejects') && <RejectsScreen key="rejects" />}
          {mounted('shredder') && <ShredderScreen key="shredder" />}
          {mounted('settings') && <SettingsScreen key="settings" />}
          {mounted('locate') && <LocateScreen key="locate" />}
        </AnimatePresence>
        <IconBar />
      </div>
    </div>
  );
}
