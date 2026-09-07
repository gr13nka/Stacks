// api.ts — the single boundary between the UI and the platform. Only the
// adapters behind it (tauri.ts, mock.ts) may import @tauri-apps/*.
import type { KeyValueStorage } from '../store/storage';
import type {
  Environment,
  Photo,
  PlaceLabel,
  RestoreReport,
  ScanEvent,
  ScanSummary,
  Source,
  TrashedFile,
  TrashReport,
  Volume,
} from './types';
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
  /** `thumb://localhost/${id}/${size}` — an orientation-corrected JPEG. */
  thumbUrl(photo: Photo, size: ThumbSize): string;
  /** The full-size primary file (convertFileSrc). */
  originalUrl(photo: Photo): string;
  prefetchThumbs(ids: string[], size: ThumbSize): Promise<void>;
  /** Offline nearest-city labels, one per [lat, lon]; null when nothing is within 100 km. */
  labelPlaces(points: [number, number][]): Promise<(PlaceLabel | null)[]>;
  /** Moves the primaries (and RAWs when includeRaw) to the Trash. The only call that touches disk. */
  trashPhotos(ids: string[], includeRaw: boolean): Promise<TrashReport>;
  restoreTrashed(items: TrashedFile[]): Promise<RestoreReport>;
  pickFolder(): Promise<string | null>;
  storage: KeyValueStorage;
}

// `window` is absent under vitest (environment: node); the mock wins there.
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const api: StacksApi = inTauri && !import.meta.env.VITE_STACKS_MOCK ? tauriApi : mockApi;
