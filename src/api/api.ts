// api.ts — the single boundary between the UI and the platform. Only the
// adapters behind it (tauri.ts, mock.ts) may import @tauri-apps/*.
import type { KeyValueStorage } from '../store/storage';
import type {
  City,
  Environment,
  Photo,
  PlaceLabel,
  RestoreReport,
  RetagReport,
  ScanEvent,
  ScanSummary,
  Source,
  TrashedFile,
  TrashReport,
  Volume,
} from './types';
import type { LatLon } from '../domain/places';
import { tauriApi } from './tauri';
import { mockApi } from './mock';

export type ThumbSize = 512 | 1600;

export interface StacksApi {
  environment(): Promise<Environment>;
  listVolumes(): Promise<Volume[]>;
  /** Subscribes to mount/unmount changes; returns the unsubscribe function. */
  onVolumesChanged(cb: (volumes: Volume[]) => void): () => void;
  defaultSources(): Promise<Source[]>;
  /** Streams photos in batches through onEvent while the walk runs; resolves with the totals. */
  scanCatalog(sources: Source[], onEvent: (e: ScanEvent) => void): Promise<ScanSummary>;
  /** An orientation-corrected JPEG; the URL changes with photo.orientation so a rotation is never served from cache. */
  thumbUrl(photo: Photo, size: ThumbSize): string;
  /** The full-size primary file (convertFileSrc). */
  originalUrl(photo: Photo): string;
  prefetchThumbs(ids: string[], size: ThumbSize): Promise<void>;
  /** Offline nearest-city labels, one per [lat, lon]; null when nothing is within 100 km. */
  labelPlaces(points: [number, number][]): Promise<(PlaceLabel | null)[]>;
  /** Offline city search, best match first; `near` breaks ties between same-named cities. */
  searchCities(query: string, near: LatLon | null): Promise<City[]>;
  /**
   * Turns the photo clockwise by writing the EXIF Orientation of its JPEG
   * (never pixels, never the RAW). RAW-only and non-JPEG photos fail as 'unsupported'.
   */
  rotatePhoto(id: string, quarterTurns: number): Promise<RetagReport>;
  /** Writes GPS into each JPEG that has none (or a previous manual one); camera GPS is kept. */
  locatePhotos(ids: string[], lat: number, lon: number): Promise<RetagReport>;
  /** Moves the primaries (and RAWs when includeRaw) to the Trash. The only call that moves or removes files. */
  trashPhotos(ids: string[], includeRaw: boolean): Promise<TrashReport>;
  restoreTrashed(items: TrashedFile[]): Promise<RestoreReport>;
  pickFolder(): Promise<string | null>;
  storage: KeyValueStorage;
}

// `window` is absent under vitest (environment: node); the mock wins there.
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const api: StacksApi = inTauri && !import.meta.env.VITE_STACKS_MOCK ? tauriApi : mockApi;
