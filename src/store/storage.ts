// storage.ts — the persistence boundary. Swap localStorageAdapter for an
// AsyncStorage-backed implementation on the React Native port; nothing else
// in the store needs to change.

export type KeyValueStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export const localStorageAdapter: KeyValueStorage = {
  async get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // storage unavailable (private mode, quota, SSR) — silently drop
    }
  },
};
