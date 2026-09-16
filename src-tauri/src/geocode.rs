// geocode.rs — the bundled GeoNames city table (data/cities.csv, CC BY 4.0),
// read both ways: the nearest city to a point (place labels) and cities by
// name (the location picker's offline search). Parsed once (about a second)
// and warmed on a background thread at startup, so a lookup rarely waits.

use std::sync::OnceLock;

use serde::Serialize;

/// Beyond this a "nearest city" is a guess, not a label.
pub const MAX_KM: f64 = 100.0;
/// Rows a search returns; the picker shows a screenful.
pub const SEARCH_LIMIT: usize = 20;
const EARTH_RADIUS_KM: f64 = 6371.0;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaceLabel {
    pub name: String,
    pub admin1: String,
    pub country: String,
    pub distance_km: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct City {
    pub name: String,
    pub admin1: String,
    /// ISO 3166-1 alpha-2.
    pub country: String,
    pub lat: f64,
    pub lon: f64,
}

struct Row {
    city: City,
    /// Position on the unit sphere: nearest-city search compares squared
    /// chords, which order exactly like great-circle distances.
    xyz: [f64; 3],
    /// `fold(name)`, what queries are matched against.
    key: String,
    /// The table has no population column. 0 when the name is also its
    /// region's (Lisbon, Porto), 1 when its district bears it (Paris), else 2:
    /// the main city of a name tends to rank first.
    prominence: u8,
}

static TABLE: OnceLock<Vec<Row>> = OnceLock::new();

fn table() -> &'static [Row] {
    TABLE.get_or_init(load)
}

/// Parses the table now so the first label or search does not pay for it.
pub fn warm() {
    table();
}

fn load() -> Vec<Row> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(include_str!("../data/cities.csv").as_bytes());
    reader
        .records()
        .filter_map(Result::ok)
        .filter_map(|r| {
            let lat: f64 = r.get(0)?.parse().ok()?;
            let lon: f64 = r.get(1)?.parse().ok()?;
            let (name, admin1, admin2, cc) = (r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?);
            let key = fold(name);
            let prominence = if fold(admin1) == key {
                0
            } else if fold(admin2).contains(&key) {
                1
            } else {
                2
            };
            Some(Row {
                city: City { name: name.into(), admin1: admin1.into(), country: cc.into(), lat, lon },
                xyz: unit(lat, lon),
                key,
                prominence,
            })
        })
        .collect()
}

/// One label per `[lat, lon]` point, `None` when the nearest city is too far.
pub fn label(points: &[[f64; 2]]) -> Vec<Option<PlaceLabel>> {
    let rows = table();
    points
        .iter()
        .map(|&[lat, lon]| {
            let q = unit(lat, lon);
            let (row, d2) = rows.iter().map(|r| (r, chord2(&r.xyz, &q))).min_by(|a, b| a.1.total_cmp(&b.1))?;
            let distance_km = chord_squared_to_km(d2);
            (distance_km <= MAX_KM).then(|| PlaceLabel {
                name: row.city.name.clone(),
                admin1: row.city.admin1.clone(),
                country: row.city.country.clone(),
                distance_km: (distance_km * 10.0).round() / 10.0,
            })
        })
        .collect()
}

/// Cities whose name matches `query`: exact names first, then prefixes,
/// then word prefixes ("lagos" in "vila de lagos"), then anywhere; within a
/// tier the closest to `near` (the photos' likely region), then the most
/// prominent, then the shortest name.
pub fn search(query: &str, near: Option<[f64; 2]>, limit: usize) -> Vec<City> {
    let q = fold(query.trim());
    if q.is_empty() {
        return Vec::new();
    }
    let near = near.map(|[lat, lon]| unit(lat, lon));
    let rows = table();
    let mut hits: Vec<(u8, f64, u8, usize, usize)> = rows
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            let tier = match_tier(&r.key, &q)?;
            let distance = near.map_or(0.0, |n| chord2(&r.xyz, &n));
            Some((tier, distance, r.prominence, r.key.len(), i))
        })
        .collect();
    hits.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(a.1.total_cmp(&b.1))
            .then(a.2.cmp(&b.2))
            .then(a.3.cmp(&b.3))
            .then(a.4.cmp(&b.4))
    });
    hits.into_iter().take(limit).map(|h| rows[h.4].city.clone()).collect()
}

fn match_tier(key: &str, q: &str) -> Option<u8> {
    if key == q {
        return Some(0);
    }
    if key.starts_with(q) {
        return Some(1);
    }
    let mut tier = None;
    for (i, _) in key.match_indices(q) {
        if key[..i].chars().next_back().is_some_and(|c| !c.is_alphanumeric()) {
            return Some(2);
        }
        tier = Some(3);
    }
    tier
}

