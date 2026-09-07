# Setup notes (Phase 0)

Scaffolded 2026-09-06 with `create-tauri-app` 4.7.4 (`--manager npm --template react-ts`).
Toolchain: Homebrew `cargo` 1.95.0 at `/usr/local/bin/cargo` (rustup 1.93 shadowed; no
`rust-toolchain.toml`), Node 22.22.0 / npm 10.9.4 from Nix (no global installs).

## Versions installed

npm (`package-lock.json`):

| package | version |
|---|---|
| react / react-dom | 18.3.1 |
| typescript | 5.9.3 |
| vite | 5.4.21 |
| vitest | 2.1.9 |
| framer-motion | 11.18.2 |
| @vitejs/plugin-react | 4.7.0 |
| @tauri-apps/api | 2.11.1 |
| @tauri-apps/cli | 2.11.4 |
| @tauri-apps/plugin-dialog | 2.7.3 |
| @tauri-apps/plugin-store | 2.4.4 |
| @types/node | 22.20.1 |
| @types/react / @types/react-dom | 18.3.31 / 18.3.x |

Rust (`src-tauri/Cargo.lock`, 512 packages):

| crate | version |
|---|---|
| tauri | 2.11.5 (features: protocol-asset) |
| tauri-build | 2.6.3 |
| tauri-runtime-wry / wry / tao | 2.11.4 / 0.55.1 / 0.35.3 |
| tauri-plugin-dialog | 2.7.3 |
| tauri-plugin-store | 2.4.4 |
| serde / serde_json | 1.0.229 / 1.0.151 |
| walkdir | 2.5.0 |
| rayon | 1.12.0 |
| sha2 / hex | 0.10.9 / 0.4.3 |
| nom-exif | 3.7.0 |
| kamadak-exif (`use exif::…`) | 0.6.1 |
| imagesize | 0.13.0 |
| reverse_geocoder | 4.1.1 |
| chrono | 0.4.45 (no default features; clock, std) |
| thiserror | 2.0.20 (1.0.69 also present transitively) |
| objc2 | 0.6.4 |
| objc2-foundation | 0.3.2 |
| objc2-app-kit | 0.3.2 |
| objc2-core-foundation | 0.3.2 |
| objc2-core-graphics | 0.3.2 |
| objc2-image-io | 0.3.2 |
| block2 | 0.6.2 |
| image (tools/make-fixtures only) | 0.25.10 (jpeg only) |
| little_exif (tools/make-fixtures only) | 0.6.23 |
| filetime (tools/make-fixtures only) | 0.2.29 |
| tempfile (dev) | 3.27.0 |

Every crate version and feature name from plan section 7 resolved unchanged. No feature
flags were renamed.

Symbols the plan relies on were confirmed present in the locked objc2 crates:
`NSFileManager::trashItemAtURL_resultingItemURL_error`,
`NSFileManager::mountedVolumeURLsIncludingResourceValuesForKeys_options`,
`NSWorkspaceDidMountNotification` / `NSWorkspaceDidUnmountNotification`,
`NSWindow::setContentAspectRatio`, `CGImageSourceCreateThumbnailAtIndex` with
`kCGImageSourceCreateThumbnailFromImageIfAbsent` / `ThumbnailMaxPixelSize` /
`CreateThumbnailWithTransform`, and `CGImageDestination::with_url`.

## Deviations from the plan

1. **React 18, not the template's React 19.** create-tauri-app 4.7.4 now emits React 19.1,
   TypeScript 6.0, Vite 8 and @vitejs/plugin-react 6. `package.json` was rewritten to
   React 18.3 / TypeScript 5 / Vite 5 / plugin-react 4 to match Stamps2 (whose sources are
   copied verbatim), framer-motion 11 and vitest 2 (peer dep `vite ^5`).
