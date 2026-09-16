// exif_edit.rs — surgical changes to the EXIF block of a JPEG, as pure byte
// transforms (no IO): a new orientation, or a manual GPS position. Edits are
// append-only: nothing already in the block ever moves. A value that fits is
// patched where it is; otherwise a new copy of the IFD is appended at the end
// of the TIFF data and the one pointer to it is repointed, leaving the old
// copy as dead bytes. Maker notes, the IFD1 thumbnail and every other
// offset-based structure therefore stay valid without being understood.
//
// The caller gets an `Edit`: patches alone can be written in place; a splice
// (the Exif APP1 segment grew, or a new one is inserted) means rewriting the
// file. Growing APP1 shifts everything after it, so the MPF index that phones
// and some cameras append (gain maps, depth, previews) gets its primary-image
// size fixed up; its other offsets are relative to itself and move along.

use std::ops::Range;

/// A JPEG segment's payload is at most 65535 bytes minus its length field.
pub const MAX_SEGMENT_DATA: usize = 65533;

const EXIF_HEADER: &[u8] = b"Exif\0\0";
const XMP_HEADER: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const MPF_HEADER: &[u8] = b"MPF\0";

const TAG_ORIENTATION: u16 = 0x0112;
const TAG_GPS_IFD: u16 = 0x8825;
const TAG_GPS_VERSION: u16 = 0x0000;
const TAG_GPS_LAT_REF: u16 = 0x0001;
const TAG_GPS_LAT: u16 = 0x0002;
const TAG_GPS_LON_REF: u16 = 0x0003;
const TAG_GPS_LON: u16 = 0x0004;
const TAG_GPS_METHOD: u16 = 0x001B;
const TAG_MP_ENTRY: u16 = 0xB002;

const BYTE: u16 = 1;
const ASCII: u16 = 2;
const SHORT: u16 = 3;
const LONG: u16 = 4;
const RATIONAL: u16 = 5;
const UNDEFINED: u16 = 7;
const IFD: u16 = 13;

/// GPSProcessingMethod as the EXIF spec spells a manual fix: an 8-byte
/// character-code prefix, then the method name. Stacks recognises its own
/// earlier picks by it, so a new pick may replace them but never a camera's.
const MANUAL_METHOD: &[u8; 14] = b"ASCII\0\0\0MANUAL";

#[derive(Debug, PartialEq, Eq)]
pub enum EditError {
    NotJpeg,
    Malformed(&'static str),
    /// The grown Exif segment would exceed the 64 KB JPEG segment limit.
    TooLarge,
    /// An MPF index sits before the point that would grow; its offsets would break.
    MpfBeforeExif,
}

/// Overwrite `old` with `new` at absolute file offset `at`; the writer checks
/// `old` is still there, so a file that changed since it was read is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Patch {
    pub at: usize,
    pub old: Vec<u8>,
    pub new: Vec<u8>,
}

/// Replace file bytes `start..end` with `bytes` (`start == end` inserts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Splice {
    pub start: usize,
    pub end: usize,
    pub bytes: Vec<u8>,
}

/// Patches are in the original file's coordinates and never overlap the splice.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Edit {
    pub patches: Vec<Patch>,
    pub splice: Option<Splice>,
}

impl Edit {
    pub fn is_empty(&self) -> bool {
        self.patches.is_empty() && self.splice.is_none()
    }
}

pub enum GpsEdit {
    Write(Edit),
    /// The file already carries a position the camera recorded; it wins.
    KeepCamera,
}

/// Orientation after turning the displayed image `quarter_turns` × 90°
/// clockwise (negative turns go counter-clockwise). Each EXIF value is a
/// mirror flag plus k quarter turns, display = rot(k·90°) ∘ mirror, so a turn
/// only advances k. Unknown values are treated as 1.
pub fn compose_cw(orientation: u16, quarter_turns: i32) -> u16 {
    const PLAIN: [u16; 4] = [1, 6, 3, 8];
    const MIRRORED: [u16; 4] = [2, 7, 4, 5];
    let (ring, k) = [PLAIN, MIRRORED]
        .into_iter()
        .find_map(|ring| ring.iter().position(|&o| o == orientation).map(|k| (ring, k)))
        .unwrap_or((PLAIN, 0));
    ring[(k as i32 + quarter_turns).rem_euclid(4) as usize]
}

/// Turns the photo and returns the edit plus the orientation it writes.
pub fn rotate(file: &[u8], quarter_turns: i32) -> Result<(Edit, u16), EditError> {
    let jpeg = Jpeg::parse(file)?;
    let blank = blank_tiff();
    let block = jpeg.exif_block(&blank)?;
    let (change, orientation) = rotate_tiff(&block.tiff, quarter_turns)?;
    let mut edit = jpeg.edit_for(&block, change)?;
    if !edit.is_empty() {
        edit.patches.extend(jpeg.xmp_orientation(orientation));
    }
    jpeg.fix_mpf(&mut edit)?;
    edit.patches.retain(|p| p.old != p.new);
    Ok((edit, orientation))
}

