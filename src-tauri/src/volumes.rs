// volumes.rs — what can be scanned: mounted cards and drives (classified from
// NSURL volume flags), the user's local folders, and the fixture card that
// `STACKS_FIXTURES` fakes for development. Also the mount watcher.

use std::path::{Path, PathBuf};
use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSWorkspace, NSWorkspaceDidMountNotification, NSWorkspaceDidUnmountNotification};
use objc2_foundation::{
    NSArray, NSDictionary, NSFileManager, NSNotification, NSNumber, NSOperationQueue, NSString,
    NSURLResourceKey, NSURLVolumeIsBrowsableKey, NSURLVolumeIsEjectableKey,
    NSURLVolumeIsInternalKey, NSURLVolumeIsReadOnlyKey, NSURLVolumeIsRemovableKey,
    NSURLVolumeLocalizedNameKey, NSVolumeEnumerationOptions, NSURL,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Event carrying the fresh `Vec<Volume>` whenever something mounts or unmounts.
pub const CHANGED_EVENT: &str = "volumes-changed";
const FIXTURES_ENV: &str = "STACKS_FIXTURES";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VolumeKind {
    Card,
    External,
    Folder,
    Fixture,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: VolumeKind,
    pub read_only: bool,
    pub has_dcim: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub volume_id: String,
    pub root: String,
    pub kind: VolumeKind,
}

/// The NSURL volume resource values that decide a volume's kind.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VolumeFlags {
    pub removable: bool,
    pub ejectable: bool,
    pub internal: bool,
    pub browsable: bool,
    pub read_only: bool,
    pub is_root: bool,
    pub has_dcim: bool,
}

/// An SD card in the built-in reader reports Internal=true, so "not internal"
/// is useless; removable-or-ejectable is what separates media from the boot
/// disk and its APFS siblings (`/Volumes/Sequoia*`, `Macintosh HD`).
pub fn classify(flags: VolumeFlags) -> Option<VolumeKind> {
    if flags.is_root || !flags.browsable || !(flags.removable || flags.ejectable) {
        return None;
    }
    Some(if flags.has_dcim { VolumeKind::Card } else { VolumeKind::External })
}

pub fn fixtures_root() -> Option<PathBuf> {
    std::env::var_os(FIXTURES_ENV)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.is_dir())
}

/// Mounted volumes worth scanning, plus the fixture card when configured.
pub fn list() -> Vec<Volume> {
    let mut volumes: Vec<Volume> = mounted()
        .into_iter()
        .filter_map(|v| {
            let kind = classify(v.flags)?;
            Some(Volume {
                id: v.path.to_string_lossy().into_owned(),
                name: v.name,
                path: v.path.to_string_lossy().into_owned(),
                kind,
                read_only: v.flags.read_only,
                has_dcim: v.flags.has_dcim,
            })
        })
        .collect();
    if let Some(root) = fixtures_root() {
        volumes.push(Volume {
            id: "fixture".into(),
            name: "fixture card".into(),
            path: root.to_string_lossy().into_owned(),
            kind: VolumeKind::Fixture,
            read_only: false,
            has_dcim: true,
        });
    }
    volumes
}

