// failure.rs — what can go wrong when Stacks touches a user's file, in the
// three words the frontend reacts to (read-only, missing, unsupported) plus
// "other". Shared by the two modules that change files: trash.rs (moves) and
// retag.rs (metadata edits).

use std::fs;
use std::io;
use std::path::Path;

use serde::Serialize;

use crate::volumes;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FailReason {
    ReadOnly,
    Missing,
    /// A file Stacks deliberately leaves alone: a RAW, or a format it cannot edit.
    Unsupported,
    Other,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileFailure {
    pub id: String,
    pub path: String,
    pub reason: FailReason,
    pub message: String,
}

/// Refuses a file that is gone or sits on a read-only volume before any OS
/// call that would fail slower and with a less specific error.
pub fn precheck(path: &Path) -> Result<(), (FailReason, String)> {
    if fs::symlink_metadata(path).is_err() {
        return Err((FailReason::Missing, "the file no longer exists".into()));
    }
    if volumes::is_read_only(path) {
        return Err((FailReason::ReadOnly, "the volume is read-only".into()));
    }
    Ok(())
}

/// ENOENT means missing; EROFS / EACCES / EPERM mean the card, the file or its
/// folder refuses writes, which the user fixes the same way (unlock, chmod).
pub fn io_reason(err: &io::Error) -> FailReason {
    match err.kind() {
        io::ErrorKind::NotFound => FailReason::Missing,
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem => FailReason::ReadOnly,
        _ => match err.raw_os_error() {
            Some(libc::EROFS | libc::EACCES | libc::EPERM) => FailReason::ReadOnly,
            Some(libc::ENOENT) => FailReason::Missing,
            _ => FailReason::Other,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasons_serialise_kebab_case() {
        assert_eq!(serde_json::to_string(&FailReason::ReadOnly).unwrap(), "\"read-only\"");
        assert_eq!(serde_json::to_string(&FailReason::Unsupported).unwrap(), "\"unsupported\"");
    }

    #[test]
    fn io_errors_map_to_reasons() {
        assert_eq!(io_reason(&io::Error::from_raw_os_error(libc::EROFS)), FailReason::ReadOnly);
        assert_eq!(io_reason(&io::Error::from_raw_os_error(libc::EACCES)), FailReason::ReadOnly);
        assert_eq!(io_reason(&io::Error::from_raw_os_error(libc::ENOENT)), FailReason::Missing);
        assert_eq!(io_reason(&io::Error::other("x")), FailReason::Other);
    }

    #[test]
    fn precheck_reports_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(precheck(&dir.path().join("nope.jpg")).unwrap_err().0, FailReason::Missing);
    }
}