/// Records `lat`/`lon` as a manual fix, unless the camera already recorded one.
pub fn set_gps(file: &[u8], lat: f64, lon: f64) -> Result<GpsEdit, EditError> {
    let jpeg = Jpeg::parse(file)?;
    let blank = blank_tiff();
    let block = jpeg.exif_block(&blank)?;
    let Some(change) = gps_tiff(&block.tiff, lat, lon)? else {
        return Ok(GpsEdit::KeepCamera);
    };
    let mut edit = jpeg.edit_for(&block, change)?;
    jpeg.fix_mpf(&mut edit)?;
    edit.patches.retain(|p| p.old != p.new);
    Ok(GpsEdit::Write(edit))
}

/// The edited file, for writers that rewrite rather than patch.
pub fn apply(file: &[u8], e: &Edit) -> Vec<u8> {
    let mut out = file.to_vec();
    for p in &e.patches {
        out[p.at..p.at + p.new.len()].copy_from_slice(&p.new);
    }
    if let Some(s) = &e.splice {
        out.splice(s.start..s.end, s.bytes.iter().copied());
    }
    out
}

// ---- TIFF-level edits ---------------------------------------------------------

/// What an edit does to the TIFF block: patches at TIFF-relative offsets, or a
/// whole new (grown) block.
enum TiffChange {
    None,
    Patches(Vec<(usize, Vec<u8>)>),
    Grown(Vec<u8>),
}

fn rotate_tiff(tiff: &Tiff, quarter_turns: i32) -> Result<(TiffChange, u16), EditError> {
    let order = tiff.order;
    let ifd0 = tiff.ifd(tiff.ifd0_offset())?;
    let entry = ifd0.find(TAG_ORIENTATION);
    let current = entry
        .and_then(|e| e.inline_uint(order))
        .filter(|o| (1..=8).contains(o))
        .unwrap_or(1) as u16;
    let next = compose_cw(current, quarter_turns);
    if next == current {
        return Ok((TiffChange::None, next));
    }
    if let Some(e) = entry.filter(|e| e.count == 1 && (e.typ == SHORT || e.typ == LONG)) {
        let bytes = if e.typ == SHORT { order.put16(next).to_vec() } else { order.put32(next as u32).to_vec() };
        return Ok((TiffChange::Patches(vec![(e.at + 8, bytes)]), next));
    }
    let mut grown = Growth::new(tiff.bytes);
    let orientation = RawEntry::new(TAG_ORIENTATION, SHORT, 1, pad4(&order.put16(next)));
    let ifd0_at = grown.append(&encode_ifd(order, &merge(&ifd0.entries, &[orientation]), ifd0.next));
    grown.put(4, &order.put32(ifd0_at as u32));
    Ok((TiffChange::Grown(grown.bytes), next))
}

/// `None` when the camera's own position must be kept.
fn gps_tiff(tiff: &Tiff, lat: f64, lon: f64) -> Result<Option<TiffChange>, EditError> {
    let order = tiff.order;
    let ifd0 = tiff.ifd(tiff.ifd0_offset())?;
    let pointer = ifd0.find(TAG_GPS_IFD);
    let existing = match pointer.and_then(|e| e.inline_uint(order)) {
        Some(offset) => Some(tiff.ifd(offset as usize)?),
        None => None,
    };
    if let Some(gps) = &existing {
        if gps_fix(tiff, gps) == Fix::Camera {
            return Ok(None);
        }
        if let Some(patches) = gps_in_place(tiff, gps, lat, lon) {
            return Ok(Some(TiffChange::Patches(patches)));
        }
    }

    let mut grown = Growth::new(tiff.bytes);
    let lat_at = grown.append(&dms(order, lat.abs()));
    let lon_at = grown.append(&dms(order, lon.abs()));
    let method_at = grown.append(MANUAL_METHOD);
    let ours = [
        RawEntry::new(TAG_GPS_VERSION, BYTE, 4, [2, 3, 0, 0]),
        RawEntry::new(TAG_GPS_LAT_REF, ASCII, 2, [lat_ref(lat), 0, 0, 0]),
        RawEntry::new(TAG_GPS_LAT, RATIONAL, 3, order.put32(lat_at as u32)),
        RawEntry::new(TAG_GPS_LON_REF, ASCII, 2, [lon_ref(lon), 0, 0, 0]),
        RawEntry::new(TAG_GPS_LON, RATIONAL, 3, order.put32(lon_at as u32)),
        RawEntry::new(TAG_GPS_METHOD, UNDEFINED, MANUAL_METHOD.len() as u32, order.put32(method_at as u32)),
    ];
    // Keep whatever else the old GPS IFD said (datum, a camera's empty
    // version tag); its values stay put, so their entries copy verbatim.
    let kept = existing.map(|i| i.entries).unwrap_or_default();
    let gps_at = grown.append(&encode_ifd(order, &merge(&kept, &ours), 0));
    match pointer.filter(|p| p.count == 1 && (p.typ == LONG || p.typ == IFD)) {
        Some(p) => grown.put(p.at + 8, &order.put32(gps_at as u32)),
        None => {
            let link = RawEntry::new(TAG_GPS_IFD, LONG, 1, order.put32(gps_at as u32));
            let ifd0_at = grown.append(&encode_ifd(order, &merge(&ifd0.entries, &[link]), ifd0.next));
            grown.put(4, &order.put32(ifd0_at as u32));
        }
    }
    Ok(Some(TiffChange::Grown(grown.bytes)))
}

