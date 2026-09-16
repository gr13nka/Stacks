// store.ts — a plain external store (no state library). Screens read it
// through useStore(selector) and write it only through `actions`; getState/
// setState/subscribe exist so useStore can be built on useSyncExternalStore
// and so hydrate() can seed state before React ever renders.
//
// Everything derived from the catalog (stacks, months, places, per-stack
// progress) is computed by the pure domain modules through memoised
// selectors, so selectors return the same reference until their inputs
// change — the contract useSyncExternalStore needs.

import { useSyncExternalStore } from 'react';
import { api } from '../api/api';
import type {
  City,
  DecisionMap,
  Decision,
  FileFailure,
  Photo,
  Place,
  PlaceLabel,
  RetagReport,
  ScanEvent,
  Settings,
  Source,
  Stack,
  TrashReport,
  Volume,
} from '../api/types';
import { STORAGE_KEY } from '../tokens';
import type { RectRot } from '../tokens';
import { preloadImage } from '../lib/image';
import { monthsOf } from '../domain/calendar';
import { deckQueue, stackState } from '../domain/deck';
import type { PhotoIndex, StackState } from '../domain/deck';
import { SOMEWHERE_ID, clusterPlaces, nearestFix } from '../domain/places';
import type { LatLon } from '../domain/places';
import { groupRejectsByDay } from '../domain/rejects';
import type { RejectGroup } from '../domain/rejects';
import { buildStacks } from '../domain/stacks';
import { DEFAULT_SETTINGS, GAP_HOURS } from './types';
import type { Mode, PersistedState, Screen, State } from './types';

const PERSIST_DEBOUNCE_MS = 150;
const PREFETCH_AHEAD = 6;
/** How long a flashed notice stays up. */
const NOTICE_MS = 4000;
/** Photos per locate_photos call: a JPEG on a card can take ~1 s to rewrite, so progress is reported per chunk. */
const LOCATE_CHUNK = 10;

function initialState(): State {
  return {
    hydrated: false,
    environment: null,
    screen: 'main',
    exiting: null,
    history: [],
    mode: 'calendar',
    openStackId: null,
    heroOrigin: null,
    locateStackId: null,
    volumes: [],
    sources: [],
    photos: [],
    scanning: false,
    pendingTurns: {},
    decisions: {},
    placeLabels: {},
    settings: { ...DEFAULT_SETTINGS },
    placeNames: {},
    shred: { phase: 'idle', report: null, removed: 0 },
    lastShred: null,
    notice: null,
  };
}

let state: State = initialState();
const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  schedulePersist();
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

// ---- persistence ----------------------------------------------------------

let persistTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePersist(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    const persisted: PersistedState = {
      decisions: state.decisions,
      placeLabels: state.placeLabels,
      settings: state.settings,
    };
    void api.storage.set(STORAGE_KEY, JSON.stringify(persisted));
  }, PERSIST_DEBOUNCE_MS);
}

function normaliseSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const gap = typeof s.gapHours === 'number' ? s.gapHours : DEFAULT_SETTINGS.gapHours;
  return {
    gapHours: Math.min(GAP_HOURS.max, Math.max(GAP_HOURS.min, Math.round(gap))),
    removeRawWithJpg: typeof s.removeRawWithJpg === 'boolean' ? s.removeRawWithJpg : DEFAULT_SETTINGS.removeRawWithJpg,
    folders: Array.isArray(s.folders) ? s.folders.filter((f): f is string => typeof f === 'string') : [],
    placeRadiusKm: typeof s.placeRadiusKm === 'number' ? s.placeRadiusKm : DEFAULT_SETTINGS.placeRadiusKm,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Load the persisted slice before first render. Always resolves. */
export async function hydrate(): Promise<void> {
  try {
    const raw = await api.storage.get(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      state = {
        ...state,
        decisions: isRecord(parsed.decisions) ? (parsed.decisions as DecisionMap) : {},
        placeLabels: isRecord(parsed.placeLabels) ? (parsed.placeLabels as Record<string, string>) : {},
        settings: normaliseSettings(parsed.settings),
      };
    }
  } catch {
    // corrupt or unavailable storage — fall back to the default empty state
  }
  state = { ...state, hydrated: true };
  listeners.forEach((listener) => listener());
}

// ---- memoised selectors -----------------------------------------------------

/** Last-call memo keyed on argument identity: the selector contract for useSyncExternalStore. */
export function memo1<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A) => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => Object.is(a, args[i]))) {
      return lastResult;
    }
    lastArgs = args;
    lastResult = fn(...args);
    return lastResult;
  };
}

