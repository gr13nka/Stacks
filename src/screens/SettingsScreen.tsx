// SettingsScreen.tsx — Phase 1 placeholder: the overlay and its back gesture
// are final; Phase 2 adds the rows (gap, raw, sources, about).

import { LAYER, SETTINGS } from '../tokens';
import { Overlay } from '../motion/Overlay';
import { Caption } from '../components/Caption';
import { actions } from '../store/store';

export function SettingsScreen() {
  return (
    <Overlay
      layer={LAYER.settings}
      onTapEmpty={actions.goBack}
      chrome={<Caption style={{ position: 'absolute', left: SETTINGS.labelX, top: SETTINGS.rowY0 - 24 }}>settings</Caption>}
    />
  );
}
