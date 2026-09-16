// orientation.ts — the EXIF Orientation algebra for turning a photo. Every
// value is a mirror flag plus k clockwise quarter turns (display =
// rotate(k·90°) ∘ mirror), so turning by q just advances k. The Rust writer
// (exif_edit::compose_cw) owns this for real files; the mock api uses this
// copy, and both are tested against the same table.

/** k = 0..3 clockwise quarter turns for the unmirrored and mirrored orientations. */
const PLAIN = [1, 6, 3, 8] as const;
const MIRRORED = [2, 7, 4, 5] as const;

/** The EXIF Orientation after turning `orientation` by `quarterTurns` clockwise (negative = counter-clockwise). */
export function rotateOrientation(orientation: number, quarterTurns: number): number {
  const plain = PLAIN.indexOf(orientation as (typeof PLAIN)[number]);
  const mirrored = MIRRORED.indexOf(orientation as (typeof MIRRORED)[number]);
  const cycle = mirrored >= 0 ? MIRRORED : PLAIN;
  const k = mirrored >= 0 ? mirrored : Math.max(0, plain); // out-of-range values read as 1, like the thumbnailer
  return cycle[(((k + quarterTurns) % 4) + 4) % 4];
}
