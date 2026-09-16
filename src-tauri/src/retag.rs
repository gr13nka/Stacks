// retag.rs — writes a new orientation or a manual location into photo files.
// Besides trash.rs this is the only code that changes a user's files, and it
// changes metadata only: JPEG primaries only (a RAW twin is never touched), a
// camera's own GPS is never replaced, and pixels are never re-encoded.
//
// Each file is either patched in place (a few bytes: the usual rotation) or
// rewritten through a hidden temp file in the same folder and renamed over
// the original, carrying its xattrs and ACL across. Dates: the creation date
// is always kept; the modification date is kept only for photos dated by it
// (no EXIF date), whose place on the calendar would otherwise move. Then the
// thumbnails and EXIF cache entry of the old file are replaced and the photo
// is re-read, so the frontend gets exactly what a rescan would report.

use std::ffi::CString;
use std::fs::{self, FileTimes, Metadata, OpenOptions};
use std::io::{self, Write};
use std::os::macos::fs::{FileTimesExt, MetadataExt};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::FileExt;
use std::path::Path;
use std::time::SystemTime;

use serde::Serialize;

use crate::catalog::{self, cache, meta, walk::is_raw, Photo};
use crate::exif_edit::{self, Edit, EditError, GpsEdit, Patch};
use crate::failure::{io_reason, precheck, FailReason, FileFailure};
use crate::state::AppState;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RetagReport {
    /// Every photo that was edited (or needed no edit), re-read from disk.
    pub updated: Vec<Photo>,
    /// Ids whose file already had a camera position, left as it was.
    pub kept: Vec<String>,
    pub failed: Vec<FileFailure>,
}

/// Turns one photo `quarter_turns` × 90° clockwise (negative: counter-clockwise).
pub fn rotate(state: &AppState, id: &str, quarter_turns: i32) -> RetagReport {
    let mut report = RetagReport::default();
    let outcome = retag(state, id, |bytes| exif_edit::rotate(bytes, quarter_turns).map(|(edit, _)| Some(edit)));
    report.record(id, outcome);
    flush_cache(state);
    report
}

/// Gives every photo without a position of its own the manual fix `lat`/`lon`.
pub fn locate(state: &AppState, ids: &[String], lat: f64, lon: f64) -> RetagReport {
    let mut report = RetagReport::default();
    // Readers take 0°/0° for "no fix", so it could never be read back.
    let valid = lat.abs() <= 90.0 && lon.abs() <= 180.0 && !(lat == 0.0 && lon == 0.0);
    for id in ids {
        let outcome = if valid {
            retag(state, id, |bytes| {
                Ok(match exif_edit::set_gps(bytes, lat, lon)? {
                    GpsEdit::Write(edit) => Some(edit),
                    GpsEdit::KeepCamera => None,
                })
            })
        } else {
            Err(failure(id, Path::new(""), FailReason::Other, "not a valid location"))
        };
        report.record(id, outcome);
    }
    flush_cache(state);
    report
}

enum Outcome {
    Updated(Photo),
    Kept,
}

impl RetagReport {
    fn record(&mut self, id: &str, outcome: Result<Outcome, FileFailure>) {
        match outcome {
            Ok(Outcome::Updated(photo)) => self.updated.push(photo),
            Ok(Outcome::Kept) => self.kept.push(id.to_string()),
            Err(f) => self.failed.push(f),
        }
    }
}