#[derive(Debug, PartialEq, Eq)]
enum Fix {
    None,
    Manual,
    Camera,
}

/// A 0°/0° or unreadable position is no fix at all (phones write it when
/// they had none); a real one counts as the camera's unless marked MANUAL.
fn gps_fix(tiff: &Tiff, gps: &Ifd) -> Fix {
    let coord = |tag| {
        let e = gps.find(tag).filter(|e| e.typ == RATIONAL && e.count >= 3)?;
        let data = tiff.data(e)?;
        let r = |i: usize| {
            let num = tiff.order.u32(&data[i * 8..]) as f64;
            let den = tiff.order.u32(&data[i * 8 + 4..]) as f64;
            (den != 0.0).then(|| num / den)
        };
        Some(r(0)? + r(1)? / 60.0 + r(2)? / 3600.0)
    };
    let (Some(lat), Some(lon)) = (coord(TAG_GPS_LAT), coord(TAG_GPS_LON)) else { return Fix::None };
    if !(lat.abs() <= 90.0 && lon.abs() <= 180.0) || (lat == 0.0 && lon == 0.0) {
        return Fix::None;
    }
    let manual = gps
        .find(TAG_GPS_METHOD)
        .and_then(|e| tiff.data(e))
        .map(|b| {
            let text = trim_end(b);
            text.len() >= 6 && text[text.len() - 6..].eq_ignore_ascii_case(b"MANUAL")
        })
        .unwrap_or(false);
    if manual {
        Fix::Manual
    } else {
        Fix::Camera
    }
}

/// Overwrites a GPS IFD laid out exactly like the ones Stacks writes (so a
/// second pick costs a few bytes, not a file rewrite); `None` otherwise.
fn gps_in_place(tiff: &Tiff, gps: &Ifd, lat: f64, lon: f64) -> Option<Vec<(usize, Vec<u8>)>> {
    let order = tiff.order;
    let slot = |tag, typ, count: u32| gps.find(tag).filter(|e| e.typ == typ && e.count == count);
    let lat_ref_e = slot(TAG_GPS_LAT_REF, ASCII, 2)?;
    let lat_e = slot(TAG_GPS_LAT, RATIONAL, 3)?;
    let lon_ref_e = slot(TAG_GPS_LON_REF, ASCII, 2)?;
    let lon_e = slot(TAG_GPS_LON, RATIONAL, 3)?;
    let method_e = slot(TAG_GPS_METHOD, UNDEFINED, MANUAL_METHOD.len() as u32)?;
    let lat_at = tiff.data_range(lat_e)?.start;
    let lon_at = tiff.data_range(lon_e)?.start;
    let method_at = tiff.data_range(method_e)?.start;
    Some(vec![
        (lat_ref_e.at + 8, vec![lat_ref(lat), 0]),
        (lat_at, dms(order, lat.abs()).to_vec()),
        (lon_ref_e.at + 8, vec![lon_ref(lon), 0]),
        (lon_at, dms(order, lon.abs()).to_vec()),
        (method_at, MANUAL_METHOD.to_vec()),
    ])
}

fn lat_ref(lat: f64) -> u8 {
    if lat < 0.0 { b'S' } else { b'N' }
}

fn lon_ref(lon: f64) -> u8 {
    if lon < 0.0 { b'W' } else { b'E' }
}

/// Degrees, minutes, seconds as three RATIONALs; seconds to 1/10⁴″ (≈3 mm).
fn dms(order: Order, degrees: f64) -> [u8; 24] {
    let mut d = degrees.trunc() as u32;
    let minutes = (degrees - d as f64) * 60.0;
    let mut m = minutes.trunc() as u32;
    let mut s = ((minutes - m as f64) * 60.0 * 10_000.0).round() as u32;
    if s >= 600_000 {
        s -= 600_000;
        m += 1;
    }
    if m >= 60 {
        m -= 60;
        d += 1;
    }
    let mut out = [0u8; 24];
    for (i, (num, den)) in [(d, 1), (m, 1), (s, 10_000)].into_iter().enumerate() {
        out[i * 8..i * 8 + 4].copy_from_slice(&order.put32(num));
        out[i * 8 + 4..i * 8 + 8].copy_from_slice(&order.put32(den));
    }
    out
}

fn trim_end(b: &[u8]) -> &[u8] {
    let end = b.iter().rposition(|&c| c != 0 && c != b' ').map_or(0, |i| i + 1);
    &b[..end]
}

