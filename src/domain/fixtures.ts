// fixtures.ts — tiny photo factory shared by the domain tests.
import type { Photo } from '../api/types';

export function photo(id: string, takenAt: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    path: `/vol/${id}.JPG`,
    rawPath: null,
    volumeId: 'card',
    takenAt,
    takenAtSource: 'exif',
    gps: null,
    orientation: 1,
    aspect: 1.5,
    camera: null,
    size: 1000,
    mtime: 0,
    ...extra,
  };
}
