// places.ts — groups stacks by where they were shot. Greedy centroid
// clustering: stacks are walked newest first and each joins the first
// cluster whose running centroid lies within `radiusKm` of the stack's own
// centroid, else founds a new one. Stacks with no GPS at all collect in a
// trailing "somewhere" place. Pure; memoised by the store.

import type { Photo, Place, Stack } from '../api/types';

export type LatLon = { lat: number; lon: number };

export const SOMEWHERE_ID = 'somewhere';

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Stable id for a GPS place: its centroid rounded to 0.01° (≈1 km), the key geocode results are cached under too. */
export function placeKey(c: LatLon): string {
  return `geo:${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
}

type Cluster = {
  centroid: LatLon;
  weight: number;       // number of GPS photos folded into the centroid
  stackIds: string[];
  photoIds: string[];
  newestMs: number;
};

/** Where a stack was shot: the mean of its GPS photos and how many there are; null when none has GPS. */
export function stackCentroid(stack: Stack, byId: ReadonlyMap<string, Photo>): { centroid: LatLon; n: number } | null {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const id of stack.photoIds) {
    const gps = byId.get(id)?.gps;
    if (!gps) continue;
    lat += gps.lat;
    lon += gps.lon;
    n += 1;
  }
  return n === 0 ? null : { centroid: { lat: lat / n, lon: lon / n }, n };
}

/**
 * The best guess of where a stack was: its own centroid, else that of the
 * stack closest to it in time that has GPS. Ranks same-named cities in the
 * location picker ("paris" near Lisbon is the French one).
 */
export function nearestFix(stack: Stack, stacks: readonly Stack[], byId: ReadonlyMap<string, Photo>): LatLon | null {
  const own = stackCentroid(stack, byId);
  if (own) return own.centroid;
  let best: LatLon | null = null;
  let bestGap = Infinity;
  for (const other of stacks) {
    const gap = Math.max(0, other.startMs - stack.endMs, stack.startMs - other.endMs);
    if (gap >= bestGap) continue;
    const fix = stackCentroid(other, byId);
    if (!fix) continue;
    best = fix.centroid;
    bestGap = gap;
  }
  return best;
}

export function clusterPlaces(photos: readonly Photo[], stacks: readonly Stack[], radiusKm: number): Place[] {
  const byId = new Map(photos.map((p) => [p.id, p] as const));
  const clusters: Cluster[] = [];
  const somewhere: Cluster = { centroid: { lat: 0, lon: 0 }, weight: 0, stackIds: [], photoIds: [], newestMs: -Infinity };

  const ordered = stacks.slice().sort((a, b) => b.startMs - a.startMs);
  for (const stack of ordered) {
    const fix = stackCentroid(stack, byId);
    const target = fix ? findOrCreate(clusters, fix.centroid, radiusKm) : somewhere;
    if (fix) {
      const w = target.weight + fix.n;
      target.centroid = {
        lat: (target.centroid.lat * target.weight + fix.centroid.lat * fix.n) / w,
        lon: (target.centroid.lon * target.weight + fix.centroid.lon * fix.n) / w,
      };
      target.weight = w;
    }
    target.stackIds.push(stack.id);
    target.photoIds.push(...stack.photoIds);
    target.newestMs = Math.max(target.newestMs, stack.startMs);
  }

  const places: Place[] = clusters
    .sort((a, b) => b.newestMs - a.newestMs)
    .map((c) => ({ id: placeKey(c.centroid), centroid: c.centroid, stackIds: c.stackIds, photoIds: c.photoIds, label: null }));
  if (somewhere.stackIds.length > 0) {
    places.push({ id: SOMEWHERE_ID, centroid: null, stackIds: somewhere.stackIds, photoIds: somewhere.photoIds, label: null });
  }
  return places;
}

function findOrCreate(clusters: Cluster[], c: LatLon, radiusKm: number): Cluster {
  for (const cluster of clusters) {
    if (haversineKm(cluster.centroid, c) <= radiusKm) return cluster;
  }
  const created: Cluster = { centroid: c, weight: 0, stackIds: [], photoIds: [], newestMs: -Infinity };
  clusters.push(created);
  return created;
}
