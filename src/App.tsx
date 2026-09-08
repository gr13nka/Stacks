// App.tsx — the desk, the phone frame on it, and the screen stack. The window
// is any shape the user drags it to; the frame scales to fit and lies centred
// on the desk, which carries its own grain and drags the window. The main
// screen (calendar or places, cross-faded by mode) is always mounted; deck,
// rejects, shredder and settings are AnimatePresence overlays keyed by
// screen, each doing its own hero FLIP. The icon bar floats above them all.

import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { BACK, CHROME, DESK, FRAME, LAYER, MOTION } from './tokens';
import { setFrameElement } from './lib/frame';
import { useKeyboard } from './lib/keys';
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

/** The largest scale at which the whole frame fits the window with a margin of
 *  desk showing on every side. Tauri opens the window at exactly 1×; dragging
 *  it larger grows the frame, smaller shrinks it. */
function useFrameScale(): number {
  const fit = () =>
    Math.max(
      0.2,
      Math.min(
        (window.innerWidth - 2 * DESK.margin) / FRAME.w,
        (window.innerHeight - 2 * DESK.margin) / FRAME.h,
      ),
    );
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
  useKeyboard();
  const scale = useFrameScale();
  const deskRef = useRef<HTMLDivElement | null>(null);
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

  // WKWebView does not give the document focus on its own, so the arrow keys
  // would be dead until the first click. The desk holds focus for the app.
  useEffect(() => {
    deskRef.current?.focus();
  }, []);

  return (
    <div
      ref={deskRef}
      className="desk"
      tabIndex={-1}
      data-tauri-drag-region
      // Capture: elements built on usePointerGesture stop pointerdown bubbling.
      onPointerDownCapture={() => deskRef.current?.focus()}
      onContextMenu={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      <div className="grain" />
      <div ref={phoneRef} className="phone" style={{ transform: `scale(${scale})` }}>
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
        </AnimatePresence>
        <IconBar />
      </div>
    </div>
  );
}
