// tauri.ts — StacksApi over the Rust commands in src-tauri/src/lib.rs. Besides
// mock.ts this is the only module that imports @tauri-apps/*; everything the
// UI knows about the platform arrives through the StacksApi interface.
import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { LazyStore } from '@tauri-apps/plugin-store';
import type { StacksApi } from './api';
import type { KeyValueStorage } from '../store/storage';
import type {
  City,
  Environment,
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

/** Emitted by the Rust volume watcher with the fresh list on mount/unmount. */
const VOLUMES_CHANGED = 'volumes-changed';

/** Rust commands reject with a bare string; the store expects an Error. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(typeof e === 'string' ? e : JSON.stringify(e));
  }
}

// One JSON file in app_data_dir. `set` writes through so a decision made just
// before a crash or eject survives; the store's own autosave would debounce it.
const store = new LazyStore('stacks.json');

const storeStorage: KeyValueStorage = {
  async get(key) {
    const value = await store.get<unknown>(key);
    return typeof value === 'string' ? value : null;
  },
  async set(key, value) {
    await store.set(key, value);
    await store.save();
  },
};

export const tauriApi: StacksApi = {
  async environment() {
    const env = await call<Environment>('environment');
    return { ...env, userAgent: navigator.userAgent };
  },

  listVolumes: () => call<Volume[]>('list_volumes'),

  // listen() resolves its unlisten asynchronously; unsubscribing before that
  // must still detach, and events must not leak through in the meantime.
  onVolumesChanged(cb) {
    let active = true;
    let unlisten: (() => void) | null = null;
    listen<Volume[]>(VOLUMES_CHANGED, (event) => {
      if (active) cb(event.payload);
    })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {
        // the event system is unavailable (capability missing); nothing to detach
      });
    return () => {
      active = false;
      unlisten?.();
      unlisten = null;
    };
  },

  defaultSources: () => call<Source[]>('default_sources'),

  scanCatalog(sources, onEvent) {
    const channel = new Channel<ScanEvent>(onEvent);
    return call<ScanSummary>('scan_catalog', { sources, onEvent: channel });
  },

  // WKWebView caches by URL; the query (ignored by the Rust handler) makes a
  // rotated photo a new URL, and four turns land back on the still-valid one.
  thumbUrl: (photo, size) => `thumb://localhost/${photo.id}/${size}?o=${photo.orientation}`,

  originalUrl: (photo) => convertFileSrc(photo.path),

  prefetchThumbs: (ids, size) => call<void>('prefetch_thumbs', { ids, size }),

  labelPlaces: (points) => call<(PlaceLabel | null)[]>('label_places', { points }),

  searchCities: (query, near) => call<City[]>('search_cities', { query, near: near ? [near.lat, near.lon] : null }),

  rotatePhoto: (id, quarterTurns) => call<RetagReport>('rotate_photo', { id, quarterTurns }),

  locatePhotos: (ids, lat, lon) => call<RetagReport>('locate_photos', { ids, lat, lon }),

  trashPhotos: (ids, includeRaw) => call<TrashReport>('trash_photos', { ids, includeRaw }),

  restoreTrashed: (items: TrashedFile[]) => call<RestoreReport>('restore_trashed', { items }),

  async pickFolder() {
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === 'string' ? picked : null;
  },

  storage: storeStorage,
};
