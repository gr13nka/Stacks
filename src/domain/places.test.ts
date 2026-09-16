import { describe, expect, it } from 'vitest';
import { SOMEWHERE_ID, clusterPlaces, haversineKm, nearestFix, stackCentroid } from './places';
import { buildStacks } from './stacks';
import { photo } from './fixtures';

const LISBON = { lat: 38.7223, lon: -9.1393 };
const PORTO = { lat: 41.1579, lon: -8.6291 };

describe('clusterPlaces', () => {
  it('measures Lisbon–Porto at roughly 274 km', () => {
    expect(haversineKm(LISBON, PORTO)).toBeGreaterThan(270);
    expect(haversineKm(LISBON, PORTO)).toBeLessThan(280);
  });

  it('forms two clusters at 25 km and a trailing somewhere place', () => {
    const photos = [
      photo('l1', '2024-10-28T09:00:00', { gps: LISBON }),
      photo('l2', '2024-10-28T09:01:00', { gps: { lat: LISBON.lat + 0.02, lon: LISBON.lon - 0.02 } }),
      photo('l3', '2024-11-03T12:00:00', { gps: { lat: LISBON.lat - 0.05, lon: LISBON.lon + 0.01 } }),
      photo('p1', '2024-10-31T10:00:00', { gps: PORTO }),
      photo('p2', '2024-10-31T10:01:00', { gps: { lat: PORTO.lat + 0.01, lon: PORTO.lon } }),
      photo('n1', '2024-11-05T08:30:00', { volumeId: 'local' }),
      photo('n2', '2024-11-05T18:00:00', { volumeId: 'local' }),
    ];
    const places = clusterPlaces(photos, buildStacks(photos, 3), 25);
    expect(places).toHaveLength(3);
    // most recent GPS stack first (Lisbon, 3 Nov), then Porto, then somewhere last
    expect(places[0].stackIds).toEqual(['card:l3', 'card:l1']);
    expect(places[0].photoIds).toEqual(['l3', 'l1', 'l2']);
    expect(places[0].id.startsWith('geo:38.')).toBe(true);
    expect(places[1].stackIds).toEqual(['card:p1']);
    expect(places[2].id).toBe(SOMEWHERE_ID);
    expect(places[2].centroid).toBeNull();
    expect(places[2].stackIds).toEqual(['local:n2', 'local:n1']);
  });

  it('a stack with mixed GPS and no-GPS photos goes by its GPS photos', () => {
    const photos = [
      photo('a', '2024-10-28T09:00:00', { gps: LISBON }),
      photo('b', '2024-10-28T09:01:00'),
    ];
    const places = clusterPlaces(photos, buildStacks(photos, 3), 25);
    expect(places).toHaveLength(1);
    expect(places[0].centroid).toEqual(LISBON);
    expect(places[0].photoIds).toEqual(['a', 'b']);
  });

  it('a large radius merges everything into one place', () => {
    const photos = [photo('l', '2024-10-28T09:00:00', { gps: LISBON }), photo('p', '2024-10-31T10:00:00', { gps: PORTO })];
    expect(clusterPlaces(photos, buildStacks(photos, 3), 300)).toHaveLength(1);
  });
});

describe('stackCentroid', () => {
  it('averages the GPS photos and counts them, skipping the rest', () => {
    const photos = [
      photo('a', '2024-10-28T09:00:00', { gps: { lat: 38, lon: -9 } }),
      photo('b', '2024-10-28T09:01:00', { gps: { lat: 40, lon: -8 } }),
      photo('c', '2024-10-28T09:02:00'),
    ];
    const [stack] = buildStacks(photos, 3);
    const fix = stackCentroid(stack, new Map(photos.map((p) => [p.id, p])));
    expect(fix?.n).toBe(2);
    expect(fix?.centroid.lat).toBeCloseTo(39);
    expect(fix?.centroid.lon).toBeCloseTo(-8.5);
  });

  it('is null for a stack with no GPS at all', () => {
    const photos = [photo('a', '2024-10-28T09:00:00')];
    expect(stackCentroid(buildStacks(photos, 3)[0], new Map(photos.map((p) => [p.id, p])))).toBeNull();
  });
});

describe('nearestFix', () => {
  const photos = [
    photo('l', '2024-10-28T09:00:00', { gps: LISBON }),
    photo('p', '2024-10-31T10:00:00', { gps: PORTO }),
    photo('n', '2024-10-31T20:00:00'), // 10 h after Porto, days after Lisbon
    photo('m', '2024-10-31T10:30:00', { volumeId: 'local', gps: LISBON }),
  ];
  const byId = new Map(photos.map((p) => [p.id, p]));
  const stacks = buildStacks(photos, 3);
  const stackOf = (id: string) => stacks.find((s) => s.photoIds.includes(id))!;

  it('is the stack’s own centroid when it has GPS', () => {
    expect(nearestFix(stackOf('p'), stacks, byId)).toEqual(PORTO);
  });

  it('borrows the GPS of the stack closest in time', () => {
    expect(nearestFix(stackOf('n'), stacks, byId)).toEqual(LISBON); // 'm' ended 9.5 h before, Porto 10 h
  });

  it('is null when nothing has GPS', () => {
    const bare = [photo('x', '2024-10-28T09:00:00')];
    const s = buildStacks(bare, 3);
    expect(nearestFix(s[0], s, new Map(bare.map((p) => [p.id, p])))).toBeNull();
  });
});
