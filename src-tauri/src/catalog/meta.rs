// meta.rs — everything the UI needs to know about one image file: when it was
// taken, where, how it is oriented and how it is shaped. Two EXIF readers are
// dispatched on extension because neither covers every camera container:
// nom-exif understands JPEG/HEIC/RAF/CR3/PNG, kamadak-exif the TIFF-shaped
// RAWs (ARW, CR2, NEF, DNG, ORF, PEF, RW2) and TIFF itself. Whatever fails
// falls back to the file's mtime.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone};
use serde::{Deserialize, Serialize};

use super::walk::{extension, is_raw};

/// Wall-clock format shared with the frontend; EXIF carries no zone, so this
/// is deliberately zone-less.
const WALL_CLOCK: &str = "%Y-%m-%dT%H:%M:%S";
const KAMADAK_EXT: &[&str] = &["arw", "cr2", "nef", "dng", "orf", "pef", "rw2", "tif", "tiff"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoMeta {
    pub taken_at: String,
    pub taken_at_source: TakenAtSource,
    pub gps: Option<Gps>,
    /// EXIF orientation 1..8; thumbnails are already rotated, so the frontend
    /// only needs this for the RAW-only placeholder case.
    pub orientation: u32,
    /// Width / height as displayed (rotation applied); `None` when unknown.
    pub aspect: Option<f64>,
    pub camera: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TakenAtSource {
    Exif,
    Mtime,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Gps {
    pub lat: f64,
    pub lon: f64,
}

pub fn read_meta(path: &Path, mtime_ms: u64) -> PhotoMeta {
    let exif = read_exif(path).unwrap_or_default();
    let orientation = exif.orientation.filter(|o| (1..=8).contains(o)).unwrap_or(1);
    let (taken_at, taken_at_source) = match exif.taken_at {
        Some(t) => (t.format(WALL_CLOCK).to_string(), TakenAtSource::Exif),
        None => (wall_clock(mtime_ms), TakenAtSource::Mtime),
    };
    PhotoMeta {
        taken_at,
        taken_at_source,
        gps: exif.gps,
        orientation,
        aspect: pixel_size(path, &exif).map(|(w, h)| {
            // Orientations 5..8 rotate by 90°, so the displayed shape is flipped.
            if orientation >= 5 {
                h as f64 / w as f64
            } else {
                w as f64 / h as f64
            }
        }),
        camera: camera_name(exif.make, exif.model),
    }
}

/// Local wall clock for a unix-millisecond mtime, in the same format EXIF
/// dates are rendered in, so stacks sort uniformly.
pub fn wall_clock(mtime_ms: u64) -> String {
    Local
        .timestamp_millis_opt(mtime_ms as i64)
        .single()
        .map(|t| t.format(WALL_CLOCK).to_string())
        .unwrap_or_else(|| "1970-01-01T00:00:00".to_string())
}

#[derive(Default, Debug)]
struct ExifFields {
    taken_at: Option<NaiveDateTime>,
    gps: Option<Gps>,
    orientation: Option<u32>,
    make: Option<String>,
    model: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

fn read_exif(path: &Path) -> Option<ExifFields> {
    let ext = extension(path).unwrap_or_default();
    if KAMADAK_EXT.contains(&ext.as_str()) {
        read_with_kamadak(path)
    } else {
        read_with_nom(path)
    }
}

fn read_with_nom(path: &Path) -> Option<ExifFields> {
    use nom_exif::{ExifTag, MediaParser, MediaSource};

    let source = MediaSource::open(path).ok()?;
    let mut parser = MediaParser::new();
    let exif: nom_exif::Exif = parser.parse_exif(source).ok()?.into();

    let text = |tag| exif.get(tag).and_then(|v| v.as_str()).map(clean).filter(|s| !s.is_empty());
    let int = |tag| exif.get(tag).and_then(|v| v.try_as_integer()).and_then(|i| u32::try_from(i).ok());
    let date = |tag| {
        exif.get(tag).and_then(|v| {
            v.as_datetime()
                .map(|d| d.into_naive())
                .or_else(|| v.as_str().and_then(parse_exif_datetime))
        })
    };
    let gps = exif.gps_info().and_then(|g| {
        let lat = dms(&g.latitude)? * g.latitude_ref.sign();
        let lon = dms(&g.longitude)? * g.longitude_ref.sign();
        valid_gps(lat, lon)
    });

    Some(ExifFields {
        taken_at: date(ExifTag::DateTimeOriginal)
            .or_else(|| date(ExifTag::CreateDate))
            .or_else(|| date(ExifTag::ModifyDate)),
        gps,
        orientation: int(ExifTag::Orientation),
        make: text(ExifTag::Make),
        model: text(ExifTag::Model),
        width: int(ExifTag::ExifImageWidth),
        height: int(ExifTag::ExifImageHeight),
    })
}

fn dms(v: &nom_exif::LatLng) -> Option<f64> {
    Some(v.degrees.to_f64()? + v.minutes.to_f64()? / 60.0 + v.seconds.to_f64()? / 3600.0)
}

fn read_with_kamadak(path: &Path) -> Option<ExifFields> {
    use exif::{In, Reader, Tag, Value};

    let mut reader = BufReader::new(File::open(path).ok()?);
    // A truncated maker-note must not cost us the date, so keep partial results.
    let exif = match Reader::new().continue_on_error(true).read_from_container(&mut reader) {
        Ok(exif) => exif,
        Err(exif::Error::PartialResult(partial)) => partial.into_inner().0,
        Err(_) => return None,
    };

    let field = |tag| exif.get_field(tag, In::PRIMARY);
    let ascii = |tag| {
        field(tag).and_then(|f| match &f.value {
            Value::Ascii(v) => v.first().map(|b| clean(&String::from_utf8_lossy(b))),
            _ => None,
        })
    };
    let text = |tag| ascii(tag).filter(|s| !s.is_empty());
    let int = |tag| field(tag).and_then(|f| f.value.get_uint(0));
    let date = |tag| {
        field(tag).and_then(|f| match &f.value {
            Value::Ascii(v) => v.first().and_then(|b| exif::DateTime::from_ascii(b).ok()),
            _ => None,
        })
        .and_then(|d| {
            NaiveDate::from_ymd_opt(d.year as i32, d.month as u32, d.day as u32)?
                .and_hms_opt(d.hour as u32, d.minute as u32, d.second as u32)
        })
    };
    let coord = |tag, ref_tag| -> Option<f64> {
        let f = field(tag)?;
        let Value::Rational(r) = &f.value else { return None };
        if r.len() < 3 {
            return None;
        }
        let sign = match ascii(ref_tag).as_deref() {
            Some("S") | Some("W") => -1.0,
            _ => 1.0,
        };
        Some(sign * (r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0))
    };
    let gps = coord(Tag::GPSLatitude, Tag::GPSLatitudeRef)
        .zip(coord(Tag::GPSLongitude, Tag::GPSLongitudeRef))
        .and_then(|(lat, lon)| valid_gps(lat, lon));

    Some(ExifFields {
        taken_at: date(Tag::DateTimeOriginal)
            .or_else(|| date(Tag::DateTimeDigitized))
            .or_else(|| date(Tag::DateTime)),
        gps,
        orientation: int(Tag::Orientation),
        make: text(Tag::Make),
        model: text(Tag::Model),
        width: int(Tag::PixelXDimension).or_else(|| int(Tag::ImageWidth)),
        height: int(Tag::PixelYDimension).or_else(|| int(Tag::ImageLength)),
    })
}

/// Pixel dimensions. Primaries trust the container header (EXIF can be stale
/// after an edit); RAWs trust EXIF because their header describes a preview.
fn pixel_size(path: &Path, exif: &ExifFields) -> Option<(u32, u32)> {
    let from_exif = || exif.width.zip(exif.height);
    let from_header = || {
        imagesize::size(path)
            .ok()
            .map(|s| (s.width as u32, s.height as u32))
    };
    let dims = if is_raw(path) {
        from_exif().or_else(from_header)
    } else {
        from_header().or_else(from_exif)
    };
    dims.filter(|&(w, h)| w > 0 && h > 0)
}

/// Phones and some cameras write 0°/0° when there was no fix.
fn valid_gps(lat: f64, lon: f64) -> Option<Gps> {
    let in_range = lat.is_finite() && lon.is_finite() && lat.abs() <= 90.0 && lon.abs() <= 180.0;
    (in_range && !(lat == 0.0 && lon == 0.0)).then_some(Gps { lat, lon })
}

fn parse_exif_datetime(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s.trim(), "%Y:%m:%d %H:%M:%S").ok()
}

fn clean(s: &str) -> String {
    s.trim_matches(|c: char| c == '\0' || c.is_whitespace()).to_string()
}

/// "Canon" + "Canon EOS R6" → "Canon EOS R6"; "FUJIFILM" + "X-T5" → "FUJIFILM X-T5".
fn camera_name(make: Option<String>, model: Option<String>) -> Option<String> {
    match (make, model) {
        (Some(make), Some(model)) => {
            if model.to_ascii_lowercase().starts_with(&make.to_ascii_lowercase()) {
                Some(model)
            } else {
                Some(format!("{make} {model}"))
            }
        }
        (make, model) => make.or(model),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use exif::experimental::Writer;
    use exif::{Field, In, Rational, Tag, Value};
    use std::io::Cursor;

    fn ascii(tag: Tag, s: &str) -> Field {
        Field { tag, ifd_num: In::PRIMARY, value: Value::Ascii(vec![s.as_bytes().to_vec()]) }
    }

    fn dms(tag: Tag, d: u32, m: u32, s_hundredths: u32) -> Field {
        let r = |num, denom| Rational { num, denom };
        Field { tag, ifd_num: In::PRIMARY, value: Value::Rational(vec![r(d, 1), r(m, 1), r(s_hundredths, 100)]) }
    }

    /// A TIFF-shaped EXIF blob for Lisbon (38.7223, -9.1393), shot rotated.
    fn exif_blob() -> Vec<u8> {
        let fields = vec![
            ascii(Tag::Make, "FUJIFILM"),
            ascii(Tag::Model, "X-T5"),
            Field { tag: Tag::Orientation, ifd_num: In::PRIMARY, value: Value::Short(vec![6]) },
            ascii(Tag::DateTimeOriginal, "2024:11:05 14:03:21"),
            Field { tag: Tag::PixelXDimension, ifd_num: In::PRIMARY, value: Value::Long(vec![600]) },
            Field { tag: Tag::PixelYDimension, ifd_num: In::PRIMARY, value: Value::Long(vec![400]) },
            ascii(Tag::GPSLatitudeRef, "N"),
            dms(Tag::GPSLatitude, 38, 43, 2028),
            ascii(Tag::GPSLongitudeRef, "W"),
            dms(Tag::GPSLongitude, 9, 8, 2148),
        ];
        let mut writer = Writer::new();
        for f in &fields {
            writer.push_field(f);
        }
        let mut out = Cursor::new(Vec::new());
        writer.write(&mut out, false).unwrap();
        out.into_inner()
    }

    /// SOI + optional APP1 + a 6×4 baseline SOF0 + EOI: enough for both EXIF
    /// readers and the header-size probe, no scan data needed.
    fn jpeg(exif: Option<&[u8]>) -> Vec<u8> {
        let mut j = vec![0xFF, 0xD8];
        if let Some(exif) = exif {
            let len = (2 + 6 + exif.len()) as u16;
            j.extend_from_slice(&[0xFF, 0xE1, (len >> 8) as u8, len as u8]);
            j.extend_from_slice(b"Exif\0\0");
            j.extend_from_slice(exif);
        }
        j.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x04, 0x00, 0x06, 0x03]);
        j.extend_from_slice(&[0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
        j.extend_from_slice(&[0xFF, 0xD9]);
        j
    }

    fn assert_lisbon(meta: &PhotoMeta) {
        assert_eq!(meta.taken_at, "2024-11-05T14:03:21");
        assert_eq!(meta.taken_at_source, TakenAtSource::Exif);
        let gps = meta.gps.expect("gps");
        assert!((gps.lat - 38.7223).abs() < 1e-4, "lat {}", gps.lat);
        assert!((gps.lon + 9.1393).abs() < 1e-4, "lon {}", gps.lon);
        assert_eq!(meta.orientation, 6);
        assert_eq!(meta.camera.as_deref(), Some("FUJIFILM X-T5"));
    }

    #[test]
    fn jpeg_via_nom_exif() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("DSCF0001.JPG");
        std::fs::write(&path, jpeg(Some(&exif_blob()))).unwrap();
        let meta = read_meta(&path, 0);
        assert_lisbon(&meta);
        // Header says 6×4; orientation 6 rotates it to portrait.
        assert!((meta.aspect.unwrap() - 4.0 / 6.0).abs() < 1e-9);
    }

    #[test]
    fn tiff_via_kamadak_exif() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("DSC00001.tif");
        std::fs::write(&path, exif_blob()).unwrap();
        let meta = read_meta(&path, 0);
        assert_lisbon(&meta);
        // No image header to read, so the EXIF 600×400 wins, rotated.
        assert!((meta.aspect.unwrap() - 400.0 / 600.0).abs() < 1e-9);
    }

    #[test]
    fn no_exif_falls_back_to_mtime_wall_clock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plain.jpg");
        std::fs::write(&path, jpeg(None)).unwrap();
        let mtime = 1_730_815_401_000;
        let meta = read_meta(&path, mtime);
        assert_eq!(meta.taken_at_source, TakenAtSource::Mtime);
        assert_eq!(meta.taken_at, wall_clock(mtime));
        assert_eq!(meta.taken_at.len(), 19);
        assert_eq!(meta.orientation, 1);
        assert!((meta.aspect.unwrap() - 1.5).abs() < 1e-9);
        assert_eq!(meta.gps, None);
        assert_eq!(meta.camera, None);
    }

    #[test]
    fn camera_names_do_not_repeat_the_make() {
        assert_eq!(camera_name(Some("Canon".into()), Some("Canon EOS R6".into())).unwrap(), "Canon EOS R6");
        assert_eq!(camera_name(Some("FUJIFILM".into()), Some("X-T5".into())).unwrap(), "FUJIFILM X-T5");
        assert_eq!(camera_name(None, Some("iPhone 15".into())).unwrap(), "iPhone 15");
        assert_eq!(camera_name(None, None), None);
    }
}
