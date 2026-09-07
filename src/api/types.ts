// types.ts — the data model shared with the Rust backend.
//
// Every type here mirrors a serde struct or enum in src-tauri/src, serialised
// with `rename_all = "camelCase"` (struct-variant fields need
// `rename_all_fields = "camelCase"` too, e.g. ScanEvent.volumeId). Change both
// sides together. Paths are opaque to the frontend: it never parses them.

export type VolumeKind = 'card' | 'external' | 'folder' | 'fixture';

export type Volume = {
  id: string;
  name: string;
  path: string;
  kind: VolumeKind;
  readOnly: boolean;
  hasDcim: boolean;
};

export type Source = { volumeId: string; root: string; kind: VolumeKind };

export type Photo = {
  id: string;              // first 16 hex of sha256(path)
  path: string;            // primary file, or the RAW when raw-only
  rawPath: string | null;
  volumeId: string;
  takenAt: string;         // 'YYYY-MM-DDTHH:MM:SS' wall clock (EXIF carries no zone)
  takenAtSource: 'exif' | 'mtime';
  gps: { lat: number; lon: number } | null;
  orientation: number;     // EXIF value; thumbs are already transformed
  aspect: number | null;   // w / h; null for RAW-only → assume 1.5, corrected on img load
  camera: string | null;
  size: number;
  mtime: number;           // unix ms
};

export type Stack = {
  id: string;              // `${volumeId}:${firstPhotoId}`
  volumeId: string;
  photoIds: string[];
  startMs: number;
  endMs: number;
  day: string;             // 'YYYY-MM-DD' of the first photo
};

export type Month = {
  key: string;             // 'YYYY-MM'
  year: number;
  month: number;           // 1..12
  days: number;            // days in the month
  byDay: Record<number, string[]>; // day-of-month → stack ids
};

export type PlaceLabel = { name: string; admin1: string; country: string; distanceKm: number };

export type Place = {
  id: string;
  centroid: { lat: number; lon: number };
  stackIds: string[];
  photoIds: string[];
  label: PlaceLabel | null;
};

export type Decision = 'keep' | 'remove';
export type DecisionMap = Record<string /* photo.path */, { d: Decision; at: number }>;

export type Settings = {
  gapHours: number;         // default 3
  removeRawWithJpg: boolean; // default true
  folders: string[];
  placeRadiusKm: number;    // default 25
};

export type TrashedFile = { id: string; from: string; to: string | null };

export type TrashFailure = {
  id: string;
  path: string;
  reason: 'read-only' | 'missing' | 'other';
  message: string;
};

export type TrashReport = { trashed: TrashedFile[]; failed: TrashFailure[] };

export type RestoreReport = { restored: string[]; failed: { path: string; message: string }[] };

export type ScanEvent =
  | { type: 'batch'; volumeId: string; photos: Photo[] }
  | { type: 'sourceDone'; volumeId: string; count: number };

export type ScanSummary = { total: number; perVolume: Record<string, number> };

export type Environment = { version: string; fixtures: boolean; userAgent: string };

// Frame-coordinate geometry; defined next to the other layout constants.
export type { Rect, RectRot } from '../tokens';
