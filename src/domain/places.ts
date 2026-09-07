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

export function clusterPlaces(photos: readonly Photo[], stacks: readonly Stack[], radiusKm: number): Place[] {
  const byId = new Map(photos.map((p) => [p.id, p] as const));
  const clusters: Cluster[] = [];
  const somewhere: Cluster = { centroid: { lat: 0, lon: 0 }, weight: 0, stackIds: [], photoIds: [], newestMs: -Infinity };

  const ordered = stacks.slice().sort((a, b) => b.startMs - a.startMs);
  for (const stack of ordered) {
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
    const target = n === 0 ? somewhere : findOrCreate(clusters, { lat: lat / n, lon: lon / n }, radiusKm);
    if (n > 0) {
      const w = target.weight + n;
      target.centroid = {
        lat: (target.centroid.lat * target.weight + lat) / w,
        lon: (target.centroid.lon * target.weight + lon) / w,
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
