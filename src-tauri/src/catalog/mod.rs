// catalog — turn a list of sources into a stream of `Photo`s: walk, pair,
// read (or recall) metadata, index, and hand batches to the frontend as they
// complete so the calendar fills while a slow card is still being read.

pub mod cache;
pub mod meta;
pub mod pair;
pub mod walk;

use std::collections::HashMap;
use std::path::Path;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::state::{AppState, Entry};
use crate::volumes::{Source, VolumeKind};
use meta::{Gps, PhotoMeta, TakenAtSource};

/// Photos per `Batch` event: large enough to amortise IPC, small enough that
/// the first prints appear within a second on a card.
pub const BATCH: usize = 200;
/// EXIF readers in flight; a card reader saturates around here.
const EXIF_THREADS: usize = 4;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: String,
    pub path: String,
    pub raw_path: Option<String>,
    pub volume_id: String,
    pub taken_at: String,
    pub taken_at_source: TakenAtSource,
    pub gps: Option<Gps>,
    pub orientation: u32,
    pub aspect: Option<f64>,
    pub camera: Option<String>,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ScanEvent {
    Batch { volume_id: String, photos: Vec<Photo> },
    SourceDone { volume_id: String, count: usize },
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub total: usize,
    pub per_volume: HashMap<String, usize>,
}

/// Stable across launches and machines for the same path, short enough to be
/// a URL segment: the first 16 hex digits of sha256(path).
pub fn photo_id(path: &Path) -> String {
    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    hex::encode(&digest[..8])
}

/// Scans every source in order, replacing whatever the index held for that
/// volume, and emits `Batch` events followed by one `SourceDone` per source.
pub fn scan(sources: &[Source], state: &AppState, emit: &dyn Fn(ScanEvent)) -> ScanSummary {
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(EXIF_THREADS)
        .thread_name(|i| format!("exif-{i}"))
        .build()
        .expect("exif thread pool");
    let mut summary = ScanSummary::default();

    for source in sources {
        forget_volume(state, &source.volume_id);
        let restrict = matches!(source.kind, VolumeKind::Card | VolumeKind::Fixture);
        let root = walk::effective_root(Path::new(&source.root), restrict);
        let pairs = pair::pair(walk::candidates(&root).collect());

        let mut count = 0;
        for chunk in pairs.chunks(BATCH) {
            let built: Vec<(Photo, Entry)> = pool.install(|| {
                chunk.par_iter().filter_map(|p| build(p, source, state)).collect()
            });
            let mut photos = Vec::with_capacity(built.len());
            if let Ok(mut index) = state.index.write() {
                for (photo, entry) in built {
                    index.insert(photo.id.clone(), entry);
                    photos.push(photo);
                }
            }
            count += photos.len();
            emit(ScanEvent::Batch { volume_id: source.volume_id.clone(), photos });
        }

        emit(ScanEvent::SourceDone { volume_id: source.volume_id.clone(), count });
        summary.total += count;
        *summary.per_volume.entry(source.volume_id.clone()).or_default() += count;
    }

    if let Ok(mut cache) = state.meta_cache.lock() {
        cache.flush();
    }
    summary
}

/// A rescan is the truth for its volume: photos trashed or ejected since the
/// last scan must stop resolving.
fn forget_volume(state: &AppState, volume_id: &str) {
    if let Ok(mut index) = state.index.write() {
        index.retain(|_, e| e.volume_id != volume_id);
    }
}

fn build(pair: &pair::Pair, source: &Source, state: &AppState) -> Option<(Photo, Entry)> {
    let (size, mtime) = stat(&pair.primary)?;
    let key = cache::key(&pair.primary, size, mtime);
    let cached = state.meta_cache.lock().ok().and_then(|c| c.get(&key).cloned());
    let meta = match cached {
        Some(meta) => meta,
        None => {
            let meta = meta::read_meta(&pair.primary, mtime);
            if let Ok(mut c) = state.meta_cache.lock() {
                c.insert(key, meta.clone());
            }
            meta
        }
    };

    let photo = photo(&pair.primary, pair.raw.as_deref(), &source.volume_id, meta, size, mtime);
    let entry = Entry {
        path: pair.primary.clone(),
        raw: pair.raw.clone(),
        volume_id: source.volume_id.clone(),
        kind: source.kind,
        mtime,
    };
    Some((photo, entry))
}

/// Re-reads one photo whose file just changed under the catalog (a metadata
/// edit): EXIF is read fresh even when the cache key still matches, cached
/// under the file's current key, and the index entry takes the new mtime so
/// thumbnails key off the edited file. `None` when the id or file is gone.
pub fn refresh(state: &AppState, id: &str) -> Option<Photo> {
    let entry = state.entry(id)?;
    let (size, mtime) = stat(&entry.path)?;
    let meta = meta::read_meta(&entry.path, mtime);
    if let Ok(mut c) = state.meta_cache.lock() {
        c.insert(cache::key(&entry.path, size, mtime), meta.clone());
    }
    if let Ok(mut index) = state.index.write() {
        if let Some(e) = index.get_mut(id) {
            e.mtime = mtime;
        }
    }
    Some(photo(&entry.path, entry.raw.as_deref(), &entry.volume_id, meta, size, mtime))
}

/// Size in bytes and modification time in unix milliseconds.
fn stat(path: &Path) -> Option<(u64, u64)> {
    let md = std::fs::metadata(path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some((md.len(), mtime))
}

fn photo(primary: &Path, raw: Option<&Path>, volume_id: &str, meta: PhotoMeta, size: u64, mtime: u64) -> Photo {
    Photo {
        id: photo_id(primary),
        path: primary.to_string_lossy().into_owned(),
        raw_path: raw.map(|r| r.to_string_lossy().into_owned()),
        volume_id: volume_id.to_string(),
        taken_at: meta.taken_at,
        taken_at_source: meta.taken_at_source,
        gps: meta.gps,
        orientation: meta.orientation,
        aspect: meta.aspect,
        camera: meta.camera,
        size,
        mtime,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn photo_id_is_sixteen_hex_and_stable() {
        let a = photo_id(Path::new("/Volumes/CARD/DCIM/100FUJI/DSCF0001.JPG"));
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(a, photo_id(Path::new("/Volumes/CARD/DCIM/100FUJI/DSCF0001.JPG")));
        assert_ne!(a, photo_id(Path::new("/Volumes/CARD/DCIM/100FUJI/DSCF0002.JPG")));
    }

    #[test]
    fn scan_event_wire_format_matches_typescript() {
        let e = ScanEvent::SourceDone { volume_id: "fixture".into(), count: 3 };
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"type":"sourceDone","volumeId":"fixture","count":3}"#);
        let e = ScanEvent::Batch { volume_id: "v".into(), photos: vec![] };
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"type":"batch","volumeId":"v","photos":[]}"#);
    }
}
