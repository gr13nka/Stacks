// testkit.rs — synthetic JPEGs for the tests of every module that reads or
// edits EXIF: a TIFF block built with kamadak-exif's writer (either byte
// order, optional IFD1 thumbnail and maker note) wrapped in just enough JPEG
// (SOI, optional JFIF / Exif / XMP / MPF segments, a 6×4 SOF0, a scan, EOI)
// for both EXIF readers, the header-size probe and the editor's marker walk.
// The scan is filler: nom-exif buffers ahead and reports EOF on a file that
// ends right after its headers, which no real JPEG does.

use exif::experimental::Writer;
use exif::{Field, In, Rational, Tag, Value};
use std::io::Cursor;

pub fn ascii(tag: Tag, s: &str) -> Field {
    Field { tag, ifd_num: In::PRIMARY, value: Value::Ascii(vec![s.as_bytes().to_vec()]) }
}

fn dms(tag: Tag, d: u32, m: u32, s_hundredths: u32) -> Field {
    let r = |num, denom| Rational { num, denom };
    Field { tag, ifd_num: In::PRIMARY, value: Value::Rational(vec![r(d, 1), r(m, 1), r(s_hundredths, 100)]) }
}

/// Make, model, date and pixel size; `Orientation = 1` when asked for.
pub fn camera_fields(orientation: bool) -> Vec<Field> {
    let mut fields = vec![
        ascii(Tag::Make, "FUJIFILM"),
        ascii(Tag::Model, "X-T5"),
        ascii(Tag::DateTimeOriginal, "2024:11:05 14:03:21"),
        Field { tag: Tag::PixelXDimension, ifd_num: In::PRIMARY, value: Value::Long(vec![600]) },
        Field { tag: Tag::PixelYDimension, ifd_num: In::PRIMARY, value: Value::Long(vec![400]) },
    ];
    if orientation {
        fields.push(Field { tag: Tag::Orientation, ifd_num: In::PRIMARY, value: Value::Short(vec![1]) });
    }
    fields
}

/// Shot in Lisbon (38.7223, -9.1393) by a camera with GPS, rotated (orientation 6).
pub fn lisbon_fields() -> Vec<Field> {
    let mut fields = camera_fields(false);
    fields.extend([
        Field { tag: Tag::Orientation, ifd_num: In::PRIMARY, value: Value::Short(vec![6]) },
        ascii(Tag::GPSLatitudeRef, "N"),
        dms(Tag::GPSLatitude, 38, 43, 2028),
        ascii(Tag::GPSLongitudeRef, "W"),
        dms(Tag::GPSLongitude, 9, 8, 2148),
    ]);
    fields
}

pub fn lisbon_exif(little_endian: bool) -> Vec<u8> {
    exif_tiff(&lisbon_fields(), little_endian, None, None)
}

/// Opaque maker-note bytes with an internal "offset" a real one would carry.
pub fn maker_note() -> Vec<u8> {
    let mut note = b"FUJIFILM\x0c\0\0\0".to_vec();
    note.extend((0u8..64).collect::<Vec<_>>());
    note
}

/// A TIFF-shaped EXIF block.
pub fn exif_tiff(fields: &[Field], little_endian: bool, thumbnail: Option<&[u8]>, maker_note: Option<&[u8]>) -> Vec<u8> {
    let note = maker_note.map(|b| Field { tag: Tag::MakerNote, ifd_num: In::PRIMARY, value: Value::Undefined(b.to_vec(), 0) });
    let mut writer = Writer::new();
    for f in fields.iter().chain(note.iter()) {
        writer.push_field(f);
    }
    if let Some(t) = thumbnail {
        writer.set_jpeg(t, In::THUMBNAIL);
    }
    let mut out = Cursor::new(Vec::new());
    writer.write(&mut out, little_endian).unwrap();
    out.into_inner()
}

