//! The shooting scenario: which photos exist, when and where they were taken,
//! and which quirks each one carries. Everything here is pure data, built
//! deterministically, so a regenerated card is byte-identical to the last one
//! and tests can use the scenario itself as the oracle.
//!
//! Shape of the trip (see `PLANS`): six shooting days between 28 Oct and
//! 5 Nov 2024, one to three sessions per day, sessions normally more than 3 h
//! apart. Two gaps sit deliberately on either side of the app's default 3 h
//! stack threshold: 2 h 50 m (same stack) and 3 h 10 m (new stack). Cluster A
//! is Lisbon, cluster B is Porto; iPhone shots carry no GPS at all.

use std::fmt;

/// Wall-clock capture time with no zone attached, exactly like EXIF
/// `DateTimeOriginal`. Stored as seconds since 1970-01-01T00:00:00 of that
/// same zone-less clock, which makes gap arithmetic trivial.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Timestamp(i64);

impl Timestamp {
    pub fn civil(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> Self {
        let days = days_from_civil(year as i64, month as i64, day as i64);
        Timestamp(days * 86_400 + i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second))
    }

    pub fn plus_seconds(self, seconds: i64) -> Self {
        Timestamp(self.0 + seconds)
    }

    /// Seconds from `earlier` to `self` (negative if `self` is earlier).
    pub fn seconds_since(self, earlier: Timestamp) -> i64 {
        self.0 - earlier.0
    }

    /// (year, month, day, hour, minute, second)
    pub fn parts(self) -> (i32, u32, u32, u32, u32, u32) {
        let days = self.0.div_euclid(86_400);
        let secs = self.0.rem_euclid(86_400) as u32;
        let (y, m, d) = civil_from_days(days);
        (y as i32, m as u32, d as u32, secs / 3_600, secs % 3_600 / 60, secs % 60)
    }

    /// `YYYY:MM:DD HH:MM:SS`, the EXIF ASCII date format.
    pub fn exif(self) -> String {
        let (y, mo, d, h, mi, s) = self.parts();
        format!("{y:04}:{mo:02}:{d:02} {h:02}:{mi:02}:{s:02}")
    }

    /// `YYYY-MM-DDTHH:MM:SS`, the app's `takenAt` format.
    pub fn iso(self) -> String {
        let (y, mo, d, h, mi, s) = self.parts();
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}")
    }

    /// `YYYY-MM-DD`
    pub fn date(self) -> String {
        let (y, mo, d, ..) = self.parts();
        format!("{y:04}-{mo:02}-{d:02}")
    }

    /// `HH:MM:SS`
    pub fn time(self) -> String {
        let (_, _, _, h, mi, s) = self.parts();
        format!("{h:02}:{mi:02}:{s:02}")
    }

    /// The Unix epoch instant at which this machine's local clock shows this
    /// wall-clock time. This is what a camera's FAT timestamp becomes when
    /// macOS mounts the card, so it is the right mtime for EXIF-less files.
    pub fn local_epoch(self) -> i64 {
        let (y, mo, d, h, mi, s) = self.parts();
        // SAFETY: `tm` is plain data; zeroed pointers inside it (tm_zone) are
        // ignored by mktime, and tm_isdst = -1 asks libc to resolve DST itself.
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        tm.tm_year = y - 1900;
        tm.tm_mon = mo as i32 - 1;
        tm.tm_mday = d as i32;
        tm.tm_hour = h as i32;
        tm.tm_min = mi as i32;
        tm.tm_sec = s as i32;
        tm.tm_isdst = -1;
        i64::from(unsafe { libc::mktime(&mut tm) })
    }
}

// Howard Hinnant's proleptic-Gregorian day arithmetic.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (y + i64::from(m <= 2), m, d)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Camera {
    FujiXT5,
    SonyA7IV,
    CanonR6,
    IPhone15Pro,
}

