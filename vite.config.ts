import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Set by `tauri dev` when a mobile device must reach the dev server; unused on desktop.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  // Tauri-specific options, only meaningful under `tauri dev` / `tauri build`:
  // keep Rust errors visible, fail if port 1420 is taken, never watch src-tauri.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  // The app only ever runs in WKWebView (Safari 16+ on macOS 12).
  build: { target: 'safari16' },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
