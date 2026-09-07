// tauri.ts — StacksApi over the Rust commands. Stub: the Phase-2 A2 agent
// replaces every method with invoke()/Channel/listen()/convertFileSrc and
// swaps `storage` for a tauri-plugin-store adapter.
import type { StacksApi } from './api';
import { localStorageAdapter } from '../store/storage';

const notWired = () => new Error('tauri api not wired yet');

export const tauriApi: StacksApi = {
  async environment() {
    throw notWired();
  },
  async listVolumes() {
    throw notWired();
  },
  onVolumesChanged() {
    throw notWired();
  },
  async defaultSources() {
    throw notWired();
  },
  async scanCatalog() {
    throw notWired();
  },
  thumbUrl() {
    throw notWired();
  },
  originalUrl() {
    throw notWired();
  },
  async prefetchThumbs() {
    throw notWired();
  },
  async labelPlaces() {
    throw notWired();
  },
  async trashPhotos() {
    throw notWired();
  },
  async restoreTrashed() {
    throw notWired();
  },
  async pickFolder() {
    throw notWired();
  },
  storage: localStorageAdapter,
};