/// A file without EXIF edits a blank, big-endian TIFF block holding an empty
/// IFD0; the grown block is then inserted as a new APP1.
fn blank_tiff() -> Vec<u8> {
    let mut b = b"MM\0*".to_vec();
    b.extend_from_slice(&8u32.to_be_bytes());
    b.extend_from_slice(&[0, 0, 0, 0, 0, 0]); // no entries, no next IFD
    b
}

/// A TIFF block being grown: the original bytes, then appended structures,
/// each starting on an even offset as TIFF requires.
struct Growth {
    bytes: Vec<u8>,
}

impl Growth {
    fn new(tiff: &[u8]) -> Self {
        Growth { bytes: tiff.to_vec() }
    }

    fn append(&mut self, data: &[u8]) -> usize {
        if self.bytes.len() % 2 == 1 {
            self.bytes.push(0);
        }
        let at = self.bytes.len();
        self.bytes.extend_from_slice(data);
        at
    }

    fn put(&mut self, at: usize, data: &[u8]) {
        self.bytes[at..at + data.len()].copy_from_slice(data);
    }
}

/// `base` minus any tag in `ours`, plus `ours`, in ascending tag order.
fn merge(base: &[RawEntry], ours: &[RawEntry]) -> Vec<RawEntry> {
    let mut all: Vec<RawEntry> = base.iter().filter(|e| ours.iter().all(|o| o.tag != e.tag)).cloned().collect();
    all.extend_from_slice(ours);
    all.sort_by_key(|e| e.tag);
    all
}

fn encode_ifd(order: Order, entries: &[RawEntry], next: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(2 + entries.len() * 12 + 4);
    out.extend_from_slice(&order.put16(entries.len() as u16));
    for e in entries {
        out.extend_from_slice(&order.put16(e.tag));
        out.extend_from_slice(&order.put16(e.typ));
        out.extend_from_slice(&order.put32(e.count));
        out.extend_from_slice(&e.value);
    }
    out.extend_from_slice(&order.put32(next));
    out
}

fn pad4(b: &[u8; 2]) -> [u8; 4] {
    [b[0], b[1], 0, 0]
}

// ---- TIFF reading ---------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Order {
    Little,
    Big,
}

impl Order {
    fn u16(self, b: &[u8]) -> u16 {
        let a = [b[0], b[1]];
        match self {
            Order::Little => u16::from_le_bytes(a),
            Order::Big => u16::from_be_bytes(a),
        }
    }

    fn u32(self, b: &[u8]) -> u32 {
        let a = [b[0], b[1], b[2], b[3]];
        match self {
            Order::Little => u32::from_le_bytes(a),
            Order::Big => u32::from_be_bytes(a),
        }
    }

    fn put16(self, v: u16) -> [u8; 2] {
        match self {
            Order::Little => v.to_le_bytes(),
            Order::Big => v.to_be_bytes(),
        }
    }

    fn put32(self, v: u32) -> [u8; 4] {
        match self {
            Order::Little => v.to_le_bytes(),
            Order::Big => v.to_be_bytes(),
        }
    }
}

/// One 12-byte IFD entry, value field kept raw; `at` is the entry's offset in
/// the TIFF block (the value field is at `at + 8`).
#[derive(Clone, Debug)]
struct RawEntry {
    tag: u16,
    typ: u16,
    count: u32,
    value: [u8; 4],
    at: usize,
}

impl RawEntry {
    fn new(tag: u16, typ: u16, count: u32, value: [u8; 4]) -> Self {
        RawEntry { tag, typ, count, value, at: 0 }
    }

    /// A SHORT/LONG/IFD count-1 value held inline.
    fn inline_uint(&self, order: Order) -> Option<u32> {
        match (self.typ, self.count) {
            (SHORT, 1) => Some(order.u16(&self.value) as u32),
            (LONG | IFD, 1) => Some(order.u32(&self.value)),
            _ => None,
        }
    }
}

struct Ifd {
    entries: Vec<RawEntry>,
    next: u32,
}

impl Ifd {
    fn find(&self, tag: u16) -> Option<&RawEntry> {
        self.entries.iter().find(|e| e.tag == tag)
    }
}

struct Tiff<'a> {
    bytes: &'a [u8],
    order: Order,
}

impl<'a> Tiff<'a> {
    fn parse(bytes: &'a [u8]) -> Result<Self, EditError> {
        let order = match bytes.get(..4) {
            Some(b"II*\0") => Order::Little,
            Some(b"MM\0*") => Order::Big,
            _ => return Err(EditError::Malformed("not a TIFF header")),
        };
        if bytes.len() < 8 {
            return Err(EditError::Malformed("truncated TIFF header"));
        }
        Ok(Tiff { bytes, order })
    }

    fn ifd0_offset(&self) -> usize {
        self.order.u32(&self.bytes[4..]) as usize
    }

