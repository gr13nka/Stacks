// cache.rs — persisted EXIF results so a relaunch never re-reads a file that
// has not changed. Keyed by `path|size|mtime`: any edit or re-download changes
// size or mtime, so stale entries simply stop matching and age out unused.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::meta::PhotoMeta;

/// Inserts between automatic saves; bounds the work lost to a crash mid-scan.
const SAVE_EVERY: usize = 500;

pub struct MetaCache {
    file: PathBuf,
    map: HashMap<String, PhotoMeta>,
    unsaved: usize,
}

pub fn key(path: &Path, size: u64, mtime_ms: u64) -> String {
    format!("{}|{}|{}", path.display(), size, mtime_ms)
}

impl MetaCache {
    /// A missing or corrupt file yields an empty cache; the scan rebuilds it.
    pub fn load(file: PathBuf) -> Self {
        let map = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        MetaCache { file, map, unsaved: 0 }
    }

    pub fn get(&self, key: &str) -> Option<&PhotoMeta> {
        self.map.get(key)
    }

    pub fn insert(&mut self, key: String, meta: PhotoMeta) {
        self.map.insert(key, meta);
        self.unsaved += 1;
        if self.unsaved >= SAVE_EVERY {
            self.flush();
        }
    }

    /// Writes through a temp file so a crash mid-write cannot corrupt the cache.
    pub fn flush(&mut self) {
        if self.unsaved == 0 {
            return;
        }
        let Ok(json) = serde_json::to_vec(&self.map) else { return };
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = self.file.with_extension("json.tmp");
        if fs::write(&tmp, json).is_ok() && fs::rename(&tmp, &self.file).is_ok() {
            self.unsaved = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::meta::TakenAtSource;

    #[test]
    fn key_is_stable_and_sensitive_to_every_part() {
        let p = Path::new("/Volumes/CARD/DCIM/100FUJI/DSCF0001.JPG");
        assert_eq!(key(p, 4_194_304, 1_730_812_345_000), "/Volumes/CARD/DCIM/100FUJI/DSCF0001.JPG|4194304|1730812345000");
        assert_eq!(key(p, 1, 2), key(p, 1, 2));
        assert_ne!(key(p, 1, 2), key(p, 2, 2));
        assert_ne!(key(p, 1, 2), key(p, 1, 3));
        assert_ne!(key(p, 1, 2), key(Path::new("/other.jpg"), 1, 2));
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join("meta-cache-v1.json");
        let meta = PhotoMeta {
            taken_at: "2024-11-05T14:03:21".into(),
            taken_at_source: TakenAtSource::Exif,
            gps: None,
            orientation: 1,
            aspect: Some(1.5),
            camera: Some("FUJIFILM X-T5".into()),
        };
        let mut cache = MetaCache::load(file.clone());
        cache.insert("k".into(), meta.clone());
        cache.flush();

        let again = MetaCache::load(file);
        assert_eq!(again.get("k"), Some(&meta));
        assert_eq!(again.get("missing"), None);
    }
}