#[derive(Default)]
pub struct JpegParts {
    pub jfif: bool,
    pub exif: Option<Vec<u8>>,
    pub xmp: Option<String>,
    pub mpf: bool,
    /// Put the MPF segment before the Exif one (cameras do not, editors might).
    pub mpf_first: bool,
}

pub fn jpeg(exif: Option<&[u8]>) -> Vec<u8> {
    jpeg_with(JpegParts { exif: exif.map(<[u8]>::to_vec), ..Default::default() })
}

pub fn jpeg_with(parts: JpegParts) -> Vec<u8> {
    let mut j = vec![0xFF, 0xD8];
    if parts.jfif {
        segment(&mut j, 0xE0, &[b"JFIF\0".as_slice(), &[1, 1, 0, 0, 1, 0, 1, 0, 0]].concat());
    }
    if parts.mpf && parts.mpf_first {
        segment(&mut j, 0xE2, &mpf_payload());
    }
    if let Some(exif) = &parts.exif {
        segment(&mut j, 0xE1, &[b"Exif\0\0".as_slice(), exif].concat());
    }
    if let Some(xmp) = &parts.xmp {
        segment(&mut j, 0xE1, &[b"http://ns.adobe.com/xap/1.0/\0".as_slice(), xmp.as_bytes()].concat());
    }
    if parts.mpf && !parts.mpf_first {
        segment(&mut j, 0xE2, &mpf_payload());
    }
    j.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x04, 0x00, 0x06, 0x03]);
    j.extend_from_slice(&[0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    j.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00]);
    j.extend_from_slice(&[0; 4096]);
    j.extend_from_slice(&[0xFF, 0xD9]);
    j
}

fn segment(j: &mut Vec<u8>, marker: u8, payload: &[u8]) {
    let len = (payload.len() + 2) as u16;
    j.extend_from_slice(&[0xFF, marker]);
    j.extend_from_slice(&len.to_be_bytes());
    j.extend_from_slice(payload);
}

/// Where the MP entries start inside the MPF TIFF block built below.
const MP_ENTRIES_AT: usize = 8 + 2 + 3 * 12 + 4;

/// "MPF\0" + a little-endian MP index with two entries: the primary image
/// (size 12345, offset 0) and a second image at offset 5000.
fn mpf_payload() -> Vec<u8> {
    let mut b = b"MPF\0II*\0".to_vec();
    b.extend_from_slice(&8u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes());
    let entry = |b: &mut Vec<u8>, tag: u16, typ: u16, count: u32, value: [u8; 4]| {
        b.extend_from_slice(&tag.to_le_bytes());
        b.extend_from_slice(&typ.to_le_bytes());
        b.extend_from_slice(&count.to_le_bytes());
        b.extend_from_slice(&value);
    };
    entry(&mut b, 0xB000, 7, 4, *b"0100");
    entry(&mut b, 0xB001, 4, 1, 2u32.to_le_bytes());
    entry(&mut b, 0xB002, 7, 32, (MP_ENTRIES_AT as u32).to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    for (attr, size, offset) in [(0x0003_0000u32, 12_345u32, 0u32), (0, 100, 5_000)] {
        b.extend_from_slice(&attr.to_le_bytes());
        b.extend_from_slice(&size.to_le_bytes());
        b.extend_from_slice(&offset.to_le_bytes());
        b.extend_from_slice(&[0, 0, 0, 0]);
    }
    b
}

/// (entry 0 size, entry 1 offset) of the MPF segment in `file`.
pub fn mpf_entries(file: &[u8]) -> (u32, u32) {
    let at = file.windows(4).position(|w| w == b"MPF\0").expect("an MPF segment") + 4;
    let u32_at = |i: usize| u32::from_le_bytes(file[i..i + 4].try_into().unwrap());
    (u32_at(at + MP_ENTRIES_AT + 4), u32_at(at + MP_ENTRIES_AT + 16 + 8))
}