    fn ifd(&self, offset: usize) -> Result<Ifd, EditError> {
        let b = self.bytes;
        let count_end = offset.checked_add(2).filter(|&e| e <= b.len()).ok_or(EditError::Malformed("IFD out of range"))?;
        let count = self.order.u16(&b[offset..count_end]) as usize;
        let end = count_end + count * 12 + 4;
        if end > b.len() {
            return Err(EditError::Malformed("IFD runs past the EXIF block"));
        }
        let entries = (0..count)
            .map(|i| {
                let at = count_end + i * 12;
                RawEntry {
                    tag: self.order.u16(&b[at..]),
                    typ: self.order.u16(&b[at + 2..]),
                    count: self.order.u32(&b[at + 4..]),
                    value: [b[at + 8], b[at + 9], b[at + 10], b[at + 11]],
                    at,
                }
            })
            .collect();
        Ok(Ifd { entries, next: self.order.u32(&b[end - 4..]) })
    }

    /// Where an entry's value lives: inline when it fits in 4 bytes, else at
    /// its offset. `None` for unknown types or out-of-range data.
    fn data_range(&self, e: &RawEntry) -> Option<Range<usize>> {
        let unit = match e.typ {
            BYTE | ASCII | UNDEFINED | 6 => 1,
            SHORT | 8 => 2,
            LONG | 9 | 11 | IFD => 4,
            RATIONAL | 10 | 12 => 8,
            _ => return None,
        };
        let len = unit * e.count as usize;
        let start = if len <= 4 { e.at + 8 } else { self.order.u32(&e.value) as usize };
        let end = start.checked_add(len)?;
        (end <= self.bytes.len()).then_some(start..end)
    }

    fn data(&self, e: &RawEntry) -> Option<&'a [u8]> {
        self.data_range(e).map(|r| &self.bytes[r])
    }
}

// ---- JPEG structure ---------------------------------------------------------------

struct Segment {
    marker: u8,
    /// Offset of the segment's first 0xFF.
    start: usize,
    /// The payload, after the length field; `data.end` is the segment's end.
    data: Range<usize>,
}

/// The TIFF block an edit works on: the file's own, or a blank one to insert.
struct Block<'a> {
    tiff: Tiff<'a>,
    /// The Exif APP1 it came from; `None` for the blank.
    segment: Option<&'a Segment>,
}

struct Jpeg<'a> {
    file: &'a [u8],
    segments: Vec<Segment>,
}

impl<'a> Jpeg<'a> {
    /// Walks the marker segments up to the image data. Checks the magic
    /// bytes rather than the extension: phones write HEIC named `.jpg`.
    fn parse(file: &'a [u8]) -> Result<Self, EditError> {
        if file.len() < 4 || file[..3] != [0xFF, 0xD8, 0xFF] {
            return Err(EditError::NotJpeg);
        }
        let mut segments = Vec::new();
        let mut pos = 2;
        loop {
            if file.get(pos) != Some(&0xFF) {
                return Err(EditError::Malformed("expected a JPEG marker"));
            }
            let mut m = pos + 1;
            while file.get(m) == Some(&0xFF) {
                m += 1; // fill bytes
            }
            let marker = *file.get(m).ok_or(EditError::Malformed("truncated JPEG"))?;
            match marker {
                0xDA | 0xD9 => break, // start of scan / end of image: metadata is over
                0x01 | 0xD0..=0xD7 => {
                    pos = m + 1;
                    continue;
                }
                _ => {}
            }
            let len_bytes = file.get(m + 1..m + 3).ok_or(EditError::Malformed("truncated JPEG"))?;
            let len = u16::from_be_bytes([len_bytes[0], len_bytes[1]]) as usize;
            let end = m + 1 + len;
            if len < 2 || end > file.len() {
                return Err(EditError::Malformed("JPEG segment runs past the end"));
            }
            segments.push(Segment { marker, start: pos, data: m + 3..end });
            pos = end;
        }
        Ok(Jpeg { file, segments })
    }

    fn find(&self, marker: u8, header: &[u8]) -> Option<&Segment> {
        self.segments.iter().find(|s| s.marker == marker && self.file[s.data.clone()].starts_with(header))
    }

    /// The first Exif APP1, the one every reader uses; else a blank block.
    fn exif_block<'b>(&'b self, blank: &'b [u8]) -> Result<Block<'b>, EditError> {
        match self.find(0xE1, EXIF_HEADER) {
            Some(seg) => Ok(Block { tiff: Tiff::parse(&self.file[seg.data.start + EXIF_HEADER.len()..seg.data.end])?, segment: Some(seg) }),
            None => Ok(Block { tiff: Tiff::parse(blank)?, segment: None }),
        }
    }

    /// A new APP1 goes after a leading JFIF/JFXX APP0 (which JFIF insists
    /// comes first), otherwise straight after SOI.
    fn insertion_point(&self) -> usize {
        self.segments
            .iter()
            .take_while(|s| {
                let d = &self.file[s.data.clone()];
                s.marker == 0xE0 && (d.starts_with(b"JFIF\0") || d.starts_with(b"JFXX\0"))
            })
            .last()
            .map_or(2, |s| s.data.end)
    }

