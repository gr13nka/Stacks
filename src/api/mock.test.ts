import { describe, expect, it } from 'vitest';
import { MOCK_SCENARIO, mockApi } from './mock';
import { buildStacks } from '../domain/stacks';
import { clusterPlaces, SOMEWHERE_ID } from '../domain/places';
import { monthsOf } from '../domain/calendar';

const { photos } = MOCK_SCENARIO;

describe('mock scenario', () => {
  it('mirrors the fixture scenario: ~110 photos, 28 oct – 5 nov 2024, two months', () => {
    expect(photos.length).toBeGreaterThanOrEqual(110);
    expect(photos.length).toBeLessThanOrEqual(240);
    expect(new Set(photos.map((p) => p.id)).size).toBe(photos.length);
    const months = monthsOf(buildStacks(photos, 3));
    expect(months.map((m) => m.key)).toEqual(['2024-11', '2024-10']);
  });

  it('joins the 2 h 50 m gap and splits the 3 h 10 m one; 4 h merges the latter', () => {
    const at3 = buildStacks(photos, 3);
    const at4 = buildStacks(photos, 4);
    const days = (stacks: typeof at3, day: string) => stacks.filter((s) => s.day === day).length;
    expect(days(at3, '2024-10-29')).toBe(1);
    expect(days(at3, '2024-10-31')).toBe(2);
    expect(days(at4, '2024-10-31')).toBe(1);
    expect(at3).toHaveLength(10);
  });

  it('has raw twins, one raw-only file and mtime-fallback photos', () => {
    expect(photos.filter((p) => p.rawPath).length).toBeGreaterThan(50);
    expect(photos.filter((p) => p.aspect === null && p.path.endsWith('.CR3'))).toHaveLength(1);
    expect(photos.filter((p) => p.takenAtSource === 'mtime')).toHaveLength(3);
    expect(photos.filter((p) => p.orientation === 6)).toHaveLength(3);
  });

  it('clusters into lisbon, porto and somewhere, labelled by nearest centroid', async () => {
    const places = clusterPlaces(photos, buildStacks(photos, 3), 25);
    expect(places).toHaveLength(3);
    expect(places[2].id).toBe(SOMEWHERE_ID);
    const labels = await mockApi.labelPlaces(places.slice(0, 2).map((p) => [p.centroid!.lat, p.centroid!.lon]));
    expect(labels.map((l) => l?.name).sort()).toEqual(['Lisbon', 'Porto']);
    expect((await mockApi.labelPlaces([[0, 0]]))[0]).toBeNull();
  });

  it('trashes and restores in memory', async () => {
    const victim = photos.find((p) => p.rawPath)!;
    const report = await mockApi.trashPhotos([victim.id], true);
    expect(report.trashed.map((t) => t.from)).toEqual([victim.path, victim.rawPath]);
    const seen: string[] = [];
    await mockApi.scanCatalog([{ volumeId: 'card', root: '/Volumes/CARD01', kind: 'card' }], (e) => {
      if (e.type === 'batch') seen.push(...e.photos.map((p) => p.id));
    });
    expect(seen).not.toContain(victim.id);
    const restore = await mockApi.restoreTrashed(report.trashed);
    expect(restore.restored).toHaveLength(2);
    expect(restore.failed).toHaveLength(0);
  });
});