const EMPTY_PHOTOS: Photo[] = [];

const photosById = memo1((photos: Photo[]): PhotoIndex => new Map(photos.map((p) => [p.id, p])));
const stacksOf = memo1((photos: Photo[], gapHours: number) => buildStacks(photos, gapHours));
const stacksById = memo1((stacks: Stack[]) => new Map(stacks.map((s) => [s.id, s])));
const monthsOfStacks = memo1(monthsOf);
const placesOf = memo1((photos: Photo[], stacks: Stack[], radiusKm: number) => clusterPlaces(photos, stacks, radiusKm));
const placesWithLabels = memo1((places: Place[], names: Record<string, PlaceLabel | null>) =>
  places.map((p) => ({ ...p, label: names[p.id] ?? null })),
);
const stackStatesOf = memo1((stacks: Stack[], byId: PhotoIndex, decisions: DecisionMap) => {
  const out = new Map<string, StackState>();
  for (const stack of stacks) out.set(stack.id, stackState(stack, byId, decisions));
  return out as ReadonlyMap<string, StackState>;
});
const rejectsOf = memo1((photos: Photo[], decisions: DecisionMap) =>
  photos
    .filter((p) => decisions[p.path]?.d === 'remove')
    .sort((a, b) => (decisions[b.path]?.at ?? 0) - (decisions[a.path]?.at ?? 0)),
);
const queueOf = memo1((stack: Stack | undefined, byId: PhotoIndex, decisions: DecisionMap) =>
  stack ? deckQueue(stack, byId, decisions) : EMPTY_PHOTOS,
);
const rejectGroupsOf = memo1((rejects: Photo[], stacks: Stack[]) => groupRejectsByDay(rejects, stacks));

export const selectPhotosById = (s: State): PhotoIndex => photosById(s.photos);
export const selectStacks = (s: State): Stack[] => stacksOf(s.photos, s.settings.gapHours);
export const selectStacksById = (s: State): ReadonlyMap<string, Stack> => stacksById(selectStacks(s));
export const selectStackById = (s: State, id: string | null): Stack | undefined =>
  id === null ? undefined : selectStacksById(s).get(id);
export const selectMonths = (s: State) => monthsOfStacks(selectStacks(s));
/** Places with `label` filled from the geocode cache (user names live in placeLabels). */
export const selectPlaces = (s: State): Place[] =>
  placesWithLabels(placesOf(s.photos, selectStacks(s), s.settings.placeRadiusKm), s.placeNames);
export const selectStackStates = (s: State) => stackStatesOf(selectStacks(s), selectPhotosById(s), s.decisions);
export const selectStackState = (s: State, id: string): StackState | undefined => selectStackStates(s).get(id);
export const selectStackStatus = (s: State, id: string) => selectStackState(s, id)?.status ?? 'untouched';
export const selectStackProgress = (s: State, id: string): number => {
  const st = selectStackState(s, id);
  return st && st.total > 0 ? st.decided / st.total : 0;
};
/** Rejected photos, most recently rejected first. */
export const selectRejects = (s: State): Photo[] => rejectsOf(s.photos, s.decisions);
export const selectRejectCount = (s: State): number => selectRejects(s).length;
/** Rejects grouped by stack day, newest day first (the reject pile's grid order). */
export const selectRejectGroups = (s: State): RejectGroup[] => rejectGroupsOf(selectRejects(s), selectStacks(s));
export const selectDeckQueue = (s: State, stackId: string | null): Photo[] =>
  queueOf(selectStackById(s, stackId), selectPhotosById(s), s.decisions);

