//! `MANIFEST.txt`: the scenario in a form humans and tests can check against
//! what the app shows. Sessions first (with the gap since the previous one),
//! then one line per photo.

use std::fmt::Write;

use crate::scenario::Scenario;

pub fn render(scenario: &Scenario) -> String {
    let mut out = String::new();
    let shots = scenario.shots().count();
    let decoys = scenario.photos.len() - shots;

    let _ = writeln!(out, "# make-fixtures manifest (deterministic; regenerate with `npm run fixtures`)");
    let _ = writeln!(
        out,
        "# photos: {shots}  sessions: {}  days: {}  decoys: {decoys}",
        scenario.sessions.len(),
        scenario.shooting_days().len()
    );
    let _ = writeln!(out, "#");
    let _ = writeln!(out, "# sessions  (gap = since the previous session's last photo; the app starts a new stack above 3 h)");
    for s in &scenario.sessions {
        let gap = s.gap_from_previous.map_or("-".to_string(), |secs| {
            format!("+{}h{:02}m", secs / 3_600, secs % 3_600 / 60)
        });
        let _ = writeln!(
            out,
            "S{:02}  {} {}..{}  {:<6}  {:>2} photos  {:<7}  gap {gap}",
            s.number,
            s.first.date(),
            s.first.time(),
            s.last.time(),
            s.camera.label(),
            s.count,
            s.place.map_or("no-gps", |p| p.label()),
        );
    }
    let _ = writeln!(out, "#");
    let _ = writeln!(out, "# file | takenAt | gps | session | flags");
    for p in &scenario.photos {
        let gps = p.gps.map_or("-".to_string(), |(lat, lon)| format!("{lat:.5},{lon:.5}"));
        let session = p.session.map_or("-".to_string(), |n| format!("S{n:02}"));
        let mut flags = Vec::new();
        match (&p.jpeg, &p.raw) {
            (Some(_), Some(raw)) => flags.push(raw.rsplit('.').next().unwrap_or("raw").to_ascii_lowercase()),
            (None, Some(_)) => flags.push("raw-only".to_string()),
            _ => {}
        }
        if p.orientation == 6 {
            flags.push("orient6".to_string());
        }
        if !p.has_exif {
            flags.push("no-exif".to_string());
        }
        if p.portrait {
            flags.push("portrait".to_string());
        }
        let _ = writeln!(
            out,
            "{:<40} {}.{:02}  {:<18} {session}  {}",
            p.primary(),
            p.taken_at.iso(),
            p.subsec,
            gps,
            flags.join(",")
        );
    }
    out
}
