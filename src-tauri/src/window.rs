// window.rs — where the app's one window opens. The frontend fits the 1280×800
// frame to whatever window it is given, so the only thing it cannot decide for
// itself is the size to start at: as close to the frame's own 1:1 size as this
// display allows, with a margin of desk showing around it.
//
// Nothing constrains the window's shape afterwards. Dragging it wider or
// shorter just changes how much desk is visible around the frame.

use tauri::{LogicalSize, WebviewWindow};

pub const FRAME: (f64, f64) = (1280.0, 800.0);

/// Desk left visible on every side of the frame (tokens.ts DESK.margin).
const MARGIN: f64 = 24.0;
/// Never open magnified: the design is drawn at 1:1 and text is crispest there.
const MAX_SCALE: f64 = 1.0;
/// Legibility floor, matched by minWidth/minHeight in tauri.conf.json.
const MIN_SCALE: f64 = 0.8;

/// Content size in logical px for a display whose usable area is `work`: the
/// whole frame at the largest scale that still leaves a margin of desk, never
/// magnified, and never shrunk past the point where the frame stays readable —
/// so on a very short display the window is allowed to exceed `work` rather
/// than render the frame too small to use.
pub fn fit_size(work: (f64, f64)) -> (f64, f64) {
    let fits = |available: f64, side: f64| (available - 2.0 * MARGIN) / side;
    let scale = fits(work.0, FRAME.0)
        .min(fits(work.1, FRAME.1))
        .min(MAX_SCALE)
        .max(MIN_SCALE);
    (FRAME.0 * scale + 2.0 * MARGIN, FRAME.1 * scale + 2.0 * MARGIN)
}

/// Size the window for the display it opened on and centre it there.
/// Must run on the main thread (the setup hook does). If the runtime cannot
/// name a monitor, the configured size stands — the window must still open.
pub fn fit_to_display(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let dpr = monitor.scale_factor();
    let area = monitor.work_area().size;
    let (w, h) = fit_size((f64::from(area.width) / dpr, f64::from(area.height) / dpr));
    window.set_size(LogicalSize::new(w, h))?;
    window.center()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A roomy display: the frame opens at 1:1 with exactly the desk margin.
    #[test]
    fn opens_at_one_to_one_when_there_is_room() {
        assert_eq!(fit_size((1728.0, 1067.0)), (1328.0, 848.0));
    }

    /// Never magnified, however much room there is.
    #[test]
    fn never_magnifies() {
        assert_eq!(fit_size((3840.0, 2160.0)), fit_size((1728.0, 1067.0)));
    }

    /// A display too short for 1:1: the frame gives up a few percent rather than
    /// letting the window run off the bottom of the screen.
    #[test]
    fn shrinks_to_fit_a_short_display() {
        let (w, h) = fit_size((1440.0, 800.0));
        assert!(h <= 800.0, "window {h} must fit the work area");
        assert!(w < 1328.0 && h < 848.0, "expected a scale below 1, got {w}×{h}");
    }

    /// Below the legibility floor the window keeps its size and overflows instead.
    #[test]
    fn stops_shrinking_at_the_legibility_floor() {
        let floor = (FRAME.0 * MIN_SCALE + 2.0 * MARGIN, FRAME.1 * MIN_SCALE + 2.0 * MARGIN);
        assert_eq!(fit_size((1024.0, 600.0)), floor);
        assert_eq!(fit_size((300.0, 300.0)), floor);
    }

    /// A narrow-but-tall display is limited by its width.
    #[test]
    fn a_narrow_display_is_limited_by_its_width() {
        let (w, _) = fit_size((1200.0, 2000.0));
        assert!(w <= 1200.0, "window {w} must fit the work area width");
    }

    /// More room never yields a smaller window.
    #[test]
    fn is_monotonic_in_the_available_area() {
        let mut previous = 0.0;
        for side in [600.0, 800.0, 1000.0, 1400.0, 2000.0] {
            let (_, h) = fit_size((side * 1.6, side));
            assert!(h >= previous, "{h} shrank below {previous}");
            previous = h;
        }
    }
}