/// One file: checks, plans the edit from its bytes (`None` = leave it), writes
/// it, and re-reads the photo. Holds the edit lock throughout.
fn retag(state: &AppState, id: &str, plan: impl FnOnce(&[u8]) -> Result<Option<Edit>, EditError>) -> Result<Outcome, FileFailure> {
    let _one_edit_at_a_time = state.edits.lock().unwrap_or_else(|e| e.into_inner());
    let entry = state.entry(id).ok_or_else(|| failure(id, Path::new(""), FailReason::Missing, "photo is not in the catalog"))?;
    let path = entry.path.as_path();
    let fail = |reason, message: &str| failure(id, path, reason, message);
    let io_fail = |e: io::Error| failure(id, path, io_reason(&e), &e.to_string());

    if is_raw(path) {
        return Err(fail(FailReason::Unsupported, "raw files are never changed"));
    }
    precheck(path).map_err(|(reason, message)| fail(reason, &message))?;
    let before = fs::symlink_metadata(path).map_err(io_fail)?;
    if !before.file_type().is_file() {
        return Err(fail(FailReason::Other, "not a regular file"));
    }
    // A rename would slip past both: the permission bits and Finder's lock.
    let locked = before.st_flags() & (libc::UF_IMMUTABLE | libc::SF_IMMUTABLE) != 0;
    if before.permissions().readonly() || locked {
        return Err(fail(FailReason::ReadOnly, "the file is locked"));
    }

    let bytes = fs::read(path).map_err(io_fail)?;
    let edit = match plan(&bytes) {
        Ok(Some(edit)) => edit,
        Ok(None) => return Ok(Outcome::Kept),
        Err(EditError::NotJpeg) => return Err(fail(FailReason::Unsupported, "only JPEG files can be changed")),
        Err(EditError::TooLarge) => return Err(fail(FailReason::Unsupported, "the EXIF block is full")),
        Err(EditError::MpfBeforeExif) => return Err(fail(FailReason::Unsupported, "unusual multi-picture layout")),
        Err(EditError::Malformed(why)) => return Err(fail(FailReason::Other, why)),
    };

    if !edit.is_empty() {
        let times = times_after_edit(state, path, &before);
        match &edit.splice {
            None => patch_in_place(path, &edit.patches, times),
            Some(_) => rewrite(path, &exif_edit::apply(&bytes, &edit), times),
        }
        .map_err(io_fail)?;
        state.thumbs.evict(path, entry.mtime);
    }
    catalog::refresh(state, id)
        .map(Outcome::Updated)
        .ok_or_else(|| fail(FailReason::Missing, "the file vanished after the edit"))
}

fn failure(id: &str, path: &Path, reason: FailReason, message: &str) -> FileFailure {
    FileFailure { id: id.to_string(), path: path.to_string_lossy().into_owned(), reason, message: message.to_string() }
}

/// Creation date always kept; modification date kept only when it is what
/// dates the photo, otherwise stamped now like any other edit (so backup
/// tools that compare size + mtime notice a 2-byte patch).
fn times_after_edit(state: &AppState, path: &Path, before: &Metadata) -> FileTimes {
    let mtime = before.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let mtime_ms = mtime.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let key = cache::key(path, before.len(), mtime_ms);
    let cached = state.meta_cache.lock().ok().and_then(|c| c.get(&key).map(|m| m.taken_at_source));
    let source = cached.unwrap_or_else(|| meta::read_meta(path, mtime_ms).taken_at_source);
    let modified = if source == meta::TakenAtSource::Mtime { mtime } else { SystemTime::now() };
    let times = FileTimes::new().set_modified(modified);
    match before.created() {
        Ok(created) => times.set_created(created),
        Err(_) => times,
    }
}

/// Writes nothing unless every patch still finds the bytes it expects.
fn patch_in_place(path: &Path, patches: &[Patch], times: FileTimes) -> io::Result<()> {
    let file = OpenOptions::new().read(true).write(true).open(path)?;
    for p in patches {
        let mut current = vec![0; p.old.len()];
        file.read_exact_at(&mut current, p.at as u64)?;
        if current != p.old {
            return Err(io::Error::other("the file changed while it was being edited"));
        }
    }
    for p in patches {
        file.write_all_at(&p.new, p.at as u64)?;
    }
    file.sync_all()?;
    file.set_times(times)
}

