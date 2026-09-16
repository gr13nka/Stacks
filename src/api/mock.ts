// mock.ts — in-browser StacksApi for `VITE_STACKS_MOCK=1 npm run dev` and
// tests. A deterministic synthetic catalog mirroring the fixture scenario
// (plan §5): one card with Fuji / Sony / Canon folders (JPG+RAW twins, one
// RAW-only), a GPS-less local folder of iPhone shots, six shooting days
// between 28 Oct and 5 Nov 2024 with a 2 h 50 m gap that joins and a
// 3 h 10 m gap that splits, two GPS clusters (Lisbon, Porto). Thumbs are
// SVG data URIs coloured per session and numbered per photo; the trash is
// an in-memory list so shred / undo can be exercised end to end, and
// rotatePhoto / locatePhotos edit the in-memory catalog the way the Rust
// writer edits files (JPEGs only, camera GPS kept).

import type { StacksApi, ThumbSize } from './api';
import type { City, FileFailure, Photo, PlaceLabel, RetagReport, Source, TrashedFile, Volume } from './types';
import { localStorageAdapter } from '../store/storage';
import { rotateOrientation } from '../domain/orientation';
import { haversineKm } from '../domain/places';
import { HOUR_MS, wallClockToMs } from '../domain/time';

// ---- scenario ---------------------------------------------------------------

type CamKey = 'fuji' | 'sony' | 'canon' | 'iphone';

type Cam = { camera: string; dir: string; prefix: string; ext: string; raw: string | null; volumeId: string };

const CARD_ROOT = '/Volumes/CARD01';
const LOCAL_ROOT = '/Users/me/Pictures';

const CAMS: Record<CamKey, Cam> = {
  fuji: { camera: 'FUJIFILM X-T4', dir: `${CARD_ROOT}/DCIM/100FUJI`, prefix: 'DSCF', ext: 'JPG', raw: 'RAF', volumeId: 'card' },
  sony: { camera: 'SONY ILCE-7M4', dir: `${CARD_ROOT}/DCIM/101SONY`, prefix: 'DSC0', ext: 'JPG', raw: 'ARW', volumeId: 'card' },
  canon: { camera: 'Canon EOS R6', dir: `${CARD_ROOT}/DCIM/102CANON`, prefix: 'IMG_', ext: 'JPG', raw: 'CR3', volumeId: 'card' },
  iphone: { camera: 'Apple iPhone 15', dir: `${LOCAL_ROOT}/2024-11`, prefix: 'IMG_1', ext: 'JPG', raw: null, volumeId: 'local' },
};

const LISBON = { lat: 38.7223, lon: -9.1393 };
const PORTO = { lat: 41.1579, lon: -8.6291 };
const PLACES: Record<'lisbon' | 'porto', { centre: { lat: number; lon: number }; label: Omit<PlaceLabel, 'distanceKm'> }> = {
  lisbon: { centre: LISBON, label: { name: 'Lisbon', admin1: 'Lisboa', country: 'PT' } },
  porto: { centre: PORTO, label: { name: 'Porto', admin1: 'Porto', country: 'PT' } },
};

type Session = {
  day: string;
  /** 'HH:MM' start, or a gap in minutes after the previous session's last photo. */
  start?: string;
  gapMin?: number;
  cam: CamKey;
  n: number;
  place: keyof typeof PLACES | null;
  portraitAt?: number[];
  mtimeAt?: number[];
  rawOnlyAt?: number[];
};

const SESSIONS: Session[] = [
  { day: '2024-10-28', start: '09:12', cam: 'fuji', n: 10, place: 'lisbon', portraitAt: [3] },
  { day: '2024-10-28', start: '15:40', cam: 'fuji', n: 8, place: 'lisbon' },
  { day: '2024-10-29', start: '11:05', cam: 'fuji', n: 12, place: 'lisbon' },
  { day: '2024-10-29', gapMin: 170, cam: 'fuji', n: 11, place: 'lisbon' },          // 2 h 50 m → same stack
  { day: '2024-10-31', start: '10:00', cam: 'sony', n: 9, place: 'porto', portraitAt: [0, 5] },
  { day: '2024-10-31', gapMin: 190, cam: 'sony', n: 7, place: 'porto' },            // 3 h 10 m → new stack
  { day: '2024-11-01', start: '16:30', cam: 'sony', n: 14, place: 'porto' },
  { day: '2024-11-03', start: '12:00', cam: 'canon', n: 11, place: 'lisbon', rawOnlyAt: [6] },
  { day: '2024-11-03', start: '19:45', cam: 'canon', n: 6, place: 'lisbon' },
  { day: '2024-11-05', start: '08:30', cam: 'iphone', n: 13, place: null, mtimeAt: [2, 7, 11] },
  { day: '2024-11-05', start: '18:00', cam: 'iphone', n: 9, place: null },
];

