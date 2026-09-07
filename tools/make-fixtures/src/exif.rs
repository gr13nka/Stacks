//! Embeds the scenario's metadata into a rendered JPEG as an APP1/EXIF segment
//! (IFD0 → ExifIFD + GPSIFD), written by `little_exif`.

use std::io;

use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::metadata::Metadata;
use little_exif::rational::uR64;

use crate::scenario::Photo;

pub fn embed(jpeg: &mut Vec<u8>, photo: &Photo) -> io::Result<()> {
    let stamp = photo.taken_at.exif();
    let mut md = Metadata::new();
    md.set_tag(ExifTag::Make(photo.camera.make().to_string()));
    md.set_tag(ExifTag::Model(photo.camera.model().to_string()));
    md.set_tag(ExifTag::Orientation(vec![photo.orientation]));
    // Real cameras stamp all three dates identically at capture time.
    md.set_tag(ExifTag::ModifyDate(stamp.clone()));
    md.set_tag(ExifTag::DateTimeOriginal(stamp.clone()));
    md.set_tag(ExifTag::CreateDate(stamp));
    md.set_tag(ExifTag::SubSecTimeOriginal(format!("{:02}", photo.subsec)));

    if let Some((lat, lon)) = photo.gps {
        md.set_tag(ExifTag::GPSLatitudeRef((if lat < 0.0 { "S" } else { "N" }).to_string()));
        md.set_tag(ExifTag::GPSLatitude(dms(lat)));
        md.set_tag(ExifTag::GPSLongitudeRef((if lon < 0.0 { "W" } else { "E" }).to_string()));
        md.set_tag(ExifTag::GPSLongitude(dms(lon)));
    }

    md.write_to_vec(jpeg, FileExtension::JPEG)
}

/// Unsigned degrees/minutes/seconds rationals; seconds keep three decimals,
/// which is well under a metre of error.
fn dms(coordinate: f64) -> Vec<uR64> {
    let abs = coordinate.abs();
    let degrees = abs.floor();
    let minutes = ((abs - degrees) * 60.0).floor();
    let seconds = (abs - degrees) * 3_600.0 - minutes * 60.0;
    vec![
        uR64 { nominator: degrees as u32, denominator: 1 },
        uR64 { nominator: minutes as u32, denominator: 1 },
        uR64 { nominator: (seconds * 1_000.0).round() as u32, denominator: 1_000 },
    ]
}
