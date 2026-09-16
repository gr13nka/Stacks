# Stacks — the full guide

Everything the [README](../README.md) leaves out. Invariants for anyone changing the code are in [CLAUDE.md](../CLAUDE.md).

- [Running it](#running-it)
- [Fixtures](#fixtures)
- [What it writes to your files](#what-it-writes-to-your-files)
- [Stacks, places and the deck](#stacks-places-and-the-deck)
- [Tests](#tests)
- [Limits](#limits)
- [Project structure](#project-structure)
- [Credits](#credits)

## Running it

```bash
npm install
npm run app                     # real volumes and home folders
npm run app:fixtures            # the generated fixture card, mounted as a fake volume
VITE_STACKS_MOCK=1 npm run dev  # frontend only, in a browser at :1420, synthetic data, no Rust
npm run build                   # tsc --noEmit (strict) + vite build
```

macOS only. Tauri v2 with a Rust backend, React 18 and framer-motion in the webview.

Two instances must not run at once. They share `~/Library/Application Support/com.username.stacks/stacks.json`, which holds decisions and settings.

The toolchain notes for this machine — Homebrew Rust ahead of rustup, Node from Nix, the Safari version the webview follows — are in [SETUP-NOTES.md](../SETUP-NOTES.md) and under "Toolchain caveats" in [CLAUDE.md](../CLAUDE.md).

## Fixtures

```bash
npm run fixtures        # writes ./fixtures deterministically
npm run app:fixtures
```

`tools/make-fixtures` is a standalone crate. It writes 12 sessions over six days, 28 October to 5 November 2024, including a 2 h 50 m gap that must join into one stack and a 3 h 10 m gap that must split into two. There are Lisbon and Porto GPS clusters, JPG+RAF/ARW/CR3 twins, one RAW-only file, three orientation-6 files and three files with no EXIF at all. Decoys sit under `DCIM/.hidden/` and in a `.photoslibrary`, dated 27 October, so a pruning bug shows up as a stray stack. `fixtures/MANIFEST.txt` lists what each one is for.

Live-testing rotation or location edits the files under `fixtures/`. Run `npm run fixtures` again afterwards.

## What it writes to your files

Rejects go to the macOS Trash, through `NSFileManager.trashItemAtURL:`, and only after the last shredder animation completes. The undo window is 20 seconds; `restore_trashed` renames each file back from the `TrashedFile` list.

Two calls change a file's contents, and only its metadata:

- `rotate_photo` — sets EXIF Orientation.
- `locate_photos` — sets the GPS IFD, with `GPSProcessingMethod = "MANUAL"`.

Both are JPEG primaries only. A RAW, HEIC, PNG or TIFF is refused as `unsupported`, as is a read-only or Finder-locked file. Pixels are never re-encoded. The edit is append-only: Orientation and a re-pick are patched in place, otherwise IFD0 and the GPS IFD are appended and repointed, so the MakerNote and the embedded thumbnail stay valid. An APP1 segment already over 64 KB is refused. Writes are atomic — an in-place patch, or a temp file plus `copyfile` for xattrs and ACLs, then a rename. Creation date is always kept; mtime is kept only for photos that were dated by mtime in the first place.

A camera's own GPS is never overwritten. If the file already carries GPS that Stacks did not write, the result is `KeepCamera` and the file is left alone.

Rotation and manual location live in the files, not in the app's store.

## Stacks, places and the deck

A stack is a run of photos from one volume with no gap longer than the threshold. The calendar counts down — today at the top, older days below — and each day shows the stacks shot that day. Empty days stay empty.

Places are greedy centroid clusters over the photos' GPS, named by the nearest city from a vendored GeoNames table of 144k rows. Beyond 100 km the cluster is "somewhere". A long press on any stack opens the picker: your own GPS places first, then an offline city search. Nothing there touches the network.

In the deck, right keeps and left rejects; the arrow keys do the same. A JPG and its RAW twin are one card and one decision. Tapping the top card turns it 90° clockwise. Rejects fly to a pile at the edge; you can rescue any of them until you shred.

## Tests

```bash
npm test                                                     # vitest: pure domain logic and the mock api
npm run test:rust                                            # cargo test for src-tauri
cargo test --manifest-path tools/make-fixtures/Cargo.toml    # fixture generator round-trip
```

The Rust suite includes live ImageIO, trash and retag smoke tests. `src/domain/` is pure and DOM-free, and every function in it has a test.

## Limits

- HEIC, the iPhone default, cannot be rotated or located. It is refused as `unsupported`.
- A JPG and its RAW twin will disagree on orientation and GPS after an edit; only the JPG is written.
- The same photo on a card and in an imported folder appears twice. There is no hash de-duplication.
- The city table is parsed on a warm-up thread at launch, about a second. A search made before that finishes waits for it.
- City ranking has no population data; the search uses the stack's own position as a hint and a big-city proxy.
- FAT32 stores mtime to two seconds, and the times policy is unverified on a real card.
- Which embedded preview ImageIO picks for a RAW-only file from a real camera is not known for every camera. Pairs are unaffected, since the JPG is read.

The unverified-in-the-app list is kept current under "Verification status" in [CLAUDE.md](../CLAUDE.md).

## Project structure

```
src-tauri/src/     catalog/ (scan, pair, meta, cache), thumbs, volumes, trash,
                   exif_edit, retag, failure, geocode, state, window
src/api/           the wire types, the Tauri adapter, the mock adapter
src/domain/        pure: time, stacks, calendar, places, deck, orientation, rejects, shred
src/store/         external store, actions, selectors, debounced persistence
src/components/    Print, StackPrint, Scroller, IconBar, Rows, TextField, Flight
src/screens/       calendar, places, deck, rejects, shredder, settings, locate
tools/make-fixtures/   standalone crate, own workspace
```

The frontend never sees a file path except as opaque data inside a `Photo`. Rust classifies files, reads and writes EXIF, makes pixels and moves files; everything derived — stacks, months, places, the deck queue, progress — is pure TypeScript.

## Credits

The design and gesture language come from the sibling prototype Stamps2.

City names are from [GeoNames](https://www.geonames.org/), used under CC BY 4.0; the attribution is shown in the app's settings.
