# Stacks

macOS desktop app for culling photos. Scans SD cards, external drives and local folders, groups photos into per-session "stacks" on a countdown calendar (or by place), lets you swipe each stack Tinder-style (right = keep, left = reject), and feeds the reject pile into an animated shredder that moves the files to the macOS Trash. JPG+RAW pairs are one card. Tapping a card turns it 90°; long-pressing a stack sets where it was shot. Both are written into the JPEG's EXIF (never pixels, never the RAW).

Tauri v2 (Rust backend) + React 18 + TypeScript + Vite + framer-motion 11. macOS only. Design and gesture language is inherited from the sibling prototype `../Stamps2` (read-only reference; never import from it).

## Commands

```bash
npm run app                    # real volumes and home folders
npm run fixtures               # generate ./fixtures (fake SD card, ~110 photos with EXIF/GPS)
npm run app:fixtures           # app with the fixture card mounted as a fake volume
VITE_STACKS_MOCK=1 npm run dev # frontend only, in a browser at :1420, synthetic data, no Rust
npm run build                  # tsc --noEmit (strict) + vite build
npm test                       # vitest, pure domain logic + mock api (57 tests)
npm run test:rust              # cargo test for src-tauri (60 tests, includes live ImageIO/trash/retag smoke tests)
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

The frontend never sees file paths except as opaque data inside `Photo`. Rust classifies files, reads and writes EXIF, makes pixels, and moves files. All derivation (stacks, months, places, deck queue, progress) is pure TypeScript.

### Rust — `src-tauri/src/`

| Module | Owns |
|---|---|
| `lib.rs` | Builder wiring only: dialog + store plugins, `AppState`, `thumb` scheme, aspect lock, volume watcher, city-table warm-up thread, `generate_handler!` with the 11 commands |
| `state.rs` | `AppState`: id→path index (the only thing shared by catalog, thumbs, trash, retag), meta cache, thumbnailer, `edits` mutex (one file edit at a time) |
| `catalog/` | `scan`: walk (`walkdir`, `follow_links(false)`, prunes dot-entries, `*.photoslibrary`, `*.app`, DCIM-only on cards) → `pair` (same dir + lowercase stem; JPG > HEIC > TIFF > PNG primary, RAW attaches) → `meta` (nom-exif for jpg/heic/raf/cr3/png, kamadak-exif for arw/cr2/nef/dng/orf/pef/rw2/tiff, pairs read the JPG only, fallback mtime) → `cache` (JSON keyed `path|size|mtime` in app data dir). Streams `Batch` events of ≤200 over a `Channel`. `refresh(state, id)` re-reads one photo after an edit, bypassing and then overwriting the cache |
| `thumbs.rs` | `thumb://localhost/<id>/<size>` (512 or 1600; the query string is ignored) via `register_asynchronous_uri_scheme_protocol`; macOS ImageIO in-process (`objc2-image-io`), orientation applied, JPEG q0.8 cached in app cache dir under `sha256(path|px|mtime)` (no file size, so `evict` after an edit is mandatory); rayon pool of 4, card volumes gated to 2 |
| `volumes.rs` | Enumerate via NSURL volume keys; classify on Removable or Ejectable (an SD card in the built-in reader reports Internal=true); NSWorkspace mount/unmount observer emits `volumes-changed`; `STACKS_FIXTURES=<dir>` adds a fake card and switches default sources to `<dir>/local/*` |
| `trash.rs` | `NSFileManager.trashItemAtURL:` (never the Finder method, which triggers a TCC prompt); returns `TrashedFile {id, from, to}` per file (a pair yields two entries with the same id); `restore` renames back |
| `failure.rs` | `FileFailure` / `FailReason` (`read-only` / `missing` / `unsupported` / `other`), `precheck` and `io_reason`, shared by trash and retag |
| `exif_edit.rs` | Pure JPEG EXIF surgery, no IO: `rotate`, `set_gps` (→ `KeepCamera` when the GPS is not ours), `apply`, `compose_cw`. Append-only: Orientation and a re-pick are patched in place; otherwise IFD0 / the GPS IFD are appended and repointed so nothing already in APP1 moves (MakerNote, IFD1 stay valid); MPF entry 0's size and XMP `tiff:Orientation` are fixed up; an APP1 over 64 KB is refused. Manual GPS carries `GPSProcessingMethod = "MANUAL"` |
| `retag.rs` | `rotate` / `locate` over files: JPEG primaries only (RAW, HEIC, PNG, TIFF → `unsupported`), refuses read-only or Finder-locked files, patch in place or `.<name>.stacks.tmp` + `copyfile` xattrs/ACL + rename; creation date always kept, mtime kept only for mtime-dated photos; evicts thumbs, re-reads the photo |
| `geocode.rs` | Owns the vendored GeoNames table `data/cities.csv` (144k rows, offline, CC BY 4.0 attribution shown in Settings): `label` (nearest city, `None` beyond 100 km) and `search` (folded names; tiers exact > prefix > word-prefix > substring, then distance to `near`, then a big-city proxy; 20 results) |
| `window.rs` | 390:844 content aspect lock through `ns_window()` |

