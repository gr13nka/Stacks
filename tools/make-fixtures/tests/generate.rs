//! Generates the card once into a temp dir and checks the files against the
//! scenario, reading EXIF back with the independent `kamadak-exif` crate.

use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

use exif::{Exif, In, Tag, Value};
use make_fixtures::scenario::{Camera, Photo, Scenario, GPS_JITTER, MAX_SPACING_SECS, MIN_SPACING_SECS};

const THREE_HOURS: i64 = 3 * 3_600;

fn root() -> &'static Path {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("make-fixtures-test-{}", std::process::id()));
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
        make_fixtures::generate(&dir).expect("generation succeeds");
        dir
    })
}

fn scenario() -> &'static Scenario {
    static SCENARIO: OnceLock<Scenario> = OnceLock::new();
    SCENARIO.get_or_init(Scenario::build)
}

fn photo(relative: &str) -> &'static Photo {
    scenario().by_path(relative).unwrap_or_else(|| panic!("{relative} is in the scenario"))
}

fn read_exif(relative: &str) -> Exif {
    let file = fs::File::open(root().join(relative)).unwrap();
    exif::Reader::new().read_from_container(&mut BufReader::new(file)).unwrap()
}

fn ascii(exif: &Exif, tag: Tag) -> String {
    match &exif.get_field(tag, In::PRIMARY).unwrap_or_else(|| panic!("{tag} present")).value {
        Value::Ascii(parts) => String::from_utf8(parts[0].clone()).unwrap(),
        other => panic!("{tag} is not ASCII: {other:?}"),
    }
}

fn degrees(exif: &Exif, tag: Tag, reference: Tag) -> f64 {
    let magnitude = match &exif.get_field(tag, In::PRIMARY).unwrap().value {
        Value::Rational(dms) => dms[0].to_f64() + dms[1].to_f64() / 60.0 + dms[2].to_f64() / 3_600.0,
        other => panic!("{tag} is not rational: {other:?}"),
    };
    match ascii(exif, reference).as_str() {
        "N" | "E" => magnitude,
        "S" | "W" => -magnitude,
        r => panic!("bad hemisphere {r}"),
    }
}

/// Markers of every segment before the scan data.
fn jpeg_markers(bytes: &[u8]) -> Vec<u8> {
    assert_eq!(&bytes[..2], &[0xFF, 0xD8], "SOI");
    let mut markers = Vec::new();
    let mut at = 2;
    while at + 4 <= bytes.len() && bytes[at] == 0xFF {
        let marker = bytes[at + 1];
        if marker == 0xDA {
            break;
        }
        markers.push(marker);
        at += 2 + usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
    }
    markers
}

#[test]
fn scenario_holds_its_invariants() {
    let s = scenario();
    assert_eq!(s.shooting_days().len(), 6);
    assert_eq!(s.shots().count(), 110);
    assert_eq!(s.sessions.len(), 12);

    for day in s.shooting_days() {
        let per_day = s.sessions.iter().filter(|x| x.first.date() == day).count();
        assert!((1..=3).contains(&per_day), "{day} has {per_day} sessions");
    }
    for session in &s.sessions {
        assert!((6..=14).contains(&session.count), "S{} has {} photos", session.number, session.count);
        let shots: Vec<&Photo> = s.shots().filter(|p| p.session == Some(session.number)).collect();
        for pair in shots.windows(2) {
            let spacing = pair[1].taken_at.seconds_since(pair[0].taken_at);
            assert!((MIN_SPACING_SECS..=MAX_SPACING_SECS).contains(&spacing), "spacing {spacing}s in S{}", session.number);
        }
    }
    let gaps: Vec<i64> = s.sessions.iter().filter_map(|x| x.gap_from_previous).collect();
    assert_eq!(gaps.iter().filter(|&&g| g == 2 * 3_600 + 50 * 60).count(), 1, "one 2h50m gap");
    assert_eq!(gaps.iter().filter(|&&g| g == 3 * 3_600 + 10 * 60).count(), 1, "one 3h10m gap");
    assert!(gaps.iter().all(|&g| g > THREE_HOURS || g == 2 * 3_600 + 50 * 60), "gaps {gaps:?}");

    assert_eq!(s.shots().filter(|p| p.orientation == 6).count(), 3);
    assert_eq!(s.shots().filter(|p| !p.has_exif).count(), 3);
    assert_eq!(s.shots().filter(|p| p.jpeg.is_none()).count(), 1);
    assert!(s.shots().filter(|p| p.orientation == 6).all(|p| !p.portrait), "rotated files stay landscape");

    for p in s.shots() {
        let session = &s.sessions[p.session.unwrap() - 1];
        match (p.camera, p.gps, session.place) {
            (Camera::IPhone15Pro, None, None) => {}
            (_, Some((lat, lon)), Some(place)) => {
                let (clat, clon) = place.centre();
                assert!((lat - clat).abs() <= GPS_JITTER && (lon - clon).abs() <= GPS_JITTER, "{} strays", p.primary());
            }
            other => panic!("{}: {other:?}", p.primary()),
        }
    }
}

