//! Deterministic fixture card for Stacks.
//!
//! `generate(root)` wipes `root` and rebuilds a DCIM-style tree of small JPEGs
//! (with RAW twins that are byte copies) carrying EXIF dates, GPS clusters,
//! rotation tags and a few EXIF-less files, following the shooting scenario in
//! [`scenario`]. The same input always yields byte-identical files, so the
//! tree doubles as a regression oracle for the scanner.

pub mod scenario;

mod exif;
mod manifest;
mod render;

use std::fs;
use std::io;
use std::path::Path;

use filetime::FileTime;

use scenario::Scenario;

/// Regenerates the fixture tree under `root` and returns the manifest text
/// that was also written to `<root>/MANIFEST.txt`.
///
/// Refuses to wipe a non-empty directory that has no `MANIFEST.txt`, so a
/// mistyped path cannot delete real photos.
pub fn generate(root: &Path) -> io::Result<String> {
    reset_dir(root)?;
    let scenario = Scenario::build();

    for photo in &scenario.photos {
        let mut bytes = render::jpeg(photo.index, render::fill_for(photo.session), photo.portrait);
        if photo.has_exif {
            exif::embed(&mut bytes, photo)?;
        }
        let mtime = FileTime::from_unix_time(photo.taken_at.local_epoch(), 0);
        for relative in photo.jpeg.iter().chain(photo.raw.iter()) {
            let path = root.join(relative);
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir)?;
            }
            fs::write(&path, &bytes)?;
            filetime::set_file_mtime(&path, mtime)?;
        }
    }

    let text = manifest::render(&scenario);
    fs::write(root.join("MANIFEST.txt"), &text)?;
    Ok(text)
}

fn reset_dir(root: &Path) -> io::Result<()> {
    if root.exists() {
        let ours = root.join("MANIFEST.txt").exists();
        let empty = fs::read_dir(root)?.next().is_none();
        if !ours && !empty {
            return Err(io::Error::other(format!(
                "refusing to wipe {}: it is not empty and has no MANIFEST.txt, so make-fixtures did not create it",
                root.display()
            )));
        }
        fs::remove_dir_all(root)?;
    }
    fs::create_dir_all(root)
}
