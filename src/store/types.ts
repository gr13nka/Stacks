// types.ts — shape of everything the store holds. Catalog data (volumes,
// photos) is whatever the api streamed in; decisions, place names and
// settings survive a relaunch; the rest is navigation and in-flight state.

import type {
  DecisionMap,
  Environment,
  Photo,
  PlaceLabel,
  Settings,
  Source,
  TrashedFile,
  TrashReport,
  Volume,
} from '../api/types';
import type { RectRot } from '../tokens';

export type Screen = 'main' | 'deck' | 'rejects' | 'shredder' | 'settings';
export type Mode = 'calendar' | 'places';
export type ShredPhase = 'idle' | 'feeding' | 'trashing' | 'done' | 'failed';

export type State = {
  hydrated: boolean;
  environment: Environment | null;

  // navigation
  screen: Screen;
  /** The screen currently animating out (cleared by exitComplete). */
  exiting: Screen | null;
  /** Screens beneath the current one, bottom to top ('main' is implicit). */
  history: Screen[];
  mode: Mode;
  openStackId: string | null;
  /** Where the current hero flew in from, in frame coords. */
  heroOrigin: RectRot | null;

  // catalog
  volumes: Volume[];
  /** Every source scanned so far (volumes, default folders, user folders). */
  sources: Source[];
  photos: Photo[];
  scanning: boolean;

  // persisted
  decisions: DecisionMap;
  /** User-edited place names keyed by Place.id. */
  placeLabels: Record<string, string>;
  settings: Settings;

  /** Geocode results keyed by Place.id; null = nothing within 100 km; absent = not looked up yet. */
  placeNames: Record<string, PlaceLabel | null>;

  shred: { phase: ShredPhase; report: TrashReport | null };
  /** The last successful shred, kept so undo can restore it and rescan its volumes. */
  lastShred: { items: TrashedFile[]; volumeIds: string[] } | null;
  notice: string | null;
};

/** The slice of State that survives a reload. */
export type PersistedState = Pick<State, 'decisions' | 'placeLabels' | 'settings'>;

export const DEFAULT_SETTINGS: Settings = {
  gapHours: 3,
  removeRawWithJpg: true,
  folders: [],
  placeRadiusKm: 25,
};

export const GAP_HOURS = { min: 1, max: 12 } as const;