#[test]
fn tree_and_manifest_match_the_scenario() {
    let manifest = fs::read_to_string(root().join("MANIFEST.txt")).unwrap();
    assert!(manifest.contains("# photos: 110  sessions: 12  days: 6"), "header:\n{manifest}");
    assert_eq!(manifest.matches("gap +2h50m").count(), 1);
    assert_eq!(manifest.matches("gap +3h10m").count(), 1);
    for p in &scenario().photos {
        assert!(manifest.contains(p.primary()), "{} listed", p.primary());
    }

    let expected: Vec<&String> = scenario().photos.iter().flat_map(|p| p.jpeg.iter().chain(p.raw.iter())).collect();
    for relative in &expected {
        assert!(root().join(relative).is_file(), "{relative} exists");
    }
    let mut found = Vec::new();
    walk(root(), root(), &mut found);
    found.retain(|f| f != "MANIFEST.txt");
    assert_eq!(found.len(), expected.len(), "no stray files: {found:?}");

    let per_dir = |dir: &str| expected.iter().filter(|p| p.starts_with(dir)).count();
    assert_eq!(per_dir("DCIM/100FUJI/"), 96, "48 Fuji shots × (JPG+RAF)");
    assert_eq!(per_dir("DCIM/101SONY/"), 30, "12 paired + 6 JPEG-only");
    assert_eq!(per_dir("DCIM/102CANON/"), 55, "28 shots × 2 − 1 missing JPEG");
    assert_eq!(per_dir("local/Pictures/2024-11/"), 16);
    assert_eq!(per_dir("DCIM/.hidden/"), 1);
    assert_eq!(per_dir("Photos Library.photoslibrary/"), 1);
}

fn walk(base: &Path, dir: &Path, out: &mut Vec<String>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            walk(base, &path, out);
        } else {
            out.push(path.strip_prefix(base).unwrap().to_string_lossy().into_owned());
        }
    }
}