/** The display name of a place: the user's label, else the geocode, else a placeholder. */
export function placeName(place: Place, labels: State['placeLabels'], names: State['placeNames']): string {
  const custom = labels[place.id];
  if (custom) return custom;
  if (place.id === SOMEWHERE_ID) return 'somewhere';
  const label = names[place.id];
  if (label === undefined) return 'looking up…';
  return label?.name ?? 'unknown place';
}

export const selectPlaceName = (s: State, place: Place): string => placeName(place, s.placeLabels, s.placeNames);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The newest month's header caption: what is left to do. */
export function selectCaption(s: State): string {
  if (s.scanning) return 'looking through the card…';
  const states = selectStackStates(s);
  if (states.size === 0) return 'nothing here yet';
  let undone = 0;
  let touched = 0;
  for (const st of states.values()) {
    if (st.status !== 'done') undone += 1;
    if (st.status !== 'untouched') touched += 1;
  }
  if (undone === 0) return 'done for today :)';
  if (touched === 0) return `${plural(undone, 'stack')} to sort`;
  return `${undone} left today`;
}

// ---- catalog plumbing --------------------------------------------------------

function volumeSource(v: Volume): Source {
  return { volumeId: v.id, root: v.path, kind: v.kind };
}

function folderSource(path: string): Source {
  return { volumeId: `folder:${path}`, root: path, kind: 'folder' };
}

function mergePhotos(existing: Photo[], incoming: Photo[]): Photo[] {
  if (incoming.length === 0) return existing;
  const known = new Set(existing.map((p) => p.id));
  const fresh = incoming.filter((p) => !known.has(p.id));
  return fresh.length === 0 ? existing : existing.concat(fresh);
}

/**
 * Streams `sources` through the api into state. With `replace`, a volume's
 * photos are buffered and swapped in at its sourceDone so the calendar never
 * flashes empty while a known volume is rescanned.
 */
async function scan(sources: Source[], replace = false): Promise<void> {
  if (sources.length === 0) return;
  setState((s) => ({ scanning: true, sources: mergeSources(s.sources, sources) }));
  const buffers = new Map<string, Photo[]>();
  const onEvent = (e: ScanEvent) => {
    if (e.type === 'batch') {
      if (replace) {
        const buf = buffers.get(e.volumeId) ?? [];
        buf.push(...e.photos);
        buffers.set(e.volumeId, buf);
      } else {
        actions.appendPhotos(e.photos);
      }
    } else if (replace) {
      actions.replaceVolumePhotos(e.volumeId, buffers.get(e.volumeId) ?? []);
      buffers.delete(e.volumeId);
    }
  };
  try {
    await api.scanCatalog(sources, onEvent);
  } catch (err) {
    actions.setNotice(`scan failed: ${String(err)}`);
  } finally {
    setState({ scanning: false });
  }
  await labelNewPlaces();
}

function mergeSources(existing: Source[], incoming: Source[]): Source[] {
  const known = new Set(existing.map((s) => s.volumeId));
  return existing.concat(incoming.filter((s) => !known.has(s.volumeId)));
}

/** Geocodes the centroid of every GPS place not yet in placeNames. */
async function labelNewPlaces(): Promise<void> {
  const pending = selectPlaces(state).filter((p) => p.centroid && state.placeNames[p.id] === undefined);
  if (pending.length === 0) return;
  try {
    const labels = await api.labelPlaces(pending.map((p) => [p.centroid!.lat, p.centroid!.lon]));
    setState((s) => {
      const placeNames = { ...s.placeNames };
      pending.forEach((p, i) => {
        placeNames[p.id] = labels[i] ?? null;
      });
      return { placeNames };
    });
  } catch {
    // offline labels are a nicety; the place keeps its placeholder name
  }
}