/// The folders scanned without any card: ~/Pictures, ~/Desktop, ~/Downloads
/// (those that exist). In fixture mode the fixture tree's `local/*` folders
/// stand in for them so the scenario stays deterministic.
pub fn default_sources(app: &AppHandle) -> Vec<Source> {
    let mut dirs: Vec<PathBuf> = match fixtures_root() {
        Some(root) => std::fs::read_dir(root.join("local"))
            .map(|rd| rd.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default(),
        None => {
            let p = app.path();
            [p.picture_dir(), p.desktop_dir(), p.download_dir()]
                .into_iter()
                .filter_map(Result::ok)
                .filter(|d| d.is_dir())
                .collect()
        }
    };
    dirs.sort();
    dirs.into_iter()
        .map(|dir| Source {
            volume_id: format!("local:{}", dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
            root: dir.to_string_lossy().into_owned(),
            kind: VolumeKind::Folder,
        })
        .collect()
}

/// Whether the volume holding `path` is mounted read-only (a locked SD card
/// mounts that way). Unknown paths answer `false`; the caller then gets the
/// real error from the operation it attempts.
pub fn is_read_only(path: &Path) -> bool {
    let Some(url) = NSURL::from_file_path(path) else { return false };
    // SAFETY: reading Foundation's exported constant key.
    let key = unsafe { NSURLVolumeIsReadOnlyKey };
    let keys = NSArray::from_slice(&[key]);
    url.resourceValuesForKeys_error(&keys)
        .map(|values| flag(&values, key))
        .unwrap_or(false)
}

/// Emits `volumes-changed` on mount and unmount. Must be called on the main
/// thread; the observers live as long as the process, so their tokens are
/// deliberately leaked instead of being stored somewhere `!Send`.
pub fn watch(app: AppHandle) {
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    let queue = NSOperationQueue::mainQueue();
    // SAFETY: reading AppKit's exported constant notification names.
    let names = unsafe { [NSWorkspaceDidMountNotification, NSWorkspaceDidUnmountNotification] };
    for name in names {
        let app = app.clone();
        let block: RcBlock<dyn Fn(NonNull<NSNotification>)> = RcBlock::new(move |_| {
            let _ = app.emit(CHANGED_EVENT, list());
        });
        // SAFETY: the block captures only an `AppHandle` (Send + Sync) and is
        // invoked on the main queue we pass in.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(Some(name), None, Some(&queue), &block)
        };
        std::mem::forget(token);
        std::mem::forget(block);
    }
}

struct Mounted {
    path: PathBuf,
    name: String,
    flags: VolumeFlags,
}

fn resource_keys() -> Retained<NSArray<NSURLResourceKey>> {
    // SAFETY: reading Foundation's exported constant keys.
    unsafe {
        NSArray::from_slice(&[
            NSURLVolumeIsRemovableKey,
            NSURLVolumeIsEjectableKey,
            NSURLVolumeIsInternalKey,
            NSURLVolumeIsBrowsableKey,
            NSURLVolumeIsReadOnlyKey,
            NSURLVolumeLocalizedNameKey,
        ])
    }
}

/// Every mounted, non-hidden volume under `/Volumes` with its flags read.
/// Anything mounted elsewhere (`/`, `/System/Volumes/*`) is never a source.
fn mounted() -> Vec<Mounted> {
    let keys = resource_keys();
    let urls = NSFileManager::defaultManager()
        .mountedVolumeURLsIncludingResourceValuesForKeys_options(
            Some(&keys),
            NSVolumeEnumerationOptions::SkipHiddenVolumes,
        );
    let Some(urls) = urls else { return Vec::new() };

    urls.to_vec()
        .into_iter()
        .filter_map(|url| {
            let path = url.to_file_path()?;
            if !path.starts_with("/Volumes") || path.starts_with("/Volumes/.timemachine") {
                return None;
            }
            let values = url.resourceValuesForKeys_error(&keys).ok()?;
            // SAFETY: reading Foundation's exported constant keys.
            let flags = unsafe {
                VolumeFlags {
                    removable: flag(&values, NSURLVolumeIsRemovableKey),
                    ejectable: flag(&values, NSURLVolumeIsEjectableKey),
                    internal: flag(&values, NSURLVolumeIsInternalKey),
                    browsable: flag(&values, NSURLVolumeIsBrowsableKey),
                    read_only: flag(&values, NSURLVolumeIsReadOnlyKey),
                    is_root: path == Path::new("/"),
                    has_dcim: path.join("DCIM").is_dir(),
                }
            };
            let name = unsafe { values.objectForKey(NSURLVolumeLocalizedNameKey) }
                .and_then(|o| o.downcast::<NSString>().ok())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
            Some(Mounted { path, name, flags })
        })
        .collect()
}

fn flag(values: &NSDictionary<NSURLResourceKey, AnyObject>, key: &NSURLResourceKey) -> bool {
    values
        .objectForKey(key)
        .and_then(|o| o.downcast::<NSNumber>().ok())
        .map(|n| n.boolValue())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(removable: bool, ejectable: bool, internal: bool, has_dcim: bool) -> VolumeFlags {
        VolumeFlags { removable, ejectable, internal, browsable: true, read_only: false, is_root: false, has_dcim }
    }

    #[test]
    fn classify_table() {
        // SD card in the built-in reader: internal *and* removable.
        assert_eq!(classify(flags(true, false, true, true)), Some(VolumeKind::Card));
        assert_eq!(classify(flags(true, false, false, false)), Some(VolumeKind::External));
        // USB drive: ejectable only.
        assert_eq!(classify(flags(false, true, false, false)), Some(VolumeKind::External));
        assert_eq!(classify(flags(false, true, false, true)), Some(VolumeKind::Card));
        // Internal fixed APFS volumes (Sequoia*, Macintosh HD, Data).
        assert_eq!(classify(flags(false, false, true, false)), None);
        assert_eq!(classify(flags(false, false, false, false)), None);
        // The boot volume, whatever its flags.
        assert_eq!(classify(VolumeFlags { is_root: true, ..flags(true, true, true, true) }), None);
        // Non-browsable volumes are system plumbing.
        assert_eq!(classify(VolumeFlags { browsable: false, ..flags(true, true, false, true) }), None);
    }

    #[test]
    fn read_only_passes_through_untouched() {
        let locked = VolumeFlags { read_only: true, ..flags(true, false, true, true) };
        assert_eq!(classify(locked), Some(VolumeKind::Card));
        assert!(locked.read_only);
    }

    #[test]
    fn root_volume_is_never_read_only_locked() {
        // The boot volume exists and is writable; the helper must not panic
        // on an ordinary path and must say "not read-only" for it.
        assert!(!is_read_only(Path::new("/tmp")));
    }

    /// Real NSFileManager enumeration: never the boot disk or its APFS
    /// siblings, and every listed volume is a browsable mount under /Volumes.
    #[test]
    fn listing_real_volumes_excludes_internal_disks() {
        for v in list().into_iter().filter(|v| v.kind != VolumeKind::Fixture) {
            assert!(v.path.starts_with("/Volumes/"), "{v:?}");
            assert!(!v.path.starts_with("/Volumes/Sequoia"), "{v:?}");
            assert!(v.name != "Macintosh HD", "{v:?}");
            assert!(Path::new(&v.path).is_dir(), "{v:?}");
        }
    }

    #[test]
    fn kinds_serialise_lowercase() {
        assert_eq!(serde_json::to_string(&VolumeKind::Card).unwrap(), "\"card\"");
        assert_eq!(serde_json::to_string(&VolumeKind::Fixture).unwrap(), "\"fixture\"");
        let s: Source = serde_json::from_str(r#"{"volumeId":"x","root":"/tmp","kind":"folder"}"#).unwrap();
        assert_eq!(s.kind, VolumeKind::Folder);
    }
}