impl Camera {
    pub fn make(self) -> &'static str {
        match self {
            Camera::FujiXT5 => "FUJIFILM",
            Camera::SonyA7IV => "SONY",
            Camera::CanonR6 => "Canon",
            Camera::IPhone15Pro => "Apple",
        }
    }

    pub fn model(self) -> &'static str {
        match self {
            Camera::FujiXT5 => "X-T5",
            Camera::SonyA7IV => "ILCE-7M4",
            Camera::CanonR6 => "Canon EOS R6",
            Camera::IPhone15Pro => "iPhone 15 Pro",
        }
    }

    /// Short tag used in the manifest.
    pub fn label(self) -> &'static str {
        match self {
            Camera::FujiXT5 => "FUJI",
            Camera::SonyA7IV => "SONY",
            Camera::CanonR6 => "CANON",
            Camera::IPhone15Pro => "IPHONE",
        }
    }

    fn dir(self) -> &'static str {
        match self {
            Camera::FujiXT5 => "DCIM/100FUJI",
            Camera::SonyA7IV => "DCIM/101SONY",
            Camera::CanonR6 => "DCIM/102CANON",
            Camera::IPhone15Pro => "local/Pictures/2024-11",
        }
    }

    /// The camera's own file counter starts here.
    fn first_number(self) -> u32 {
        match self {
            Camera::IPhone15Pro => 1001,
            _ => 1,
        }
    }

    fn stem(self, number: u32) -> String {
        match self {
            Camera::FujiXT5 => format!("DSCF{number:04}"),
            Camera::SonyA7IV => format!("DSC{number:05}"),
            Camera::CanonR6 => format!("IMG_{number:04}"),
            Camera::IPhone15Pro => format!("IMG_{number:04}"),
        }
    }

    fn raw_ext(self) -> Option<&'static str> {
        match self {
            Camera::FujiXT5 => Some("RAF"),
            Camera::SonyA7IV => Some("ARW"),
            Camera::CanonR6 => Some("CR3"),
            Camera::IPhone15Pro => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Place {
    Lisbon,
    Porto,
}

impl Place {
    /// (latitude, longitude) of the cluster centre; jitter is ±`GPS_JITTER`.
    pub fn centre(self) -> (f64, f64) {
        match self {
            Place::Lisbon => (38.7223, -9.1393),
            Place::Porto => (41.1579, -8.6291),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Place::Lisbon => "lisbon",
            Place::Porto => "porto",
        }
    }
}

pub const GPS_JITTER: f64 = 0.02;
pub const MIN_SPACING_SECS: i64 = 40;
pub const MAX_SPACING_SECS: i64 = 90;

#[derive(Clone, Debug)]
pub struct Session {
    /// 1-based, in capture order.
    pub number: usize,
    pub camera: Camera,
    pub place: Option<Place>,
    pub first: Timestamp,
    pub last: Timestamp,
    pub count: u32,
    /// Seconds between the previous session's last photo and this one's first.
    pub gap_from_previous: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct Photo {
    /// 1-based running index in capture order; 0 for decoys.
    pub index: u32,
    /// 1-based session number; `None` for decoys outside any session.
    pub session: Option<usize>,
    pub camera: Camera,
    /// Path relative to the card root; `None` for RAW-only shots.
    pub jpeg: Option<String>,
    /// Path of the RAW twin relative to the card root.
    pub raw: Option<String>,
    pub taken_at: Timestamp,
    /// `SubSecTimeOriginal`, 0–99.
    pub subsec: u8,
    /// (latitude, longitude), signed.
    pub gps: Option<(f64, f64)>,
    /// EXIF orientation: 1 = as stored, 6 = rotate 90° clockwise to display.
    pub orientation: u16,
    /// `false` for the files that carry no APP1 segment at all.
    pub has_exif: bool,
    /// Pixel shape: 400×600 instead of 600×400.
    pub portrait: bool,
}

impl Photo {
    /// The path the app will treat as the photo: the JPEG, else the RAW.
    pub fn primary(&self) -> &str {
        self.jpeg.as_deref().or(self.raw.as_deref()).expect("a photo has at least one file")
    }
}

#[derive(Clone, Debug)]
pub struct Scenario {
    pub sessions: Vec<Session>,
    /// Session photos in capture order, then the decoys.
    pub photos: Vec<Photo>,
}

impl Scenario {
    pub fn build() -> Scenario {
        Builder::new().run()
    }

    /// Photos that belong to a session (everything except decoys).
    pub fn shots(&self) -> impl Iterator<Item = &Photo> {
        self.photos.iter().filter(|p| p.session.is_some())
    }

    pub fn by_path(&self, relative: &str) -> Option<&Photo> {
        self.photos
            .iter()
            .find(|p| p.jpeg.as_deref() == Some(relative) || p.raw.as_deref() == Some(relative))
    }

    /// Distinct calendar days that have at least one session.
    pub fn shooting_days(&self) -> Vec<String> {
        let mut days: Vec<String> = self.sessions.iter().map(|s| s.first.date()).collect();
        days.dedup();
        days
    }
}

// ---------------------------------------------------------------------------
// The plan

const YEAR: i32 = 2024;
/// (month, day) of each shooting day.
const DAYS: [(u32, u32); 6] = [(10, 28), (10, 29), (10, 31), (11, 2), (11, 3), (11, 5)];

enum Start {
    /// Clock time on the plan's day.
    At(u32, u32),
    /// Exactly this long after the previous session's last photo.
    After { hours: u32, minutes: u32 },
}

struct Plan {
    day: usize,
    start: Start,
    camera: Camera,
    count: u32,
    place: Option<Place>,
    /// Whether the camera was writing RAW twins during this session.
    raw: bool,
}

use Camera::*;
use Place::*;
use Start::*;

const PLANS: [Plan; 12] = [
    Plan { day: 0, start: At(9, 12), camera: FujiXT5, count: 10, place: Some(Lisbon), raw: true },
    Plan { day: 0, start: After { hours: 2, minutes: 50 }, camera: FujiXT5, count: 8, place: Some(Lisbon), raw: true },
    Plan { day: 0, start: After { hours: 3, minutes: 10 }, camera: FujiXT5, count: 7, place: Some(Lisbon), raw: true },
    Plan { day: 1, start: At(10, 30), camera: SonyA7IV, count: 12, place: Some(Lisbon), raw: true },
    Plan { day: 1, start: At(16, 5), camera: CanonR6, count: 9, place: Some(Lisbon), raw: true },
    Plan { day: 2, start: At(11, 40), camera: FujiXT5, count: 14, place: Some(Porto), raw: true },
    Plan { day: 3, start: At(9, 5), camera: SonyA7IV, count: 6, place: Some(Porto), raw: false },
    Plan { day: 3, start: At(14, 20), camera: CanonR6, count: 11, place: Some(Porto), raw: true },
    Plan { day: 3, start: At(19, 45), camera: IPhone15Pro, count: 7, place: None, raw: false },
    Plan { day: 4, start: At(12, 15), camera: CanonR6, count: 8, place: Some(Porto), raw: true },
    Plan { day: 4, start: At(17, 30), camera: IPhone15Pro, count: 9, place: None, raw: false },
    Plan { day: 5, start: At(8, 50), camera: FujiXT5, count: 9, place: Some(Lisbon), raw: true },
];

/// Files that carry `Orientation = 6`, by camera and camera counter.
const ROTATED: [(Camera, u32); 3] = [(FujiXT5, 3), (SonyA7IV, 5), (IPhone15Pro, 1002)];
/// Files with no APP1 segment at all: one JPEG-only, one paired, one iPhone.
const NO_EXIF: [(Camera, u32); 3] = [(SonyA7IV, 13), (CanonR6, 15), (IPhone15Pro, 1004)];
/// The one shot whose JPEG is missing, leaving only the RAW.
const RAW_ONLY: [(Camera, u32); 1] = [(CanonR6, 7)];

/// Files that must be pruned by the scanner. They get a valid EXIF date one
/// day before the trip so a pruning bug shows up as a stray 27 Oct stack.
const DECOYS: [&str; 2] = ["DCIM/.hidden/junk.jpg", "Photos Library.photoslibrary/x.jpg"];

// ---------------------------------------------------------------------------
// Building

/// SplitMix64: tiny, seedable, and stable across platforms and Rust versions.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [0, 1).
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform integer in `lo..=hi`.
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next() % (hi - lo + 1) as u64) as i64
    }
}