/// `.<name>.stacks.tmp` next to the original (dot-files are never scanned),
/// synced, given the original's xattrs, ACL and mode, then renamed over it.
fn rewrite(path: &Path, bytes: &[u8], times: FileTimes) -> io::Result<()> {
    let name = path.file_name().ok_or_else(|| io::Error::other("no file name"))?;
    let tmp = path.with_file_name(format!(".{}.stacks.tmp", name.to_string_lossy()));
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create(true).truncate(true).open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        copy_attributes(path, &tmp);
        // After copyfile, which also copies the original's timestamps.
        file.set_times(times)?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Finder tags, quarantine and other xattrs, the ACL and the mode. Best
/// effort: a volume without ACLs (exFAT) retries with xattrs alone, and a
/// failure there costs a tag, not the edit.
fn copy_attributes(from: &Path, to: &Path) {
    let (Ok(from), Ok(to)) = (CString::new(from.as_os_str().as_bytes()), CString::new(to.as_os_str().as_bytes())) else {
        return;
    };
    for flags in [libc::COPYFILE_XATTR | libc::COPYFILE_SECURITY, libc::COPYFILE_XATTR] {
        // SAFETY: two valid NUL-terminated paths and no copyfile state.
        if unsafe { libc::copyfile(from.as_ptr(), to.as_ptr(), std::ptr::null_mut(), flags) } == 0 {
            return;
        }
    }
}

fn flush_cache(state: &AppState) {
    if let Ok(mut cache) = state.meta_cache.lock() {
        cache.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Entry;
    use crate::testkit;
    use crate::volumes::VolumeKind;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::time::Duration;

    /// A fresh AppState over a temp dir with `files` indexed as photos.
    struct Fixture {
        dir: tempfile::TempDir,
        state: AppState,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let state = AppState::new(dir.path().join("data"), dir.path().join("cache"));
            Fixture { dir, state }
        }

        /// Writes `bytes` as `name`, backdates it, indexes it; returns its id.
        fn add(&self, name: &str, bytes: &[u8]) -> (String, PathBuf) {
            let path = self.dir.path().join(name);
            fs::write(&path, bytes).unwrap();
            let past = SystemTime::UNIX_EPOCH + Duration::from_millis(1_730_815_401_000);
            let file = OpenOptions::new().write(true).open(&path).unwrap();
            file.set_times(FileTimes::new().set_modified(past)).unwrap();
            let id = catalog::photo_id(&path);
            let entry = Entry { path: path.clone(), raw: None, volume_id: "t".into(), kind: VolumeKind::Folder, mtime: mtime_ms(&path) };
            self.state.index.write().unwrap().insert(id.clone(), entry);
            (id, path)
        }
    }

    fn mtime_ms(path: &Path) -> u64 {
        fs::metadata(path).unwrap().modified().unwrap().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as u64
    }

    fn created(path: &Path) -> SystemTime {
        fs::metadata(path).unwrap().created().unwrap()
    }

    #[test]
    fn rotation_in_place_restamps_an_exif_dated_file() {
        let fx = Fixture::new();
        let (id, path) = fx.add("DSCF0001.JPG", &testkit::jpeg(Some(&testkit::lisbon_exif(false))));
        let (size, old_mtime, born) = (fs::metadata(&path).unwrap().len(), mtime_ms(&path), created(&path));
        for s in crate::thumbs::SIZES {
            fs::write(fx.state.thumbs.cache_path(&path, s, old_mtime), b"stale").unwrap();
        }

        let report = rotate(&fx.state, &id, 1);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        let photo = &report.updated[0];
        assert_eq!(photo.orientation, 3);
        assert!((photo.aspect.unwrap() - 1.5).abs() < 1e-9, "orientation 3 keeps the 6×4 shape");
        assert_eq!(fs::metadata(&path).unwrap().len(), size, "patched in place");
        assert!(mtime_ms(&path) > old_mtime, "EXIF-dated: modification date is new");
        assert_eq!(created(&path), born);
        assert_eq!(photo.mtime, mtime_ms(&path));
        for s in crate::thumbs::SIZES {
            assert!(!fx.state.thumbs.cache_path(&path, s, old_mtime).exists(), "thumb {s} evicted");
        }
        let key = cache::key(&path, size, photo.mtime);
        assert_eq!(fx.state.meta_cache.lock().unwrap().get(&key).unwrap().orientation, 3);
        assert_eq!(fx.state.entry(&id).unwrap().mtime, photo.mtime);
    }

    #[test]
    fn a_file_dated_by_mtime_keeps_it_and_its_xattrs_through_a_rewrite() {
        let fx = Fixture::new();
        let (id, path) = fx.add("IMG_1004.JPG", &testkit::jpeg(None));
        let (old_mtime, born) = (mtime_ms(&path), created(&path));
        let c_path = CString::new(path.as_os_str().as_bytes()).unwrap();
        let name = CString::new("com.stacks.test").unwrap();
        // SAFETY: valid C strings and a 3-byte buffer.
        assert_eq!(unsafe { libc::setxattr(c_path.as_ptr(), name.as_ptr(), b"tag".as_ptr().cast(), 3, 0, 0) }, 0);
        let taken_before = meta::read_meta(&path, old_mtime).taken_at;

        let report = rotate(&fx.state, &id, 1);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        let photo = &report.updated[0];
        assert_eq!(photo.orientation, 6);
        assert_eq!(mtime_ms(&path), old_mtime, "mtime-dated: modification date kept");
        assert_eq!(created(&path), born);
        assert_eq!(photo.taken_at, taken_before, "still on the same day");
        let mut buf = [0u8; 8];
        // SAFETY: valid C strings and an 8-byte buffer.
        let n = unsafe { libc::getxattr(c_path.as_ptr(), name.as_ptr(), buf.as_mut_ptr().cast(), buf.len(), 0, 0) };
        assert_eq!(&buf[..n.max(0) as usize], b"tag");
        let leftovers: Vec<_> = fs::read_dir(fx.dir.path()).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".stacks.tmp")).collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn quick_turns_compose() {
        let fx = Fixture::new();
        let (id, _) = fx.add("DSCF0002.JPG", &testkit::jpeg(Some(&testkit::lisbon_exif(true))));
        std::thread::scope(|s| {
            for _ in 0..3 {
                s.spawn(|| rotate(&fx.state, &id, 1));
            }
        });
        assert_eq!(rotate(&fx.state, &id, 0).updated[0].orientation, compose(6, 3));
    }

    fn compose(o: u16, q: i32) -> u32 {
        exif_edit::compose_cw(o, q) as u32
    }

    #[test]
    fn refusals_are_classified() {
        let fx = Fixture::new();
        let (raw, _) = fx.add("DSCF0003.RAF", b"not really a raf");
        assert_eq!(rotate(&fx.state, &raw, 1).failed[0].reason, FailReason::Unsupported);

        let (heic, _) = fx.add("IMG_0001.JPG", b"\0\0\0\x18ftypheic\0\0\0\0");
        assert_eq!(rotate(&fx.state, &heic, 1).failed[0].reason, FailReason::Unsupported);

        let (locked, path) = fx.add("DSCF0004.JPG", &testkit::jpeg(Some(&testkit::lisbon_exif(false))));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert_eq!(rotate(&fx.state, &locked, 1).failed[0].reason, FailReason::ReadOnly);

        assert_eq!(rotate(&fx.state, "nope", 1).failed[0].reason, FailReason::Missing);
        assert_eq!(locate(&fx.state, &[locked], 0.0, 0.0).failed[0].reason, FailReason::Other);
    }

    #[test]
    fn locate_fills_keeps_camera_gps_and_replaces_its_own_pick() {
        let fx = Fixture::new();
        let plain = testkit::jpeg(Some(&testkit::exif_tiff(&testkit::camera_fields(true), false, None, None)));
        let (blank, blank_path) = fx.add("DSCF0005.JPG", &plain);
        let (camera, _) = fx.add("IMG_0002.JPG", &testkit::jpeg(Some(&testkit::lisbon_exif(false))));
        let ids = vec![blank.clone(), camera.clone()];

        let report = locate(&fx.state, &ids, 38.80097, -9.37826);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert_eq!(report.kept, vec![camera.clone()]);
        let gps = report.updated[0].gps.unwrap();
        assert!((gps.lat - 38.80097).abs() < 1e-6 && (gps.lon + 9.37826).abs() < 1e-6);

        let size = fs::metadata(&blank_path).unwrap().len();
        let again = locate(&fx.state, &ids, 41.14961, -8.61099);
        assert_eq!(again.kept, vec![camera]);
        assert!((again.updated[0].gps.unwrap().lat - 41.14961).abs() < 1e-6);
        assert_eq!(fs::metadata(&blank_path).unwrap().len(), size, "a re-pick is patched in place");
    }

    /// Real ImageIO: a JPEG that ImageIO and sips wrote themselves, turned
    /// by us, thumbnails with its sides swapped, so ImageIO honours the edit.
    #[test]
    fn imageio_honours_the_edited_orientation() {
        let src = Path::new("/System/Library/Desktop Pictures/Big Sur Graphic.heic");
        if !src.is_file() {
            eprintln!("skipped: no system HEIC on this machine");
            return;
        }
        let fx = Fixture::new();
        let square = fx.dir.path().join("square.jpg");
        let made = fx.dir.path().join("made.jpg");
        crate::thumbs::generate(src, 512, &square).unwrap(); // the wallpaper is square…
        let cropped = std::process::Command::new("sips")
            .args(["--cropToHeightWidth", "300", "480"])
            .arg(&square)
            .arg("--out")
            .arg(&made)
            .output()
            .unwrap();
        assert!(cropped.status.success(), "{cropped:?}"); // …so crop it to a landscape
        let (id, path) = fx.add("IMG_9999.JPG", &fs::read(&made).unwrap());

        let before = fx.dir.path().join("before.jpg");
        crate::thumbs::generate(&path, 256, &before).unwrap();
        let report = rotate(&fx.state, &id, 1);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        let after = fx.dir.path().join("after.jpg");
        crate::thumbs::generate(&path, 256, &after).unwrap();

        let a = imagesize::size(&before).unwrap();
        let b = imagesize::size(&after).unwrap();
        assert_ne!(a.width, a.height);
        assert_eq!((a.width, a.height), (b.height, b.width));
    }
}