    fn edit_for(&self, block: &Block, change: TiffChange) -> Result<Edit, EditError> {
        let mut edit = Edit::default();
        match change {
            TiffChange::None => {}
            TiffChange::Patches(patches) => {
                let seg = block.segment.ok_or(EditError::Malformed("patch without an Exif segment"))?;
                let base = seg.data.start + EXIF_HEADER.len();
                for (rel, new) in patches {
                    let at = base + rel;
                    edit.patches.push(Patch { at, old: self.file[at..at + new.len()].to_vec(), new });
                }
            }
            TiffChange::Grown(tiff) => {
                let data_len = EXIF_HEADER.len() + tiff.len();
                if data_len > MAX_SEGMENT_DATA {
                    return Err(EditError::TooLarge);
                }
                let mut bytes = vec![0xFF, 0xE1];
                bytes.extend_from_slice(&((data_len + 2) as u16).to_be_bytes());
                bytes.extend_from_slice(EXIF_HEADER);
                bytes.extend_from_slice(&tiff);
                edit.splice = Some(match block.segment {
                    Some(seg) => Splice { start: seg.start, end: seg.data.end, bytes },
                    None => {
                        let at = self.insertion_point();
                        Splice { start: at, end: at, bytes }
                    }
                });
            }
        }
        Ok(edit)
    }

    /// An XMP packet may carry its own `tiff:Orientation`, which some apps
    /// prefer over EXIF; its single digit is patched to agree.
    fn xmp_orientation(&self, orientation: u16) -> Option<Patch> {
        let seg = self.find(0xE1, XMP_HEADER)?;
        let data = &self.file[seg.data.clone()];
        for pattern in [&b"tiff:Orientation=\""[..], b"tiff:Orientation='", b"<tiff:Orientation>"] {
            let Some(i) = find_bytes(data, pattern) else { continue };
            let at = i + pattern.len();
            let digit = *data.get(at)?;
            let closed = matches!(data.get(at + 1), Some(b'"' | b'\'' | b'<'));
            if (b'1'..=b'8').contains(&digit) && closed {
                return Some(Patch { at: seg.data.start + at, old: vec![digit], new: vec![b'0' + orientation as u8] });
            }
        }
        None
    }

    /// Growing the primary image grows MP entry 0's size. Every other MPF
    /// offset is relative to the MPF header, which moves with the images it
    /// points at, unless the growth happens after that header.
    fn fix_mpf(&self, edit: &mut Edit) -> Result<(), EditError> {
        let Some(splice) = &edit.splice else { return Ok(()) };
        let delta = splice.bytes.len() as i64 - (splice.end - splice.start) as i64;
        let Some(mpf) = self.find(0xE2, MPF_HEADER) else { return Ok(()) };
        if delta == 0 {
            return Ok(());
        }
        if mpf.start < splice.start {
            return Err(EditError::MpfBeforeExif);
        }
        let base = mpf.data.start + MPF_HEADER.len();
        let tiff = Tiff::parse(&self.file[base..mpf.data.end]).map_err(|_| EditError::Malformed("unreadable MPF index"))?;
        let index = tiff.ifd(tiff.ifd0_offset())?;
        let entries = index
            .find(TAG_MP_ENTRY)
            .filter(|e| e.typ == UNDEFINED && e.count >= 16)
            .and_then(|e| tiff.data_range(e))
            .ok_or(EditError::Malformed("MPF index without entries"))?;
        let at = entries.start + 4; // entry 0: attribute, then size
        let old = tiff.order.u32(&tiff.bytes[at..]);
        let new = u32::try_from(old as i64 + delta).map_err(|_| EditError::Malformed("MPF size out of range"))?;
        edit.patches.push(Patch { at: base + at, old: tiff.order.put32(old).to_vec(), new: tiff.order.put32(new).to_vec() });
        Ok(())
    }
}