#[test]
fn exif_round_trips_through_an_independent_reader() {
    let samples = [
        "DCIM/100FUJI/DSCF0001.JPG",          // Lisbon, Fuji, RAF twin
        "DCIM/101SONY/DSC00005.JPG",          // Orientation 6
        "DCIM/102CANON/IMG_0012.JPG",         // Porto, Canon
        "local/Pictures/2024-11/IMG_1002.JPG", // iPhone: no GPS, Orientation 6
    ];
    for relative in samples {
        let want = photo(relative);
        assert!(want.has_exif);
        let exif = read_exif(relative);

        assert_eq!(ascii(&exif, Tag::DateTimeOriginal), want.taken_at.exif(), "{relative}");
        assert_eq!(ascii(&exif, Tag::SubSecTimeOriginal), format!("{:02}", want.subsec));
        assert_eq!(ascii(&exif, Tag::Make), want.camera.make());
        assert_eq!(ascii(&exif, Tag::Model), want.camera.model());
        let orientation = exif.get_field(Tag::Orientation, In::PRIMARY).unwrap().value.get_uint(0);
        assert_eq!(orientation, Some(u32::from(want.orientation)), "{relative} orientation");

        match want.gps {
            Some((lat, lon)) => {
                let got_lat = degrees(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef);
                let got_lon = degrees(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef);
                assert!((got_lat - lat).abs() < 0.0005, "{relative} lat {got_lat} vs {lat}");
                assert!((got_lon - lon).abs() < 0.0005, "{relative} lon {got_lon} vs {lon}");
                assert!(got_lat > 0.0 && got_lon < 0.0, "{relative} is in the north-west quadrant");
            }
            None => {
                assert!(exif.get_field(Tag::GPSLatitude, In::PRIMARY).is_none(), "{relative} has no GPS");
            }
        }
    }
    assert_eq!(photo(samples[1]).orientation, 6);
    assert_eq!(photo(samples[3]).orientation, 6);
    assert_eq!(photo(samples[3]).camera, Camera::IPhone15Pro);
}

#[test]
fn raw_twins_are_byte_copies_and_the_raw_only_shot_has_no_jpeg() {
    for p in scenario().shots() {
        if let (Some(jpeg), Some(raw)) = (&p.jpeg, &p.raw) {
            assert_eq!(fs::read(root().join(jpeg)).unwrap(), fs::read(root().join(raw)).unwrap(), "{jpeg} twin");
        }
    }
    let raw_only = photo("DCIM/102CANON/IMG_0007.CR3");
    assert!(raw_only.jpeg.is_none());
    assert!(!root().join("DCIM/102CANON/IMG_0007.JPG").exists());
    assert_eq!(jpeg_markers(&fs::read(root().join("DCIM/102CANON/IMG_0007.CR3")).unwrap()).iter().filter(|&&m| m == 0xE1).count(), 1);
}

#[test]
fn exif_less_files_have_no_app1_and_carry_the_capture_time_as_mtime() {
    let bare: Vec<&Photo> = scenario().shots().filter(|p| !p.has_exif).collect();
    assert_eq!(bare.len(), 3);
    for p in bare {
        for relative in p.jpeg.iter().chain(p.raw.iter()) {
            let bytes = fs::read(root().join(relative)).unwrap();
            assert!(!jpeg_markers(&bytes).contains(&0xE1), "{relative} must have no APP1");
            let mtime = fs::metadata(root().join(relative)).unwrap().modified().unwrap();
            let secs = mtime.duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
            assert_eq!(secs, p.taken_at.local_epoch(), "{relative} mtime");
        }
    }
    // And the files with EXIF do carry it.
    let with = fs::read(root().join("DCIM/100FUJI/DSCF0001.JPG")).unwrap();
    assert!(jpeg_markers(&with).contains(&0xE1));
}

#[test]
fn pixel_dimensions_follow_the_portrait_flag() {
    for relative in ["DCIM/100FUJI/DSCF0001.JPG", "DCIM/101SONY/DSC00005.JPG"] {
        let bytes = fs::read(root().join(relative)).unwrap();
        let (w, h) = sof_dimensions(&bytes);
        let want = if photo(relative).portrait { (400, 600) } else { (600, 400) };
        assert_eq!((w, h), want, "{relative}");
    }
}

/// Width and height from the first SOF0 segment.
fn sof_dimensions(bytes: &[u8]) -> (u16, u16) {
    let mut at = 2;
    while bytes[at] == 0xFF {
        let marker = bytes[at + 1];
        let len = usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
        if marker == 0xC0 {
            let h = u16::from_be_bytes([bytes[at + 5], bytes[at + 6]]);
            let w = u16::from_be_bytes([bytes[at + 7], bytes[at + 8]]);
            return (w, h);
        }
        at += 2 + len;
    }
    panic!("no SOF0");
}
