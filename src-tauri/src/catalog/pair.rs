// pair.rs — fold JPG+RAW twins into one photo. Pure over paths.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::walk::{extension, is_primary};

/// One photo as the user sees it: the file to display plus its RAW twin, if any.
/// A RAW without a twin is its own primary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pair {
    pub primary: PathBuf,
    pub raw: Option<PathBuf>,
}

/// Twins share a directory and a case-insensitive stem (`DSCF0001.JPG` +
/// `dscf0001.raf`). When several primaries share a stem (JPG + HEIC) each
/// stays a separate photo and the RAW attaches to the preferred one only, so
/// trashing never touches the same RAW twice.
pub fn pair(paths: Vec<PathBuf>) -> Vec<Pair> {
    let mut groups: BTreeMap<(PathBuf, String), Vec<PathBuf>> = BTreeMap::new();
    for path in paths {
        let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        groups.entry((parent, stem)).or_default().push(path);
    }

    let mut pairs = Vec::new();
    for (_, mut files) in groups {
        files.sort_by_key(|p| (rank(p), p.clone()));
        let (mut primaries, mut raws): (Vec<_>, Vec<_>) =
            files.into_iter().partition(|p| is_primary(p));
        if primaries.is_empty() {
            pairs.extend(raws.into_iter().map(|raw| Pair { primary: raw, raw: None }));
            continue;
        }
        let first = primaries.remove(0);
        let raw = if raws.is_empty() { None } else { Some(raws.remove(0)) };
        pairs.push(Pair { primary: first, raw });
        pairs.extend(primaries.into_iter().map(|p| Pair { primary: p, raw: None }));
        pairs.extend(raws.into_iter().map(|raw| Pair { primary: raw, raw: None }));
    }
    pairs.sort_by(|a, b| a.primary.cmp(&b.primary));
    pairs
}

/// Which file represents a stem when several could: the camera JPEG first,
/// then HEIC, TIFF, PNG; RAW formats after all of them.
fn rank(path: &Path) -> u8 {
    match extension(path).as_deref() {
        Some("jpg" | "jpeg") => 0,
        Some("heic" | "heif") => 1,
        Some("tif" | "tiff") => 2,
        Some("png") => 3,
        _ => 9,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn jpg_and_raf_become_one_pair() {
        let got = pair(vec![p("/c/DCIM/DSCF0001.RAF"), p("/c/DCIM/DSCF0001.JPG")]);
        assert_eq!(
            got,
            vec![Pair { primary: p("/c/DCIM/DSCF0001.JPG"), raw: Some(p("/c/DCIM/DSCF0001.RAF")) }]
        );
    }

    #[test]
    fn stems_match_case_insensitively_but_not_across_dirs() {
        let got = pair(vec![
            p("/c/a/dsc00001.jpg"),
            p("/c/a/DSC00001.ARW"),
            p("/c/b/DSC00001.ARW"),
        ]);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], Pair { primary: p("/c/a/dsc00001.jpg"), raw: Some(p("/c/a/DSC00001.ARW")) });
        assert_eq!(got[1], Pair { primary: p("/c/b/DSC00001.ARW"), raw: None });
    }

    #[test]
    fn raw_alone_is_its_own_primary() {
        let got = pair(vec![p("/c/IMG_0007.CR3")]);
        assert_eq!(got, vec![Pair { primary: p("/c/IMG_0007.CR3"), raw: None }]);
    }

    #[test]
    fn jpg_and_heic_stay_separate_and_raw_attaches_once() {
        let got = pair(vec![p("/c/IMG_1.HEIC"), p("/c/IMG_1.JPG"), p("/c/IMG_1.DNG")]);
        assert_eq!(
            got,
            vec![
                Pair { primary: p("/c/IMG_1.HEIC"), raw: None },
                Pair { primary: p("/c/IMG_1.JPG"), raw: Some(p("/c/IMG_1.DNG")) },
            ]
        );
    }

    #[test]
    fn two_raws_without_jpg_are_two_photos() {
        let got = pair(vec![p("/c/x.RAF"), p("/c/X.DNG")]);
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|q| q.raw.is_none()));
    }
}