2. **`tsconfig.json` mirrors Stamps2's lint set** (`strict`, `noUnusedLocals`,
   `noFallthroughCasesInSwitch`); the template's `noUnusedParameters` was dropped so copied
   Stamps2 files compile unchanged. `lib` gained `DOM.Iterable`.
3. **`vite.config.ts`** imports `defineConfig` from `vitest/config` (types the `test` block);
   `envPrefix: ['VITE_', 'TAURI_ENV_*']` was added because the current template omits it.
   `tsc --noEmit` checks `src/` only; `vite.config.ts` is covered by `tsconfig.node.json`
   (a project reference that `tsc --noEmit` does not build) and is validated by running it.
4. **`api.ts` guards on `typeof window`** before `'__TAURI_INTERNALS__' in window`, so any
   module that imports `api` still loads under vitest (`environment: 'node'`), where the
   mock is selected.
5. **`Rect` / `RectRot` are defined in `tokens.ts`** (their natural home, as in Stamps2) and
   re-exported from `api/types.ts`, so both import paths in the plan work with one definition.
6. **`TrashReport.failed` element type is named `TrashFailure`** (same shape as the plan).
7. **`ScanEvent` field casing.** The TS union expects `volumeId` inside each variant, so the
   Rust enum needs `#[serde(tag = "type", rename_all = "camelCase",
   rename_all_fields = "camelCase")]` (plain `rename_all` only renames the variant tags).
8. **`productName` is `Stacks`** (the template wrote `stacks`); the window title stays `stacks`.
9. **Template leftovers removed:** `src/App.css`, `src/assets/`, `public/vite.svg`,
   `public/tauri.svg`, the generic `README.md`, and `src-tauri/.gitignore` (the root
   `.gitignore` already ignores `src-tauri/target/` and `src-tauri/gen/schemas/`).
   `.vscode/extensions.json` was kept.
10. **`imagesize` pinned to 0.13.0 as in the plan.** 0.15.0 is current and lists an explicit
    `heif` feature; the Rust agent may bump it if HEIC pixel dimensions need it.
11. **`lib.rs` registers an empty `generate_handler![]`** so the dialog and store plugins are
    wired and the crate builds before any command exists.

## Verification

| command | outcome |
|---|---|
| `npm run build` (`tsc --noEmit && vite build`) | PASS — 32 modules, `dist/` incl. `fonts/` |
| `npx vitest run` | PASS — 2 tests in `src/domain/smoke.test.ts` |
| `cargo build --manifest-path src-tauri/Cargo.toml` | PASS (Phase 1A, 0 warnings; `cargo test` 31 passed) |
| `cargo build --manifest-path tools/make-fixtures/Cargo.toml` | fixture generator crate (Phase 1C) |

## Things the next agents must know

- Run `cargo` from a shell where `/usr/local/bin` precedes `~/.cargo/bin`; never add
  `rust-toolchain.toml` or run `rustup update`.
- `npm audit` reports 5 advisories in transitive dev dependencies (vite 5 / esbuild line);
  do not `npm audit fix --force` (it would move to Vite 8).
- Frontend in a plain browser: `VITE_STACKS_MOCK=1 npm run dev` (mock API); `import.meta.env.VITE_STACKS_MOCK` is typed in `src/vite-env.d.ts`.
- The fixture generator is the separate crate `tools/make-fixtures` (npm script `fixtures`);
  `src-tauri/Cargo.toml` has no `fixtures` feature, `[[bin]]` or optional deps any more.
- The CSP in `tauri.conf.json` is exactly the plan's string; Tauri appends its own IPC
  `connect-src` entries. Vite's dev HMR websocket relies on `'self'` covering `ws:`; verify
  in Phase 3 and add `connect-src ws://localhost:1420` if the console reports a violation.
- Fonts: `public/fonts/JetBrainsMono-{Regular,Medium}.woff2` + `OFL.txt` (JetBrains Mono
  2.304). `@font-face` (weights 400 and 500, `font-display: block`) lives in `src/styles.css`.