/// Lowercase, Latin diacritics stripped, then ae/oe/ue collapsed to a/o/u, so
/// what a user types meets the table's ASCII spellings, which are themselves
/// inconsistent ("Koeln" and "Muenster" next to "Dusseldorf" and "Zurich").
/// Applied to names and queries alike, so the collapse needs no exceptions.
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars().flat_map(char::to_lowercase) {
        let plain = match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
            'æ' => "ae",
            'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => "c",
            'ď' | 'đ' | 'ð' => "d",
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => "e",
            'ĝ' | 'ğ' | 'ġ' | 'ģ' => "g",
            'ĥ' | 'ħ' => "h",
            'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => "i",
            'ķ' => "k",
            'ĺ' | 'ļ' | 'ľ' | 'ł' => "l",
            'ñ' | 'ń' | 'ņ' | 'ň' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => "o",
            'œ' => "oe",
            'ŕ' | 'ŗ' | 'ř' => "r",
            'ś' | 'ŝ' | 'ş' | 'š' | 'ș' => "s",
            'ß' => "ss",
            'ţ' | 'ť' | 'ț' => "t",
            'þ' => "th",
            'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => "u",
            'ý' | 'ÿ' => "y",
            'ź' | 'ż' | 'ž' => "z",
            '’' | '‘' => "'",
            _ => {
                out.push(c);
                continue;
            }
        };
        out.push_str(plain);
    }
    out.replace("ae", "a").replace("oe", "o").replace("ue", "u")
}

fn unit(lat: f64, lon: f64) -> [f64; 3] {
    let (lat, lon) = (lat.to_radians(), lon.to_radians());
    [lat.cos() * lon.cos(), lat.cos() * lon.sin(), lat.sin()]
}

fn chord2(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

/// A squared chord on the unit sphere back into great-circle kilometres.
fn chord_squared_to_km(d2: f64) -> f64 {
    let chord = d2.max(0.0).sqrt();
    2.0 * (chord / 2.0).clamp(-1.0, 1.0).asin() * EARTH_RADIUS_KM
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISBON: [f64; 2] = [38.7223, -9.1393];

    #[test]
    fn chord_conversion_matches_known_arcs() {
        assert!((chord_squared_to_km(0.0)).abs() < 1e-9);
        // Antipodes: chord = 2 → half the circumference.
        let half = std::f64::consts::PI * EARTH_RADIUS_KM;
        assert!((chord_squared_to_km(4.0) - half).abs() < 1e-6);
    }

    #[test]
    fn labels_lisbon_and_porto_and_rejects_open_ocean() {
        let got = label(&[LISBON, [41.1579, -8.6291], [30.0, -40.0]]);
        let lisbon = got[0].as_ref().expect("lisbon");
        assert_eq!(lisbon.name, "Lisbon");
        assert_eq!(lisbon.country, "PT");
        assert!(lisbon.distance_km < 5.0, "{}", lisbon.distance_km);
        let porto = got[1].as_ref().expect("porto");
        assert_eq!(porto.name, "Porto");
        assert!(got[2].is_none());
    }

    #[test]
    fn every_row_loads_including_quoted_names() {
        assert_eq!(table().len(), 144_563);
        assert!(table().iter().any(|r| r.city.name == "Rueti / Dorfzentrum, Suedl. Teil"));
    }

    #[test]
    fn exact_names_come_before_prefixes() {
        let hits = search("porto", Some(LISBON), SEARCH_LIMIT);
        assert_eq!((hits[0].name.as_str(), hits[0].country.as_str()), ("Porto", "PT"));
        let first_prefix = hits.iter().position(|c| c.name != "Porto").unwrap();
        assert!(hits[first_prefix..].iter().all(|c| c.name != "Porto"));
        assert!(fold(&hits[first_prefix].name).starts_with("porto"), "{:?}", hits[first_prefix]);
        assert_eq!(search("sintra", Some(LISBON), 1)[0].admin1, "Lisbon");
    }

    #[test]
    fn diacritics_and_german_spellings_fold() {
        assert_eq!(search("Zürich", None, 1)[0].name, "Zurich");
        assert_eq!(search("Köln", None, 1)[0].name, "Koeln");
        assert_eq!(search("São Paulo", None, 1)[0].country, "BR");
        assert_eq!(fold("Düsseldorf"), fold("Dusseldorf"));
    }

    #[test]
    fn near_breaks_ties_between_same_named_cities() {
        assert_eq!(search("paris", Some(LISBON), 1)[0].country, "FR");
        assert_eq!(search("paris", None, 1)[0].country, "FR", "prominence without a hint");
        assert_eq!(search("paris", Some([33.66, -95.55]), 1)[0].admin1, "Texas");
    }

    #[test]
    fn search_is_bounded_and_ignores_blank_queries() {
        assert_eq!(search("a", None, SEARCH_LIMIT).len(), SEARCH_LIMIT);
        assert!(search("   ", None, SEARCH_LIMIT).is_empty());
        assert!(search("qqqxqqq", None, SEARCH_LIMIT).is_empty());
    }

    #[test]
    fn city_wire_format_matches_typescript() {
        let c = City { name: "Porto".into(), admin1: "Porto".into(), country: "PT".into(), lat: 41.1, lon: -8.6 };
        assert_eq!(serde_json::to_string(&c).unwrap(), r#"{"name":"Porto","admin1":"Porto","country":"PT","lat":41.1,"lon":-8.6}"#);
    }
}