Commands: `list_volumes`, `default_sources`, `scan_catalog`, `prefetch_thumbs`, `label_places`, `search_cities`, `rotate_photo`, `locate_photos`, `trash_photos`, `restore_trashed`, `environment`. Event: `volumes-changed`. Wire format is camelCase; `ScanEvent` is tagged `type` with `rename_all_fields`.

### TypeScript — `src/`

| Path | Owns |
|---|---|
| `api/types.ts` | Mirror of the Rust serde structs (incl. `FileFailure`, `RetagReport`, `City`). Additive changes only; keep both sides in sync |
| `api/api.ts` | `StacksApi` interface; picks `tauri.ts` inside Tauri, `mock.ts` in a browser or under `VITE_STACKS_MOCK`. The only place `@tauri-apps/*` is imported. `tauri.ts` cache-busts thumbs with `?o=<orientation>` (WKWebView caches by URL) |
| `api/mock.ts` | Deterministic synthetic catalog mirroring the fixture scenario (SVG data-URI thumbs that turn with the photo's orientation; rotate/locate edit the in-memory catalog with the Rust rules); used by `npm run dev` and tests |
| `domain/` | Pure, DOM-free, tested: `time`, `stacks` (`buildStacks`: per volume, sort by time, split when gap > threshold), `calendar` (countdown day order, month windowing offsets), `places` (greedy centroid clustering, haversine, trailing "somewhere", `stackCentroid`, `nearestFix` = the search hint), `deck` (queue, status, `cardFitRect`, `turnedCardScale`, `swipeDecision`), `orientation` (EXIF turn table, mirrors Rust `compose_cw`), `rejects` (grouping/layout), `shred` (feed timing and poses) |
| `store/` | External store (`useSyncExternalStore`), `actions`, memoised selectors, 150 ms debounced persist of `decisions`/`placeLabels`/`settings` under key `stacks/v1` through `KeyValueStorage`. `boot()` scans volumes + default sources + user folders, subscribes to volume changes, geocodes cluster centroids. `rotate` keeps in-memory `pendingTurns` and one write in flight per photo (taps coalesce; the re-read photo and settled turns land in one `setState` after the new thumb is decoded). `locateStack` writes in chunks of 10 with a progress notice. `flash` = self-clearing notice |
| `tokens.ts` | Every colour, type size, shadow, spring preset, `MOTION` role and layout rect (`TOPBAR`, `CAL`, `DECK`, `REJECTS`, `SHREDDER`, `ROW`, `SETTINGS`, `BACK`, `LOCATE`, `LAYER`). No DOM or React imports |
| `lib/gesture.ts`, `lib/frame.ts`, `motion/` | Verbatim from Stamps2: pointer gesture engine (slop, axis lock, velocity projection), frame-space maths, spring helpers, `Hero` FLIP between static rects, `Overlay` with `onTapEmpty`. `lib/image.ts`: `preloadImage` (decode before a URL swap) |
| `components/` | `Print` (the one place that knows how a print looks: border, RAW badge, date stamp, reject tape), `IconBar`, `Scroller` (native scroll + arithmetic windowing), `Flight`, `StackPrint` (tap opens, long-press locates), `TextButton`, `TextField` (the only case-keeping, selectable element), `Rows` (`Row`, `Label`, `Section`, `TwoLineRow`), `Pickable`, `Caption` |
| `screens/` | `CalendarScreen`, `PlacesScreen`, `DeckScreen`, `RejectsScreen`, `ShredderScreen`, `SettingsScreen`, `LocateScreen`, each with a subfolder of per-item components where it has any |

### Screen flow

`main` (calendar or places mode) → tap a stack → `deck` (hero from the cell) → swipe; rejects fly to the edge pile → `rejects` (review, rescue) → `shredder` → files trashed only after the last feed animation completes → undo window 20 s. In the deck a tap on the top card turns it clockwise (an inner layer in `Card`, separate from the card's pose/tilt `rotate`). Long-press a stack in either list → `locate` (your GPS places first, then offline city search) → pick → back at once while the store writes. Top icon bar switches calendar / places / rejects / settings; tapping empty space at the bottom goes back. Screens are stacked, not swapped (`history` in the store), so heroes can return.

## Rules that keep this codebase coherent

- Pointer events only, no `:hover`. Flexbox or absolute rects only, no CSS grid. Animate transform and opacity only. framer-motion is the only animation dependency.
- Every rect comes from `tokens.ts` arithmetic; never measure the DOM for layout or hero origins.
- Never call `useMotionValue`/`useTransform` inside loops; dynamic lists use per-item child components.
- All UI text is lowercase via `.phone`; only `TextField` (place names, city search) opts out.
- `domain/` stays pure and gets a vitest test for every new function. Rust modules get `cargo test` for pure logic (`pair`, `walk`, `classify`, `meta`, cache keys).
- Nothing moves or removes a file before the shredder's last feed completes; `trash_photos` is the only destructive call, and `restore_trashed` must be able to undo it from the returned `TrashedFile` list.
- `rotate_photo` and `locate_photos` are the only calls that change a file's contents, and only its metadata: JPEG primaries only (never a RAW), append-only EXIF edits (never re-encoded pixels), never a camera's own GPS, atomic (in-place patch or temp + rename), mtime kept for mtime-dated photos. Rotation and manual location live in the files, not in `stacks/v1`.
- Keep the Rust wire format identical to `api/types.ts`; if Rust must change, change the TS type in the same commit.

## Fixtures

`tools/make-fixtures` is a standalone crate (own workspace, own target). `npm run fixtures` writes `fixtures/` deterministically: 12 sessions over 6 days (28 Oct – 5 Nov 2024), a 2 h 50 m gap that must join and a 3 h 10 m gap that must split, Lisbon and Porto GPS clusters, JPG+RAF/ARW/CR3 twins (RAW = byte copy of the JPEG), one RAW-only file, three orientation-6 files, three files with no EXIF (mtime fallback), and decoys under `DCIM/.hidden/` and a `.photoslibrary` whose EXIF date is 27 Oct, so a pruning bug shows up as a stray stack. `MANIFEST.txt` lists expectations.

## Verification status

Verified: `npm run build`, `npm test`, `cargo test` (both crates) all green; the thumbnail cache received files from a live run, so the custom `thumb:` scheme is exercised end to end.

Not verified live (check by using the app with the fixture card): aspect lock versus the zoom button, decision persistence across relaunch, place renaming, the write-protected card path (`chmod -w fixtures/DCIM/100FUJI` then shred), shred/not-yet button contrast over the dark cavity (`TextButton` tone `paper` exists as the fallback), deck hero exit when the top card's aspect differs from the first (a turned first card makes this common), keyboard focus in WKWebView for the arrow keys, "add folder" through the dialog plugin, the turn animation handing over to the re-laid-out card without a flash (tap once, tap twice fast, tap the RAW-only Canon), long-press → locate → the stack moving to its new place, and the progress/summary notices. Live-testing rotate/locate edits the files in `fixtures/`; run `npm run fixtures` again afterwards. A throwaway pass over all 111 fixture JPEGs rotated and re-read every one (108 patched in place, 3 no-EXIF files given a new APP1) and located them (20 filled, 91 kept camera GPS).

Known risks: which embedded preview ImageIO picks for RAW-only files from real cameras (pairs are unaffected); the city table is parsed on a warm-up thread at launch (~1 s), so a very early search or label call waits for it; the same photo on a card and in an imported folder appears twice (no hash de-duplication). Metadata writes: HEIC (the iPhone default) is refused; an APP1 already near 64 KB cannot take GPS; a JPG and its RAW twin will disagree on orientation and GPS; FAT32 stores mtime to 2 s and the times policy is unverified on a real card; copying Finder tags across the temp-file rename is best effort on exFAT; thumbnail eviction can race a thumbnail being generated at that moment; city ranking has no population data (the `near` hint and a big-city proxy stand in); while a turn is pending the card's paper border is scaled with it (~3 px) and snaps back when the write lands.

## Docs

README.md is the landing page; depth lives in `docs/GUIDE.md`. Reference detail goes to the
guide, not the README.

## Plan and history

The approved design lives at `~/.claude/plans/i-want-to-create-quirky-bonbon.md` (module map, rects, choreography, verification checklist). `SETUP-NOTES.md` records installed versions and every deviation made during scaffolding.
