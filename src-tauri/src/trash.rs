// trash.rs — the only code that touches the user's files. Moves go through
// NSFileManager's trash so Finder's "Put Back" works and cards get their own
// `.Trashes`; the resulting URL is remembered so undo is an exact rename back.

use std::fs;
use std::path::{Path, PathBuf};

use objc2::rc::Retained;
use objc2_foundation::{
    NSCocoaErrorDomain, NSError, NSFileManager, NSPOSIXErrorDomain, NSUnderlyingErrorKey, NSURL,
};
use serde::{Deserialize, Serialize};

use crate::state::AppState;
use crate::volumes;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedFile {
    pub id: String,
    pub from: String,
    /// Where the file landed; `None` if the OS did not say (undo then fails).
    pub to: Option<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FailReason {
    ReadOnly,
    Missing,
    Other,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashFailure {
    pub id: String,
    pub path: String,
    pub reason: FailReason,
    pub message: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrashReport {
    pub trashed: Vec<TrashedFile>,
    pub failed: Vec<TrashFailure>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RestoreFailure {
    pub path: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored: Vec<String>,
    pub failed: Vec<RestoreFailure>,
}

/// Trashes each photo's primary file and, when asked, its RAW twin. A photo
/// whose primary is gone leaves the index; a stranded RAW is reported, not hidden.
pub fn trash_photos(state: &AppState, ids: &[String], include_raw: bool) -> TrashReport {
    let mut report = TrashReport::default();
    for id in ids {
        let Some(entry) = state.entry(id) else {
            report.failed.push(TrashFailure {
                id: id.clone(),
                path: String::new(),
                reason: FailReason::Missing,
                message: "photo is not in the catalog".into(),
            });
            continue;
        };
        let mut files = vec![entry.path.clone()];
        if include_raw {
            files.extend(entry.raw.clone());
        }
        let mut primary_gone = false;
        for (i, file) in files.into_iter().enumerate() {
            let path = file.to_string_lossy().into_owned();
            match trash_file(&file) {
                Ok(to) => {
                    primary_gone |= i == 0;
                    report.trashed.push(TrashedFile {
                        id: id.clone(),
                        from: path,
                        to: to.map(|p| p.to_string_lossy().into_owned()),
                    });
                }
                Err((reason, message)) => {
                    report.failed.push(TrashFailure { id: id.clone(), path, reason, message });
                }
            }
        }
        if primary_gone {
            if let Ok(mut index) = state.index.write() {
                index.remove(id);
            }
        }
    }
    report
}

/// Moves each trashed file back to where it came from. A file already back
/// in place (Finder's "Put Back") counts as restored; one that exists both in
/// the trash and at the origin is left alone and reported.
pub fn restore(items: &[TrashedFile]) -> RestoreReport {
    let mut report = RestoreReport::default();
    for item in items {
        let from = Path::new(&item.from);
        let Some(to) = item.to.as_deref().map(Path::new) else {
            report.failed.push(RestoreFailure { path: item.from.clone(), message: "no trash location was recorded".into() });
            continue;
        };
        let origin_exists = fs::symlink_metadata(from).is_ok();
        let in_trash = fs::symlink_metadata(to).is_ok();
        let outcome = match (origin_exists, in_trash) {
            (true, false) => Ok(()),
            (true, true) => Err("a different file now sits at the original path".to_string()),
            (false, false) => Err("the file is no longer in the trash".to_string()),
            (false, true) => from
                .parent()
                .map(fs::create_dir_all)
                .unwrap_or(Ok(()))
                .and_then(|_| fs::rename(to, from))
                .map_err(|e| e.to_string()),
        };
        match outcome {
            Ok(()) => report.restored.push(item.from.clone()),
            Err(message) => report.failed.push(RestoreFailure { path: item.from.clone(), message }),
        }
    }
    report
}

/// Read-only volumes are refused before the call: NSFileManager would fail
/// anyway, but slower and with a less specific error.
fn trash_file(path: &Path) -> Result<Option<PathBuf>, (FailReason, String)> {
    if fs::symlink_metadata(path).is_err() {
        return Err((FailReason::Missing, "the file no longer exists".into()));
    }
    if volumes::is_read_only(path) {
        return Err((FailReason::ReadOnly, "the volume is read-only".into()));
    }
    let url = NSURL::from_file_path(path)
        .ok_or((FailReason::Other, "the path cannot be represented as a URL".to_string()))?;
    let mut landed: Option<Retained<NSURL>> = None;
    match NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, Some(&mut landed)) {
        Ok(()) => Ok(landed.and_then(|u| u.to_file_path())),
        Err(err) => Err((classify_error(&err), err.localizedDescription().to_string())),
    }
}

/// Cocoa 642 (NSFileWriteVolumeReadOnlyError) and POSIX 30 (EROFS) mean
/// read-only; Cocoa 4 / 260 and POSIX 2 (ENOENT) mean missing. Cocoa wraps
/// the POSIX cause in NSUnderlyingErrorKey, so one level of unwrapping is
/// checked as well.
fn classify_error(err: &NSError) -> FailReason {
    let direct = reason_for(err);
    if direct != FailReason::Other {
        return direct;
    }
    // SAFETY: reading Foundation's exported constant key.
    let key = unsafe { NSUnderlyingErrorKey };
    err.userInfo()
        .objectForKey(key)
        .and_then(|o| o.downcast::<NSError>().ok())
        .map(|inner| reason_for(&inner))
        .unwrap_or(FailReason::Other)
}

fn reason_for(err: &NSError) -> FailReason {
    let domain = err.domain();
    // SAFETY: reading Foundation's exported constant domains.
    let (cocoa, posix) = unsafe { (NSCocoaErrorDomain, NSPOSIXErrorDomain) };
    let code = err.code();
    if &*domain == cocoa {
        match code {
            642 => FailReason::ReadOnly,
            4 | 260 => FailReason::Missing,
            _ => FailReason::Other,
        }
    } else if &*domain == posix {
        match code {
            30 => FailReason::ReadOnly,
            2 => FailReason::Missing,
            _ => FailReason::Other,
        }
    } else {
        FailReason::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_reported_before_any_os_call() {
        let dir = tempfile::tempdir().unwrap();
        let err = trash_file(&dir.path().join("nope.jpg")).unwrap_err();
        assert_eq!(err.0, FailReason::Missing);
    }

    #[test]
    fn restore_handles_every_origin_and_trash_combination() {
        let dir = tempfile::tempdir().unwrap();
        let origin = dir.path().join("sub").join("a.jpg");
        let trashed = dir.path().join("trash").join("a.jpg");
        fs::create_dir_all(trashed.parent().unwrap()).unwrap();
        fs::write(&trashed, b"x").unwrap();

        let item = TrashedFile { id: "1".into(), from: origin.to_string_lossy().into(), to: Some(trashed.to_string_lossy().into()) };
        let report = restore(std::slice::from_ref(&item));
        assert_eq!(report.restored, vec![item.from.clone()]);
        assert!(origin.is_file() && !trashed.exists());

        // Already back in place: still counts as restored.
        assert_eq!(restore(std::slice::from_ref(&item)).restored.len(), 1);

        // Both present: refuse to clobber.
        fs::write(&trashed, b"y").unwrap();
        let report = restore(std::slice::from_ref(&item));
        assert_eq!(report.failed.len(), 1);
        assert_eq!(fs::read(&origin).unwrap(), b"x");

        let unknown = TrashedFile { id: "2".into(), from: "/nowhere/b.jpg".into(), to: None };
        assert_eq!(restore(&[unknown]).failed.len(), 1);
    }

    /// Real NSFileManager round trip: a temp file goes to ~/.Trash and comes
    /// back by rename. Leaves nothing behind when it passes.
    #[test]
    fn trash_and_restore_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("stacks-trash-test.txt");
        fs::write(&file, b"disposable").unwrap();

        let landed = trash_file(&file).unwrap().expect("resulting URL");
        assert!(!file.exists());
        assert!(landed.is_file(), "{landed:?}");
        assert!(landed.to_string_lossy().contains(".Trash"), "{landed:?}");

        let item = TrashedFile { id: "t".into(), from: file.to_string_lossy().into(), to: Some(landed.to_string_lossy().into()) };
        let report = restore(&[item]);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert_eq!(fs::read(&file).unwrap(), b"disposable");
        assert!(!landed.exists());
    }

    #[test]
    fn failure_reasons_serialise_kebab_case() {
        assert_eq!(serde_json::to_string(&FailReason::ReadOnly).unwrap(), "\"read-only\"");
    }
}
