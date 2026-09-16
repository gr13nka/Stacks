// state.rs — the one piece of shared memory: the id → files index that the
// catalog fills and that thumbs, trash and retag read, plus the two on-disk
// caches and the lock that serialises metadata edits.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

use crate::catalog::cache::MetaCache;
use crate::thumbs::Thumbnailer;
use crate::volumes::VolumeKind;

/// Everything a later command needs to know about a photo id without
/// re-scanning: where its files are and which kind of volume holds them.
#[derive(Clone, Debug)]
pub struct Entry {
    pub path: PathBuf,
    pub raw: Option<PathBuf>,
    pub volume_id: String,
    pub kind: VolumeKind,
    /// Modification time in unix milliseconds; part of the thumbnail cache key.
    pub mtime: u64,
}

pub struct AppState {
    pub index: RwLock<HashMap<String, Entry>>,
    pub meta_cache: Mutex<MetaCache>,
    pub thumbs: Thumbnailer,
    /// Held for the whole read-modify-write of one file edit. Commands run on
    /// parallel blocking threads, so two quick taps would otherwise both read
    /// the old orientation and one rotation would be lost.
    pub edits: Mutex<()>,
}

impl AppState {
    /// `data_dir` keeps the EXIF cache (small, precious); `cache_dir` keeps
    /// thumbnails (large, disposable).
    pub fn new(data_dir: PathBuf, cache_dir: PathBuf) -> Self {
        AppState {
            index: RwLock::new(HashMap::new()),
            meta_cache: Mutex::new(MetaCache::load(data_dir.join("meta-cache-v1.json"))),
            thumbs: Thumbnailer::new(cache_dir.join("thumbs")),
            edits: Mutex::new(()),
        }
    }

    pub fn entry(&self, id: &str) -> Option<Entry> {
        self.index.read().ok()?.get(id).cloned()
    }
}