/** Swaps in photos the api re-read after writing their files, keeping catalog order. */
function replacePhotos(photos: Photo[], updated: Photo[]): Photo[] {
  if (updated.length === 0) return photos;
  const byId = new Map(updated.map((p) => [p.id, p]));
  return photos.map((p) => byId.get(p.id) ?? p);
}

/** Subtracts `n` settled turns, dropping the entry at zero. */
function settleTurns(pending: Record<string, number>, id: string, n: number): Record<string, number> {
  const next = { ...pending };
  const left = (next[id] ?? 0) - n;
  if (left > 0) next[id] = left;
  else delete next[id];
  return next;
}

function turnFailureText(f: FileFailure | undefined): string {
  switch (f?.reason) {
    case 'unsupported':
      return 'only jpegs can be turned';
    case 'read-only':
      return 'read-only — left as it is';
    case 'missing':
      return 'the file is gone';
    default:
      return f?.message ? `could not turn it: ${f.message}` : 'could not turn it';
  }
}

function locateSummary(r: RetagReport): string {
  const count = (reason: FileFailure['reason']) => r.failed.filter((f) => f.reason === reason).length;
  const parts = [
    r.updated.length > 0 ? `placed ${r.updated.length}` : '',
    r.kept.length > 0 ? `${r.kept.length} kept their own gps` : '',
    count('unsupported') > 0 ? `${count('unsupported')} not jpeg` : '',
    count('read-only') > 0 ? `${count('read-only')} read-only` : '',
    count('missing') + count('other') > 0 ? `${count('missing') + count('other')} failed` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'nothing to place';
}

/** Photos with a rotation write in flight; taps that land meanwhile ride along in the next write. */
const turning = new Set<string>();

/**
 * Writes a photo's pending turns into its file, one write at a time, until
 * none are left. Each landed write swaps the re-read photo in and settles
 * its turns in the same setState, after its new thumb is decoded, so the
 * card's layout, image and residual turn change in one frame.
 */
async function flushTurns(id: string): Promise<void> {
  if (turning.has(id)) return;
  turning.add(id);
  try {
    for (let n = state.pendingTurns[id] ?? 0; n > 0; n = state.pendingTurns[id] ?? 0) {
      let landed: Photo | null = null;
      if (n % 4 !== 0) {
        let report: RetagReport;
        try {
          report = await api.rotatePhoto(id, n % 4);
        } catch (err) {
          report = { updated: [], kept: [], failed: [{ id, path: '', reason: 'other', message: String(err) }] };
        }
        landed = report.updated[0] ?? null;
        if (!landed) {
          setState((s) => ({ pendingTurns: settleTurns(s.pendingTurns, id, Infinity) }));
          actions.flash(turnFailureText(report.failed[0]));
          return;
        }
        await preloadImage(api.thumbUrl(landed, 1600));
      }
      const photo = landed;
      setState((s) => ({
        photos: photo ? replacePhotos(s.photos, [photo]) : s.photos,
        pendingTurns: settleTurns(s.pendingTurns, id, n),
      }));
    }
  } finally {
    turning.delete(id);
  }
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Warms the 1600 thumbs of queue[from .. PREFETCH_AHEAD): the whole window on open, the newcomer after a decision. */
function prefetchQueue(stackId: string, from = 0): void {
  const ids = selectDeckQueue(state, stackId)
    .slice(from, PREFETCH_AHEAD)
    .map((p) => p.id);
  if (ids.length > 0) void api.prefetchThumbs(ids, 1600).catch(() => {});
}

// ---- navigation helpers --------------------------------------------------------

function isMounted(s: State, screen: Screen): boolean {
  return s.screen === screen || s.history.includes(screen);
}

function pushHistory(s: State): Screen[] {
  return s.screen === 'main' ? [] : [...s.history, s.screen];
}

function goBack(): void {
  const s = state;
  if (s.screen === 'main') return;
  if (s.shred.phase === 'feeding' || s.shred.phase === 'trashing') return; // the shredder cannot be interrupted
  const previous = s.history[s.history.length - 1] ?? 'main';
  setState({
    screen: previous,
    exiting: s.screen,
    history: s.history.slice(0, -1),
    shred: s.screen === 'shredder' ? { phase: 'idle', report: null, removed: 0 } : s.shred,
  });
}

// ---- actions ----------------------------------------------------------------

export const actions = {
  /** Environment → volumes + default sources → streamed scan → mount watcher → place labels. */
  async boot(): Promise<void> {
    try {
      const environment = await api.environment();
      setState({ environment });
    } catch (err) {
      actions.setNotice(`environment: ${String(err)}`);
    }

    let volumes: Volume[] = [];
    let defaults: Source[] = [];
    try {
      [volumes, defaults] = await Promise.all([api.listVolumes(), api.defaultSources()]);
    } catch (err) {
      actions.setNotice(`volumes: ${String(err)}`);
    }
    actions.setVolumes(volumes);

    const sources = [...volumes.map(volumeSource), ...defaults, ...state.settings.folders.map(folderSource)];
    await scan(sources);

    api.onVolumesChanged((next) => {
      const prev = state.volumes;
      const prevIds = new Set(prev.map((v) => v.id));
      const nextIds = new Set(next.map((v) => v.id));
      actions.setVolumes(next);
      for (const v of prev) if (!nextIds.has(v.id)) actions.removeVolumePhotos(v.id);
      const added = next.filter((v) => !prevIds.has(v.id));
      if (added.length > 0) void scan(added.map(volumeSource), true);
    });
  },

  setMode(mode: Mode): void {
    setState({ mode });
  },

  /** Switch list mode and close whatever overlay is open. */
  showMain(mode: Mode): void {
    setState((s) =>
      s.screen === 'main' ? { mode } : { mode, screen: 'main', exiting: s.screen, history: [] },
    );
  },

  openStack(stackId: string, origin: RectRot): void {
    setState({ screen: 'deck', openStackId: stackId, heroOrigin: origin, history: [] });
    prefetchQueue(stackId);
  },

  decide(photoId: string, d: Decision): void {
    const photo = selectPhotosById(state).get(photoId);
    if (!photo) return;
    setState((s) => ({ decisions: { ...s.decisions, [photo.path]: { d, at: Date.now() } } }));
    if (state.openStackId) prefetchQueue(state.openStackId, PREFETCH_AHEAD - 1);
  },

  /** One tap on a card: a clockwise quarter turn, shown at once and written into the JPEG behind it. */
  rotate(photoId: string): void {
    setState((s) => ({ pendingTurns: { ...s.pendingTurns, [photoId]: (s.pendingTurns[photoId] ?? 0) + 1 } }));
    void flushTurns(photoId);
  },

  undecide(photoId: string): void {
    const photo = selectPhotosById(state).get(photoId);
    if (!photo || state.decisions[photo.path] === undefined) return;
    setState((s) => {
      const decisions = { ...s.decisions };
      delete decisions[photo.path];
      return { decisions };
    });
  },

  openRejects(origin: RectRot): void {
    setState((s) => ({ screen: 'rejects', heroOrigin: origin, history: pushHistory(s) }));
  },

  openShredder(): void {
    setState((s) => ({ screen: 'shredder', history: pushHistory(s), shred: { phase: 'idle', report: null, removed: 0 } }));
  },

  openSettings(): void {
    setState((s) => ({ screen: 'settings', history: pushHistory(s) }));
  },

  /** Long-press on a stack: the location picker for it. */
  openLocate(stackId: string): void {
    setState((s) => ({ screen: 'locate', locateStackId: stackId, history: pushHistory(s) }));
  },

  /** Cities matching `query`, ranked near where the stack (or the one closest to it in time) was shot. */
  searchCities(stackId: string, query: string): Promise<City[]> {
    const stack = selectStackById(state, stackId);
    const near = stack ? nearestFix(stack, selectStacks(state), selectPhotosById(state)) : null;
    return api.searchCities(query, near);
  },

  /**
   * Writes `point` into the stack's photos in chunks, merging each chunk's
   * re-read photos so the stack joins its new place as soon as one lands.
   * Camera GPS is kept (the api decides); the summary says what happened.
   */
  async locateStack(stackId: string, point: LatLon): Promise<void> {
    const stack = selectStackById(state, stackId);
    if (!stack) return;
    const ids = stack.photoIds;
    const total: RetagReport = { updated: [], kept: [], failed: [] };
    for (let i = 0; i < ids.length; i += LOCATE_CHUNK) {
      if (ids.length > LOCATE_CHUNK) actions.setNotice(`placing ${Math.min(i + LOCATE_CHUNK, ids.length)} of ${ids.length}…`);
      let chunk: RetagReport;
      try {
        chunk = await api.locatePhotos(ids.slice(i, i + LOCATE_CHUNK), point.lat, point.lon);
      } catch (err) {
        total.failed.push({ id: '', path: '', reason: 'other', message: String(err) });
        break;
      }
      total.updated.push(...chunk.updated);
      total.kept.push(...chunk.kept);
      total.failed.push(...chunk.failed);
      if (chunk.updated.length > 0) setState((s) => ({ photos: replacePhotos(s.photos, chunk.updated) }));
    }
    actions.flash(locateSummary(total));
    await labelNewPlaces();
  },

  goBack,

  /** AnimatePresence finished the exit animation: release the exiting screen's hero. */
  exitComplete(): void {
    setState((s) => ({
      exiting: null,
      openStackId: isMounted(s, 'deck') ? s.openStackId : null,
    }));
  },

  setGapHours(gapHours: number): void {
    const clamped = Math.min(GAP_HOURS.max, Math.max(GAP_HOURS.min, Math.round(gapHours)));
    setState((s) => ({ settings: { ...s.settings, gapHours: clamped } }));
    void labelNewPlaces(); // regrouped stacks can form places with new centroids
  },

  setRemoveRawWithJpg(removeRawWithJpg: boolean): void {
    setState((s) => ({ settings: { ...s.settings, removeRawWithJpg } }));
  },

  async addFolder(path: string): Promise<void> {
    if (state.settings.folders.includes(path)) return;
    setState((s) => ({ settings: { ...s.settings, folders: [...s.settings.folders, path] } }));
    await scan([folderSource(path)]);
  },

  /** Asks the platform for a folder and adds it as a source (null = cancelled). */
  async pickAndAddFolder(): Promise<void> {
    let path: string | null = null;
    try {
      path = await api.pickFolder();
    } catch (err) {
      actions.setNotice(`could not open the folder picker: ${String(err)}`);
      return;
    }
    if (path) await actions.addFolder(path);
  },

  removeFolder(path: string): void {
    setState((s) => ({
      settings: { ...s.settings, folders: s.settings.folders.filter((f) => f !== path) },
      sources: s.sources.filter((src) => src.root !== path || src.kind !== 'folder'),
    }));
    actions.removeVolumePhotos(folderSource(path).volumeId);
  },

  /** Empty name clears the user's label, falling back to the geocode. */
  setPlaceLabel(placeId: string, name: string): void {
    setState((s) => {
      const placeLabels = { ...s.placeLabels };
      const trimmed = name.trim();
      if (trimmed) placeLabels[placeId] = trimmed;
      else delete placeLabels[placeId];
      return { placeLabels };
    });
  },

  beginShred(): void {
    setState({ shred: { phase: 'feeding', report: null, removed: 0 } });
  },

  /** The feed animation finished: only now do files move. */
  async shredFed(): Promise<void> {
    const rejects = selectRejects(state);
    if (rejects.length === 0) {
      setState({ shred: { phase: 'done', report: { trashed: [], failed: [] }, removed: 0 } });
      return;
    }
    setState({ shred: { phase: 'trashing', report: null, removed: 0 } });
    try {
      const report = await api.trashPhotos(
        rejects.map((p) => p.id),
        state.settings.removeRawWithJpg,
      );
      actions.finishShred(report);
    } catch (err) {
      setState({ shred: { phase: 'failed', report: { trashed: [], failed: [] }, removed: 0 } });
      actions.setNotice(`could not move files: ${String(err)}`);
    }
  },

  finishShred(report: TrashReport): void {
    const trashedIds = new Set(report.trashed.map((t) => t.id));
    const byId = selectPhotosById(state);
    const volumeIds = new Set<string>();
    const gonePaths = new Set<string>();
    for (const id of trashedIds) {
      const p = byId.get(id);
      if (!p) continue;
      volumeIds.add(p.volumeId);
      gonePaths.add(p.path);
    }
    setState((s) => {
      const decisions = { ...s.decisions };
      for (const path of gonePaths) delete decisions[path];
      return {
        photos: gonePaths.size === 0 ? s.photos : s.photos.filter((p) => !gonePaths.has(p.path)),
        decisions,
        shred: { phase: report.failed.length > 0 ? 'failed' : 'done', report, removed: gonePaths.size },
        lastShred: report.trashed.length > 0 ? { items: report.trashed, volumeIds: [...volumeIds] } : s.lastShred,
      };
    });
    void labelNewPlaces(); // a shrunken place has a new centroid, hence a new id
  },

  /** Brings the last shred back from the Trash and rescans its volumes. */
  async undoShred(): Promise<void> {
    const last = state.lastShred;
    if (!last) return;
    setState({ lastShred: null });
    try {
      const result = await api.restoreTrashed(last.items);
      if (result.failed.length > 0) actions.setNotice(`${plural(result.failed.length, 'file')} could not be restored`);
    } catch (err) {
      actions.setNotice(`restore failed: ${String(err)}`);
    }
    const sources = state.sources.filter((src) => last.volumeIds.includes(src.volumeId));
    await scan(sources, true);
    setState({ shred: { phase: 'restored', report: null, removed: 0 } });
  },

  setVolumes(volumes: Volume[]): void {
    setState({ volumes });
  },

  appendPhotos(photos: Photo[]): void {
    setState((s) => ({ photos: mergePhotos(s.photos, photos) }));
  },

  replaceVolumePhotos(volumeId: string, photos: Photo[]): void {
    setState((s) => ({ photos: s.photos.filter((p) => p.volumeId !== volumeId).concat(photos) }));
  },

  /** A volume went away: drop its photos; if the open stack was on it, leave the deck. */
  removeVolumePhotos(volumeId: string): void {
    const open = selectStackById(state, state.openStackId);
    setState((s) => ({ photos: s.photos.filter((p) => p.volumeId !== volumeId) }));
    if (open && open.volumeId === volumeId && isMounted(state, 'deck')) {
      setState((s) => ({ screen: 'main', exiting: s.screen, history: [] }));
      actions.setNotice('card ejected');
    }
  },

  setNotice(notice: string | null): void {
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    flashTimer = undefined;
    setState({ notice });
  },

  /** A notice that clears itself after NOTICE_MS unless another replaced it. */
  flash(notice: string): void {
    actions.setNotice(notice);
    flashTimer = setTimeout(() => {
      flashTimer = undefined;
      if (state.notice === notice) setState({ notice: null });
    }, NOTICE_MS);
  },
};
