/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Any non-empty value forces the in-browser mock API, even inside Tauri. */
  readonly VITE_STACKS_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