fn find_bytes(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::meta::read_meta;
    use crate::testkit::{self, JpegParts};
    use exif::{In, Reader, Tag, Value};
    use std::io::Cursor;

    fn read(file: &[u8]) -> exif::Exif {
        Reader::new().read_from_container(&mut Cursor::new(file)).expect("kamadak reads the edited file")
    }

    fn orientation(file: &[u8]) -> u32 {
        read(file).get_field(Tag::Orientation, In::PRIMARY).and_then(|f| f.value.get_uint(0)).unwrap()
    }

    fn written(e: GpsEdit) -> Edit {
        match e {
            GpsEdit::Write(e) => e,
            GpsEdit::KeepCamera => panic!("expected a write"),
        }
    }

    /// Byte offset of the Exif TIFF block and its length.
    fn tiff_span(file: &[u8]) -> Range<usize> {
        let jpeg = Jpeg::parse(file).unwrap();
        let seg = jpeg.find(0xE1, EXIF_HEADER).unwrap();
        seg.data.start + EXIF_HEADER.len()..seg.data.end
    }

    #[test]
    fn composition_follows_the_exif_rings() {
        let cw: Vec<u16> = (1..=8).map(|o| compose_cw(o, 1)).collect();
        assert_eq!(cw, vec![6, 7, 8, 5, 2, 3, 4, 1]);
        for o in 1..=8 {
            assert_eq!(compose_cw(o, 4), o);
            assert_eq!(compose_cw(compose_cw(o, 1), -1), o);
        }
        assert_eq!(compose_cw(0, 1), 6, "unknown values count as upright");
    }

    #[test]
    fn rotation_patches_two_bytes_and_four_turns_round_trip() {
        for little in [false, true] {
            let original = testkit::jpeg(Some(&testkit::lisbon_exif(little)));
            let mut file = original.clone();
            let mut seen = vec![];
            for _ in 0..4 {
                let (edit, o) = rotate(&file, 1).unwrap();
                assert!(edit.splice.is_none());
                assert_eq!(edit.patches.len(), 1);
                assert_eq!(edit.patches[0].new.len(), 2);
                let next = apply(&file, &edit);
                let changed = next.iter().zip(&file).filter(|(a, b)| a != b).count();
                assert!(changed <= 2 && next.len() == file.len());
                assert_eq!(orientation(&next), o as u32);
                seen.push(o);
                file = next;
            }
            assert_eq!(seen, vec![3, 8, 1, 6]);
            assert_eq!(file, original);
        }
    }

    #[test]
    fn missing_orientation_relocates_ifd0_without_moving_anything() {
        for little in [false, true] {
            let thumb = testkit::jpeg(None);
            let maker = testkit::maker_note();
            let tiff = testkit::exif_tiff(&testkit::camera_fields(false), little, Some(&thumb), Some(&maker));
            let file = testkit::jpeg(Some(&tiff));
            let (edit, o) = rotate(&file, 1).unwrap();
            assert_eq!(o, 6);
            assert!(edit.splice.is_some());
            let next = apply(&file, &edit);

            let old = &file[tiff_span(&file)];
            let new = &next[tiff_span(&next)];
            assert_eq!(&new[..4], &old[..4], "byte order kept");
            assert_eq!(&new[8..old.len()], &old[8..], "no existing byte moved");

            let exif = read(&next);
            assert_eq!(exif.get_field(Tag::Orientation, In::PRIMARY).unwrap().value.get_uint(0), Some(6));
            let Value::Ascii(make) = &exif.get_field(Tag::Make, In::PRIMARY).unwrap().value else { panic!() };
            assert_eq!(make[0], b"FUJIFILM");
            let Value::Undefined(note, _) = &exif.get_field(Tag::MakerNote, In::PRIMARY).unwrap().value else { panic!() };
            assert_eq!(note, &maker);
            assert!(exif.get_field(Tag::JPEGInterchangeFormat, In::THUMBNAIL).is_some(), "IFD1 still linked");
            assert!(exif.get_field(Tag::DateTimeOriginal, In::PRIMARY).is_some());
        }
    }

    #[test]
    fn a_file_without_exif_gets_a_new_segment_after_jfif() {
        let file = testkit::jpeg_with(JpegParts { jfif: true, ..Default::default() });
        let (edit, o) = rotate(&file, 1).unwrap();
        assert_eq!(o, 6);
        let splice = edit.splice.clone().unwrap();
        assert_eq!(splice.start, splice.end, "an insertion");
        let next = apply(&file, &edit);
        let jpeg = Jpeg::parse(&next).unwrap();
        assert_eq!(jpeg.segments[0].marker, 0xE0);
        assert!(next[jpeg.segments[0].data.clone()].starts_with(b"JFIF\0"));
        assert_eq!(jpeg.segments[1].marker, 0xE1);
        assert_eq!(orientation(&next), 6);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plain.jpg");
        std::fs::write(&path, &next).unwrap();
        let meta = read_meta(&path, 1_730_815_401_000);
        assert_eq!(meta.orientation, 6);
        assert!((meta.aspect.unwrap() - 4.0 / 6.0).abs() < 1e-9);
    }

    #[test]
    fn gps_is_added_and_reads_back() {
        for little in [false, true] {
            for (lat, lon) in [(38.80097, -9.37826), (-33.86785, 151.20732)] {
                let tiff = testkit::exif_tiff(&testkit::camera_fields(true), little, None, None);
                let file = testkit::jpeg(Some(&tiff));
                let next = apply(&file, &written(set_gps(&file, lat, lon).unwrap()));
                let dir = tempfile::tempdir().unwrap();
                let path = dir.path().join("DSCF0002.JPG");
                std::fs::write(&path, &next).unwrap();
                let gps = read_meta(&path, 0).gps.expect("gps reads back");
                assert!((gps.lat - lat).abs() < 1e-6 && (gps.lon - lon).abs() < 1e-6, "{gps:?}");
                let exif = read(&next);
                let method = exif.get_field(Tag::GPSProcessingMethod, In::PRIMARY).unwrap();
                let Value::Undefined(bytes, _) = &method.value else { panic!() };
                assert_eq!(bytes.as_slice(), MANUAL_METHOD);
                assert_eq!(exif.get_field(Tag::Orientation, In::PRIMARY).unwrap().value.get_uint(0), Some(1));
            }
        }
    }

    #[test]
    fn gps_on_a_file_without_exif() {
        let file = testkit::jpeg(None);
        let next = apply(&file, &written(set_gps(&file, 41.14961, -8.61099).unwrap()));
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.jpg");
        std::fs::write(&path, &next).unwrap();
        let gps = read_meta(&path, 0).gps.unwrap();
        assert!((gps.lat - 41.14961).abs() < 1e-6);
    }

    #[test]
    fn camera_gps_is_kept_and_a_manual_pick_is_replaced_in_place() {
        let camera = testkit::jpeg(Some(&testkit::lisbon_exif(false)));
        assert!(matches!(set_gps(&camera, 41.0, -8.0).unwrap(), GpsEdit::KeepCamera));

        let plain = testkit::jpeg(Some(&testkit::exif_tiff(&testkit::camera_fields(true), true, None, None)));
        let first = apply(&plain, &written(set_gps(&plain, 38.8, -9.37).unwrap()));
        let again = written(set_gps(&first, 41.15, 8.61).unwrap());
        assert!(again.splice.is_none(), "a second pick is patched in place");
        let second = apply(&first, &again);
        assert_eq!(second.len(), first.len());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("y.jpg");
        std::fs::write(&path, &second).unwrap();
        let gps = read_meta(&path, 0).gps.unwrap();
        assert!((gps.lat - 41.15).abs() < 1e-6 && (gps.lon - 8.61).abs() < 1e-6, "{gps:?}");
    }

    #[test]
    fn an_exif_segment_near_64k_is_refused() {
        // Size the maker note so the segment sits 20 bytes under the limit.
        let probe = testkit::exif_tiff(&testkit::camera_fields(false), false, None, Some(&[0; 1000]));
        let note = vec![0x42; MAX_SEGMENT_DATA - EXIF_HEADER.len() - (probe.len() - 1000) - 20];
        let tiff = testkit::exif_tiff(&testkit::camera_fields(false), false, None, Some(&note));
        assert!(EXIF_HEADER.len() + tiff.len() <= MAX_SEGMENT_DATA);
        let file = testkit::jpeg(Some(&tiff));
        assert_eq!(rotate(&file, 1).unwrap_err(), EditError::TooLarge);
        // An in-place patch still fits.
        let with_orientation = testkit::jpeg(Some(&testkit::exif_tiff(&testkit::camera_fields(true), false, None, Some(&note[..note.len() - 12]))));
        assert!(rotate(&with_orientation, 1).unwrap().0.splice.is_none());
    }

    #[test]
    fn growth_updates_the_mpf_primary_size_but_not_later_offsets() {
        let tiff = testkit::exif_tiff(&testkit::camera_fields(true), false, None, None);
        let file = testkit::jpeg_with(JpegParts { exif: Some(tiff), mpf: true, ..Default::default() });
        let edit = written(set_gps(&file, 38.8, -9.37).unwrap());
        let splice = edit.splice.clone().unwrap();
        let delta = (splice.bytes.len() - (splice.end - splice.start)) as u32;
        let next = apply(&file, &edit);
        let (size0, offset1) = testkit::mpf_entries(&file);
        let (size0_new, offset1_new) = testkit::mpf_entries(&next);
        assert_eq!(size0_new, size0 + delta);
        assert_eq!(offset1_new, offset1);
    }

    #[test]
    fn mpf_before_the_exif_segment_blocks_growth() {
        let tiff = testkit::exif_tiff(&testkit::camera_fields(true), false, None, None);
        let file = testkit::jpeg_with(JpegParts { exif: Some(tiff), mpf: true, mpf_first: true, ..Default::default() });
        assert!(matches!(set_gps(&file, 38.8, -9.37), Err(EditError::MpfBeforeExif)));
    }

    #[test]
    fn xmp_orientation_digit_follows() {
        let file = testkit::jpeg_with(JpegParts {
            exif: Some(testkit::lisbon_exif(false)),
            xmp: Some(r#"<x:xmpmeta><rdf:Description tiff:Orientation="6"/></x:xmpmeta>"#.into()),
            ..Default::default()
        });
        let (edit, o) = rotate(&file, 1).unwrap();
        assert_eq!(o, 3);
        assert_eq!(edit.patches.len(), 2);
        let next = apply(&file, &edit);
        assert!(find_bytes(&next, br#"tiff:Orientation="3""#).is_some());
    }

    #[test]
    fn non_jpeg_bytes_are_refused() {
        assert_eq!(rotate(b"\x89PNG\r\n\x1a\n....", 1).unwrap_err(), EditError::NotJpeg);
        assert!(matches!(set_gps(b"\0\0\0\x18ftypheic", 1.0, 1.0), Err(EditError::NotJpeg)));
    }

    #[test]
    fn dms_carries_rounded_seconds() {
        let b = dms(Order::Big, 10.999_999_99);
        let r = |i: usize| (u32::from_be_bytes(b[i * 8..i * 8 + 4].try_into().unwrap()), u32::from_be_bytes(b[i * 8 + 4..i * 8 + 8].try_into().unwrap()));
        assert_eq!(r(0), (11, 1));
        assert_eq!(r(1), (0, 1));
        assert_eq!(r(2), (0, 10_000));
    }
}