struct Builder {
    rng: Rng,
    counters: [(Camera, u32); 4],
    sessions: Vec<Session>,
    photos: Vec<Photo>,
}

impl Builder {
    fn new() -> Self {
        Builder {
            rng: Rng(0x5741_434B_5321), // "STACKS!"
            counters: [FujiXT5, SonyA7IV, CanonR6, IPhone15Pro].map(|c| (c, c.first_number())),
            sessions: Vec::new(),
            photos: Vec::new(),
        }
    }

    fn run(mut self) -> Scenario {
        for plan in PLANS.iter() {
            self.session(plan);
        }
        for (i, path) in DECOYS.iter().enumerate() {
            self.photos.push(Photo {
                index: 0,
                session: None,
                camera: IPhone15Pro,
                jpeg: Some((*path).to_string()),
                raw: None,
                taken_at: Timestamp::civil(YEAR, 10, 27, 12, i as u32, 0),
                subsec: 0,
                gps: None,
                orientation: 1,
                has_exif: true,
                portrait: false,
            });
        }
        Scenario { sessions: self.sessions, photos: self.photos }
    }

    fn session(&mut self, plan: &Plan) {
        let number = self.sessions.len() + 1;
        let (month, day) = DAYS[plan.day];
        let previous_last = self.sessions.last().map(|s| s.last);
        let first = match plan.start {
            At(h, m) => Timestamp::civil(YEAR, month, day, h, m, 0),
            After { hours, minutes } => previous_last
                .expect("an `After` session needs a predecessor")
                .plus_seconds(i64::from(hours) * 3_600 + i64::from(minutes) * 60),
        };

        let mut at = first;
        for shot in 0..plan.count {
            if shot > 0 {
                at = at.plus_seconds(self.rng.range(MIN_SPACING_SECS, MAX_SPACING_SECS));
            }
            let number_on_camera = self.take_number(plan.camera);
            let key = (plan.camera, number_on_camera);
            let rotated = ROTATED.contains(&key);
            let stem = plan.camera.stem(number_on_camera);
            let dir = plan.camera.dir();
            let gps = plan.place.map(|place| {
                let (lat, lon) = place.centre();
                let jitter = |rng: &mut Rng| (rng.unit() * 2.0 - 1.0) * GPS_JITTER;
                let dlat = jitter(&mut self.rng);
                let dlon = jitter(&mut self.rng);
                (lat + dlat, lon + dlon)
            });
            let subsec = self.rng.range(0, 99) as u8;
            // Rotated files stay landscape in pixels so the tag actually matters.
            let portrait = !rotated && self.rng.unit() < 0.25;

            self.photos.push(Photo {
                index: self.photos.len() as u32 + 1,
                session: Some(number),
                camera: plan.camera,
                jpeg: (!RAW_ONLY.contains(&key)).then(|| format!("{dir}/{stem}.JPG")),
                raw: plan.raw.then(|| plan.camera.raw_ext()).flatten().map(|ext| format!("{dir}/{stem}.{ext}")),
                taken_at: at,
                subsec,
                gps,
                orientation: if rotated { 6 } else { 1 },
                has_exif: !NO_EXIF.contains(&key),
                portrait,
            });
        }

        self.sessions.push(Session {
            number,
            camera: plan.camera,
            place: plan.place,
            first,
            last: at,
            count: plan.count,
            gap_from_previous: previous_last.map(|p| first.seconds_since(p)),
        });
    }

    fn take_number(&mut self, camera: Camera) -> u32 {
        let slot = self.counters.iter_mut().find(|(c, _)| *c == camera).expect("every camera has a counter");
        let n = slot.1;
        slot.1 += 1;
        n
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.iso())
    }
}
