// geocode.rs — offline nearest-city labels from the bundled GeoNames table.
// The table (7.5 MB CSV) is parsed once, on first use, off the main thread.

use std::sync::OnceLock;

use reverse_geocoder::ReverseGeocoder;
use serde::Serialize;

/// Beyond this a "nearest city" is a guess, not a label.
pub const MAX_KM: f64 = 100.0;
const EARTH_RADIUS_KM: f64 = 6371.0;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaceLabel {
    pub name: String,
    pub admin1: String,
    pub country: String,
    pub distance_km: f64,
}

static GEOCODER: OnceLock<ReverseGeocoder> = OnceLock::new();

/// One label per `[lat, lon]` point, `None` when the nearest city is too far.
pub fn label(points: &[[f64; 2]]) -> Vec<Option<PlaceLabel>> {
    let geocoder = GEOCODER.get_or_init(ReverseGeocoder::new);
    points
        .iter()
        .map(|&[lat, lon]| {
            let hit = geocoder.search((lat, lon));
            let distance_km = chord_squared_to_km(hit.distance);
            (distance_km <= MAX_KM).then(|| PlaceLabel {
                name: hit.record.name.clone(),
                admin1: hit.record.admin1.clone(),
                country: hit.record.cc.clone(),
                distance_km: (distance_km * 10.0).round() / 10.0,
            })
        })
        .collect()
}

/// The geocoder searches a unit sphere with squared Euclidean distance; turn
/// that chord back into great-circle kilometres.
fn chord_squared_to_km(d2: f64) -> f64 {
    let chord = d2.max(0.0).sqrt();
    2.0 * (chord / 2.0).clamp(-1.0, 1.0).asin() * EARTH_RADIUS_KM
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chord_conversion_matches_known_arcs() {
        assert!((chord_squared_to_km(0.0)).abs() < 1e-9);
        // Antipodes: chord = 2 → half the circumference.
        let half = std::f64::consts::PI * EARTH_RADIUS_KM;
        assert!((chord_squared_to_km(4.0) - half).abs() < 1e-6);
    }

    #[test]
    fn labels_lisbon_and_porto_and_rejects_open_ocean() {
        let got = label(&[[38.7223, -9.1393], [41.1579, -8.6291], [30.0, -40.0]]);
        let lisbon = got[0].as_ref().expect("lisbon");
        assert_eq!(lisbon.name, "Lisbon");
        assert_eq!(lisbon.country, "PT");
        assert!(lisbon.distance_km < 5.0, "{}", lisbon.distance_km);
        let porto = got[1].as_ref().expect("porto");
        assert_eq!(porto.name, "Porto");
        assert!(got[2].is_none());
    }
}
