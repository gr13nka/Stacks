# Stacks

macOS desktop app for culling photos. Scans SD cards, external drives and local folders, groups photos into per-session "stacks" on a countdown calendar (or by place), lets you swipe each stack Tinder-style (right = keep, left = reject), and feeds the reject pile into an animated shredder that moves the files to the macOS Trash. JPG+RAW pairs are one card.

Tauri v2 (Rust backend) + React 18 + TypeScript + Vite + framer-motion 11. macOS only. Design and gesture language is inherited from the sibling prototype `../Stamps2` (read-only reference; never import from it).

## Commands

```bash
npm run app                    # real volumes and home folders
npm run fixtures               # generate ./fixtures (fake SD card, ~110 photos with EXIF/GPS)
npm run app:fixtures           # app with the fixture card mounted as a fake volume
VITE_STACKS_MOCK=1 npm run dev # frontend only, in a browser at :1420, synthetic data, no Rust
npm run build                  # tsc --noEmit (strict) + vite build
npm test                       # vitest, pure domain logic (42 tests)
npm run test:rust              # cargo test for src-tauri (31 tests, includes live ImageIO/trash smoke tests)
cargo test --manifest-path tools/make-fixtures/Cargo.toml   # fixture generator round-trip tests
```

Never run two app instances at once: they share `~/Library/Application Support/com.username.stacks/stacks.json` (decisions, settings) and the fixture folder.

## Toolchain caveats (this machine)

