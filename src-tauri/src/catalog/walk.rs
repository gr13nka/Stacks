// walk.rs — which files under a root are photo candidates. Pure: no EXIF, no
// state; pairing and metadata happen later.

use std::path::{Path, PathBuf};

use walkdir::{DirEntry, WalkDir};

/// Formats that stand on their own as the displayed image.
pub const PRIMARY_EXT: &[&str] = &["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff"];
/// Camera RAW formats; paired with a primary when the stem matches.
pub const RAW_EXT: &[&str] = &["raf", "arw", "cr2", "cr3", "nef", "dng", "orf", "pef", "rw2"];

/// Deep enough for any camera or user tree; keeps a mistaken root (`/`)
/// from becoming a full-disk walk.
const MAX_DEPTH: usize = 12;
/// macOS bundles that look like folders but hold nothing a user wants to cull.
const PRUNED_BUNDLE_SUFFIXES: &[&str] = &[".photoslibrary", ".app"];

pub fn extension(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase())
}

pub fn is_primary(path: &Path) -> bool {
    extension(path).is_some_and(|e| PRIMARY_EXT.contains(&e.as_str()))
}

pub fn is_raw(path: &Path) -> bool {
    extension(path).is_some_and(|e| RAW_EXT.contains(&e.as_str()))
}

/// Cards keep everything of interest under `DCIM/`; walking the rest only
/// finds Fuji's `.THM`/config folders and slows the card down.
pub fn effective_root(root: &Path, restrict_to_dcim: bool) -> PathBuf {
    let dcim = root.join("DCIM");
    if restrict_to_dcim && dcim.is_dir() {
        dcim
    } else {
        root.to_path_buf()
    }
}

/// Every candidate photo file under `root`, hidden entries and bundles pruned,
/// symlinks never followed (the `/Volumes/Macintosh HD -> /` link loops).
pub fn candidates(root: &Path) -> impl Iterator<Item = PathBuf> {
    WalkDir::new(root)
        .follow_links(false)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(keep)
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(DirEntry::into_path)
        .filter(|p| is_primary(p) || is_raw(p))
}

/// The root itself is always kept: a user may deliberately pick a hidden folder.
fn keep(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    if name.starts_with('.') {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    !PRUNED_BUNDLE_SUFFIXES.iter().any(|s| lower.ends_with(s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::fs;

    fn touch(root: &Path, rel: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, b"x").unwrap();
    }

    fn names(root: &Path) -> BTreeSet<String> {
        candidates(root)
            .map(|p| p.strip_prefix(root).unwrap().to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn prunes_hidden_entries_and_bundles() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(root, "DCIM/100FUJI/DSCF0001.JPG");
        touch(root, "DCIM/100FUJI/DSCF0001.RAF");
        touch(root, "DCIM/.hidden/junk.jpg");
        touch(root, "DCIM/100FUJI/._DSCF0002.JPG");
        touch(root, ".Trashes/501/gone.jpg");
        touch(root, ".Spotlight-V100/x.jpg");
        touch(root, ".fseventsd/x.jpg");
        touch(root, "Photos Library.photoslibrary/originals/x.jpg");
        touch(root, "Some.APP/Contents/x.jpg");
        touch(root, "loose.heic");
        touch(root, "clip.mov");
        touch(root, "notes.txt");

        let got = names(root);
        let want: BTreeSet<String> = [
            "DCIM/100FUJI/DSCF0001.JPG",
            "DCIM/100FUJI/DSCF0001.RAF",
            "loose.heic",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(got, want);
    }

    #[test]
    fn dcim_restriction_applies_only_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(root, "DCIM/100FUJI/DSCF0001.JPG");
        touch(root, "outside.jpg");

        assert_eq!(effective_root(root, true), root.join("DCIM"));
        assert_eq!(effective_root(root, false), root);
        let restricted = names(&effective_root(root, true));
        assert_eq!(restricted.len(), 1);
        assert!(restricted.contains("100FUJI/DSCF0001.JPG"));

        let no_dcim = tempfile::tempdir().unwrap();
        touch(no_dcim.path(), "a.jpg");
        assert_eq!(effective_root(no_dcim.path(), true), no_dcim.path());
    }

    #[test]
    fn hidden_root_is_still_walked() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join(".secret");
        touch(&root, "a.jpg");
        assert_eq!(names(&root).len(), 1);
    }
}
