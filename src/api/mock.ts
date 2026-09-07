// mock.ts — in-browser StacksApi for `VITE_STACKS_MOCK=1 npm run dev` and
// tests. Stub: every call succeeds with empty data. The frontend agent
// replaces the bodies with the synthetic scenario (~240 photos, SVG thumbs).
import type { StacksApi } from './api';
import { localStorageAdapter } from '../store/storage';

const BLANK_THUMB =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

export const mockApi: StacksApi = {
  async environment() {
    return { version: '0.1.0-mock', fixtures: false, userAgent: navigator.userAgent };
  },
  async listVolumes() {
    return [];
  },
  onVolumesChanged() {
    return () => {};
  },
  async defaultSources() {
    return [];
  },
  async scanCatalog() {
    return { total: 0, perVolume: {} };
  },
  thumbUrl() {
    return BLANK_THUMB;
  },
  originalUrl() {
    return BLANK_THUMB;
  },
  async prefetchThumbs() {},
  async labelPlaces(points) {
    return points.map(() => null);
  },
  async trashPhotos() {
    return { trashed: [], failed: [] };
  },
  async restoreTrashed() {
    return { restored: [], failed: [] };
  },
  async pickFolder() {
    return null;
  },
  storage: localStorageAdapter,
};