/** Every photo ever generated, in scenario order, with its visual identity. */
type Entry = { photo: Photo; session: number; index: number; cam: CamKey; portrait: boolean };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 16 hex chars of a 64-bit FNV-1a over the path — stands in for the Rust sha256 prefix. */
function pathId(path: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x811c9dc5);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function wallClock(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

function generate(): Entry[] {
  const rand = mulberry32(20241028);
  const entries: Entry[] = [];
  const counters: Record<CamKey, number> = { fuji: 0, sony: 0, canon: 0, iphone: 0 };
  let prevEnd = 0;

  SESSIONS.forEach((session, s) => {
    const cam = CAMS[session.cam];
    let t = session.start !== undefined ? wallClockToMs(`${session.day}T${session.start}:00`) : prevEnd + (session.gapMin ?? 0) * 60_000;
    for (let k = 0; k < session.n; k++) {
      if (k > 0) t += Math.round(40_000 + rand() * 50_000); // 40–90 s apart
      counters[session.cam] += 1;
      const stem = `${cam.prefix}${String(counters[session.cam]).padStart(4, '0')}`;
      const rawOnly = session.rawOnlyAt?.includes(k) ?? false;
      const portrait = session.portraitAt?.includes(k) ?? false;
      const path = rawOnly ? `${cam.dir}/${stem}.${cam.raw}` : `${cam.dir}/${stem}.${cam.ext}`;
      const place = session.place ? PLACES[session.place].centre : null;
      const photo: Photo = {
        id: pathId(path),
        path,
        rawPath: rawOnly || !cam.raw ? null : `${cam.dir}/${stem}.${cam.raw}`,
        volumeId: cam.volumeId,
        takenAt: wallClock(t),
        takenAtSource: session.mtimeAt?.includes(k) ? 'mtime' : 'exif',
        gps: place ? { lat: place.lat + (rand() - 0.5) * 0.04, lon: place.lon + (rand() - 0.5) * 0.04 } : null,
        orientation: portrait ? 6 : 1,
        aspect: rawOnly ? null : portrait ? 2 / 3 : 1.5,
        camera: cam.camera,
        size: Math.round(4_000_000 + rand() * 8_000_000),
        mtime: t + 1000,
      };
      entries.push({ photo, session: s, index: entries.length + 1, cam: session.cam, portrait });
    }
    prevEnd = t;
  });
  return entries;
}

// ---- state ------------------------------------------------------------------

const ALL = generate();
const entryById = new Map(ALL.map((e) => [e.photo.id, e]));
/** Photos currently on disk (trashPhotos removes, restoreTrashed re-adds). */
const catalog = new Map(ALL.map((e) => [e.photo.id, e.photo]));
const trash = new Map<string, TrashedFile>();

const VOLUMES: Volume[] = [
  { id: 'card', name: 'card01', path: CARD_ROOT, kind: 'card', readOnly: false, hasDcim: true },
];

const DEFAULT_SOURCES: Source[] = [{ volumeId: 'local', root: LOCAL_ROOT, kind: 'folder' }];

const BATCH = 40;
const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- thumbs -----------------------------------------------------------------

const thumbCache = new Map<string, string>();

function sessionHue(session: number): number {
  return (session * 47 + 200) % 360;
}

/** Clockwise quarter turns from the generated orientation to `photo`'s — the thumb follows the photo, like `?o=` does in tauri.ts. */
function turnsSinceGenerated(entry: Entry, photo: Photo): number {
  for (let t = 0; t < 4; t++) if (rotateOrientation(entry.photo.orientation, t) === photo.orientation) return t;
  return 0;
}

/** Photos whose GPS was written by locatePhotos (the mock's GPSProcessingMethod = "MANUAL"). */
const manualGps = new Set<string>();

/** The SVG transform that turns a w×h drawing by t clockwise quarter turns into its new box. */
function turnTransform(t: number, w: number, h: number): string {
  if (t === 1) return `translate(${h} 0) rotate(90)`;
  if (t === 2) return `translate(${w} ${h}) rotate(180)`;
  if (t === 3) return `translate(0 ${w}) rotate(270)`;
  return '';
}

function svgThumb(entry: Entry, size: ThumbSize, turns: number): string {
  const key = `${entry.photo.id}/${size}/${turns}`;
  const cached = thumbCache.get(key);
  if (cached) return cached;

  const long = size;
  const short = Math.round(size / 1.5);
  const w = entry.portrait ? short : long;
  const h = entry.portrait ? long : short;
  const [outW, outH] = turns % 2 === 1 ? [h, w] : [w, h];
  const hue = sessionHue(entry.session);
  const inset = Math.round(size * 0.035);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">` +
    `<g transform="${turnTransform(turns, w, h)}">` +
    `<rect width="${w}" height="${h}" fill="hsl(${hue} 34% 52%)"/>` +
    `<rect x="${inset}" y="${inset}" width="${w - 2 * inset}" height="${h - 2 * inset}" fill="hsl(${hue} 40% 62%)"/>` +
    `<circle cx="${w * 0.7}" cy="${h * 0.3}" r="${size * 0.08}" fill="hsl(${(hue + 40) % 360} 60% 80%)"/>` +
    `<text x="${w / 2}" y="${h * 0.56}" font-family="ui-monospace, Menlo, monospace" font-size="${Math.round(size * 0.22)}" fill="rgba(255,255,255,0.92)" text-anchor="middle">${entry.index}</text>` +
    `<text x="${w / 2}" y="${h - inset * 2}" font-family="ui-monospace, Menlo, monospace" font-size="${Math.round(size * 0.05)}" fill="rgba(255,255,255,0.75)" text-anchor="middle">${entry.cam}</text>` +
    `</g></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  thumbCache.set(key, url);
  return url;
}

// ---- metadata writes and city search ---------------------------------------------

const isJpeg = (path: string) => /\.jpe?g$/i.test(path);

/** Looks up a photo the way the Rust writer would, or explains why it can't be written. */
function writable(id: string): Photo | FileFailure {
  const photo = catalog.get(id);
  if (!photo) return { id, path: '', reason: 'missing', message: 'not in catalog' };
  if (!isJpeg(photo.path)) return { id, path: photo.path, reason: 'unsupported', message: 'not a jpeg' };
  return photo;
}

const CITIES: City[] = [
  { name: 'Lisbon', admin1: 'Lisbon', country: 'PT', lat: 38.71667, lon: -9.13333 },
  { name: 'Sintra', admin1: 'Lisbon', country: 'PT', lat: 38.80097, lon: -9.37826 },
  { name: 'Cascais', admin1: 'Lisbon', country: 'PT', lat: 38.69979, lon: -9.42293 },
  { name: 'Porto', admin1: 'Porto', country: 'PT', lat: 41.14961, lon: -8.61099 },
  { name: 'Coimbra', admin1: 'Coimbra', country: 'PT', lat: 40.20564, lon: -8.41955 },
  { name: 'Faro', admin1: 'Faro', country: 'PT', lat: 37.01869, lon: -7.92716 },
  { name: 'Paris', admin1: 'Ile-de-France', country: 'FR', lat: 48.85341, lon: 2.3488 },
  { name: 'Paris', admin1: 'Texas', country: 'US', lat: 33.66094, lon: -95.55551 },
];

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const BLANK_THUMB =
  'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>');

// ---- api --------------------------------------------------------------------

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const mockApi: StacksApi = {
  async environment() {
    return {
      version: '0.1.0-mock',
      fixtures: true,
      userAgent: typeof navigator === 'undefined' ? 'node' : navigator.userAgent,
    };
  },

  async listVolumes() {
    return VOLUMES.map((v) => ({ ...v }));
  },

  onVolumesChanged() {
    return () => {};
  },

  async defaultSources() {
    return DEFAULT_SOURCES.map((s) => ({ ...s }));
  },

  async scanCatalog(sources, onEvent) {
    const perVolume: Record<string, number> = {};
    for (const source of sources) {
      const photos = [...catalog.values()].filter((p) => p.volumeId === source.volumeId);
      for (let i = 0; i < photos.length; i += BATCH) {
        await tick(30);
        onEvent({ type: 'batch', volumeId: source.volumeId, photos: photos.slice(i, i + BATCH) });
      }
      perVolume[source.volumeId] = photos.length;
      onEvent({ type: 'sourceDone', volumeId: source.volumeId, count: photos.length });
    }
    return { total: Object.values(perVolume).reduce((a, b) => a + b, 0), perVolume };
  },

  thumbUrl(photo, size) {
    const entry = entryById.get(photo.id);
    return entry ? svgThumb(entry, size, turnsSinceGenerated(entry, photo)) : BLANK_THUMB;
  },

  originalUrl(photo) {
    return mockApi.thumbUrl(photo, 1600);
  },

  async prefetchThumbs() {},

  async labelPlaces(points) {
    return points.map(([lat, lon]) => {
      let best: PlaceLabel | null = null;
      for (const { centre, label } of Object.values(PLACES)) {
        const distanceKm = haversineKm({ lat, lon }, centre);
        if (distanceKm <= 100 && (!best || distanceKm < best.distanceKm)) best = { ...label, distanceKm };
      }
      return best;
    });
  },

  async searchCities(query, near) {
    await tick(20);
    const q = fold(query);
    if (!q) return [];
    const tier = (name: string) => (name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3);
    const away = (c: City) => (near ? haversineKm(near, c) : 0);
    return CITIES.filter((c) => tier(fold(c.name)) < 3).sort(
      (a, b) => tier(fold(a.name)) - tier(fold(b.name)) || away(a) - away(b),
    );
  },

  async rotatePhoto(id, quarterTurns) {
    await tick(60);
    const found = writable(id);
    if (!('volumeId' in found)) return { updated: [], kept: [], failed: [found] };
    const q = ((quarterTurns % 4) + 4) % 4;
    const updated: Photo = {
      ...found,
      orientation: rotateOrientation(found.orientation, q),
      aspect: found.aspect && q % 2 === 1 ? 1 / found.aspect : found.aspect,
    };
    catalog.set(id, updated);
    return { updated: [updated], kept: [], failed: [] };
  },

  async locatePhotos(ids, lat, lon) {
    await tick(80);
    const report: RetagReport = { updated: [], kept: [], failed: [] };
    for (const id of ids) {
      const found = writable(id);
      if (!('volumeId' in found)) report.failed.push(found);
      else if (found.gps && !manualGps.has(id)) report.kept.push(id);
      else {
        const updated: Photo = { ...found, gps: { lat, lon } };
        catalog.set(id, updated);
        manualGps.add(id);
        report.updated.push(updated);
      }
    }
    return report;
  },

  async trashPhotos(ids, includeRaw) {
    await tick(200);
    const trashed: TrashedFile[] = [];
    const failed: FileFailure[] = [];
    for (const id of ids) {
      const photo = catalog.get(id);
      if (!photo) {
        failed.push({ id, path: '', reason: 'missing', message: 'not in catalog' });
        continue;
      }
      const item: TrashedFile = { id, from: photo.path, to: `/Users/me/.Trash/${basename(photo.path)}` };
      trash.set(id, item);
      trashed.push(item);
      if (includeRaw && photo.rawPath) {
        const rawItem: TrashedFile = { id: `${id}:raw`, from: photo.rawPath, to: `/Users/me/.Trash/${basename(photo.rawPath)}` };
        trash.set(rawItem.id, rawItem);
        trashed.push(rawItem);
      }
      catalog.delete(id);
    }
    return { trashed, failed };
  },

  async restoreTrashed(items) {
    await tick(200);
    const restored: string[] = [];
    const failed: { path: string; message: string }[] = [];
    for (const item of items) {
      const known = trash.get(item.id);
      const entry = entryById.get(item.id.replace(/:raw$/, ''));
      if (!known || !entry) {
        failed.push({ path: item.from, message: 'not in trash' });
        continue;
      }
      trash.delete(item.id);
      catalog.set(entry.photo.id, entry.photo);
      restored.push(item.from);
    }
    return { restored, failed };
  },

  async pickFolder() {
    return null;
  },

  storage: localStorageAdapter,
};

/** Test hook: the full generated scenario, independent of trash state. */
export const MOCK_SCENARIO = { photos: ALL.map((e) => e.photo), sessions: SESSIONS, gapHours: 3, HOUR_MS };