- `cargo`/`rustc` are Homebrew 1.95 at `/usr/local/bin`, shadowing rustup 1.93 in `~/.cargo/bin`. Keep Homebrew first on PATH. Never add `rust-toolchain.toml` (silently ignored, and rustup's stable is too old).
- Node comes from Nix; `npm install -g` fails. Use `npx` and local devDependencies only (`@tauri-apps/cli` is local).
- WKWebView follows Safari (17.6 staged on this Monterey box). Settings → about shows the UA. Vite build target is `safari16`.
- `/Volumes/Sequoia*` are internal read-only APFS volumes of a second macOS install; `volumes::classify` must keep excluding them, along with the `/Volumes/Macintosh HD -> /` symlink.
- No exiftool on the machine; EXIF is read in Rust. `SETUP-NOTES.md` has exact installed versions.

## Architecture

The frontend never sees file paths except as opaque data inside `Photo`. Rust classifies files, reads EXIF, makes pixels, and moves files. All derivation (stacks, months, places, deck queue, progress) is pure TypeScript.

### Rust — `src-tauri/src/`

| Module | Owns |
|---|---|
| `lib.rs` | Builder wiring only: dialog + store plugins, `AppState`, `thumb` scheme, aspect lock, volume watcher, `generate_handler!` with the 8 commands |
| `state.rs` | `AppState`: id→path index (the only thing shared by catalog, thumbs, trash), meta cache, thumbnailer |
| `catalog/` | `scan`: walk (`walkdir`, `follow_links(false)`, prunes dot-entries, `*.photoslibrary`, `*.app`, DCIM-only on cards) → `pair` (same dir + lowercase stem; JPG > HEIC > TIFF > PNG primary, RAW attaches) → `meta` (nom-exif for jpg/heic/raf/cr3/png, kamadak-exif for arw/cr2/nef/dng/orf/pef/rw2/tiff, pairs read the JPG only, fallback mtime) → `cache` (JSON keyed `path|size|mtime` in app data dir). Streams `Batch` events of ≤200 over a `Channel` |
| `thumbs.rs` | `thumb://localhost/<id>/<size>` (512 or 1600) via `register_asynchronous_uri_scheme_protocol`; macOS ImageIO in-process (`objc2-image-io`), orientation applied, JPEG q0.8 cached in app cache dir; rayon pool of 4, card volumes gated to 2 |
| `volumes.rs` | Enumerate via NSURL volume keys; classify on Removable or Ejectable (an SD card in the built-in reader reports Internal=true); NSWorkspace mount/unmount observer emits `volumes-changed`; `STACKS_FIXTURES=<dir>` adds a fake card and switches default sources to `<dir>/local/*` |
| `trash.rs` | `NSFileManager.trashItemAtURL:` (never the Finder method, which triggers a TCC prompt); returns `TrashedFile {id, from, to}` per file (a pair yields two entries with the same id); `restore` renames back. Errors classified `read-only` / `missing` / `other` |
| `geocode.rs` | `reverse_geocoder` (bundled GeoNames, offline, CC BY 4.0 attribution shown in Settings); `None` beyond 100 km |
| `window.rs` | 390:844 content aspect lock through `ns_window()` |

Commands: `list_volumes`, `default_sources`, `scan_catalog`, `prefetch_thumbs`, `label_places`, `trash_photos`, `restore_trashed`, `environment`. Event: `volumes-changed`. Wire format is camelCase; `ScanEvent` is tagged `type` with `rename_all_fields`.

### TypeScript — `src/`

| Path | Owns |
|---|---|
| `api/types.ts` | Mirror of the Rust serde structs. Additive changes only; keep both sides in sync |
| `api/api.ts` | `StacksApi` interface; picks `tauri.ts` inside Tauri, `mock.ts` in a browser or under `VITE_STACKS_MOCK`. The only place `@tauri-apps/*` is imported |
| `api/mock.ts` | Deterministic synthetic catalog mirroring the fixture scenario (SVG data-URI thumbs); used by `npm run dev` and tests |
| `domain/` | Pure, DOM-free, tested: `time`, `stacks` (`buildStacks`: per volume, sort by time, split when gap > threshold), `calendar` (countdown day order, month windowing offsets), `places` (greedy centroid clustering, haversine, trailing "somewhere"), `deck` (queue, status, `cardFitRect`, `swipeDecision`), `rejects` (grouping/layout), `shred` (feed timing and poses) |
| `store/` | External store (`useSyncExternalStore`), `actions`, memoised selectors, 150 ms debounced persist of `decisions`/`placeLabels`/`settings` under key `stacks/v1` through `KeyValueStorage`. `boot()` scans volumes + default sources + user folders, subscribes to volume changes, geocodes cluster centroids |
| `tokens.ts` | Every colour, type size, shadow, spring preset, `MOTION` role and layout rect (`TOPBAR`, `CAL`, `DECK`, `REJECTS`, `SHREDDER`, `SETTINGS`, `BACK`, `LAYER`). No DOM or React imports |
| `lib/gesture.ts`, `lib/frame.ts`, `motion/` | Verbatim from Stamps2: pointer gesture engine (slop, axis lock, velocity projection), frame-space maths, spring helpers, `Hero` FLIP between static rects, `Overlay` with `onTapEmpty` |
| `components/` | `Print` (the one place that knows how a print looks: border, RAW badge, date stamp, reject tape), `IconBar`, `Scroller` (native scroll + arithmetic windowing), `Flight`, `StackPrint`, `TextButton`, `Pickable`, `Caption` |
| `screens/` | `CalendarScreen`, `PlacesScreen`, `DeckScreen`, `RejectsScreen`, `ShredderScreen`, `SettingsScreen`, each with a subfolder of per-item components |

### Screen flow

`main` (calendar or places mode) → tap a stack → `deck` (hero from the cell) → swipe; rejects fly to the edge pile → `rejects` (review, rescue) → `shredder` → files trashed only after the last feed animation completes → undo window 20 s. Top icon bar switches calendar / places / rejects / settings; tapping empty space at the bottom goes back. Screens are stacked, not swapped (`history` in the store), so heroes can return.

## Rules that keep this codebase coherent

- Pointer events only, no `:hover`. Flexbox or absolute rects only, no CSS grid. Animate transform and opacity only. framer-motion is the only animation dependency.
- Every rect comes from `tokens.ts` arithmetic; never measure the DOM for layout or hero origins.
- Never call `useMotionValue`/`useTransform` inside loops; dynamic lists use per-item child components.
- All UI text is lowercase via `.phone`; only the place-name input opts out.
- `domain/` stays pure and gets a vitest test for every new function. Rust modules get `cargo test` for pure logic (`pair`, `walk`, `classify`, `meta`, cache keys).
- Nothing touches disk before the shredder's last feed completes; `trash_photos` is the only destructive call, and `restore_trashed` must be able to undo it from the returned `TrashedFile` list.
- Keep the Rust wire format identical to `api/types.ts`; if Rust must change, change the TS type in the same commit.

## Fixtures

`tools/make-fixtures` is a standalone crate (own workspace, own target). `npm run fixtures` writes `fixtures/` deterministically: 12 sessions over 6 days (28 Oct – 5 Nov 2024), a 2 h 50 m gap that must join and a 3 h 10 m gap that must split, Lisbon and Porto GPS clusters, JPG+RAF/ARW/CR3 twins (RAW = byte copy of the JPEG), one RAW-only file, three orientation-6 files, three files with no EXIF (mtime fallback), and decoys under `DCIM/.hidden/` and a `.photoslibrary` whose EXIF date is 27 Oct, so a pruning bug shows up as a stray stack. `MANIFEST.txt` lists expectations.

## Verification status

Verified: `npm run build`, `npm test`, `cargo test` (both crates) all green; the thumbnail cache received files from a live run, so the custom `thumb:` scheme is exercised end to end.

Not verified live (check by using the app with the fixture card): aspect lock versus the zoom button, decision persistence across relaunch, place renaming, the write-protected card path (`chmod -w fixtures/DCIM/100FUJI` then shred), shred/not-yet button contrast over the dark cavity (`TextButton` tone `paper` exists as the fallback), deck hero exit when the top card's aspect differs from the first, keyboard focus in WKWebView for the arrow keys, and "add folder" through the dialog plugin.

Known risks: which embedded preview ImageIO picks for RAW-only files from real cameras (pairs are unaffected); the first `label_places` call parses the city table (~1 s); the same photo on a card and in an imported folder appears twice (no hash de-duplication).

## Plan and history

The approved design lives at `~/.claude/plans/i-want-to-create-quirky-bonbon.md` (module map, rects, choreography, verification checklist). `SETUP-NOTES.md` records installed versions and every deviation made during scaffolding.
