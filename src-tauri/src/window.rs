// window.rs — keep the phone frame's proportions when the user resizes.
// AppKit enforces the ratio during live resize, which Tauri's own min/max
// size constraints cannot express.

use objc2_app_kit::NSWindow;
use objc2_foundation::NSSize;
use tauri::WebviewWindow;

pub const MOBILE_FRAME: (f64, f64) = (390.0, 844.0);
pub const DESKTOP_FRAME: (f64, f64) = (1280.0, 720.0);

/// Must run on the main thread (the setup hook does).
pub fn lock_aspect(window: &WebviewWindow) -> tauri::Result<()> {
    let ptr = window.ns_window()?;
    // SAFETY: Tauri hands us the live NSWindow it owns; we only borrow it for
    // one main-thread call and never retain it.
    let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
    let frame = if std::env::var_os("STACKS_DESKTOP").is_some() {
        DESKTOP_FRAME
    } else {
        MOBILE_FRAME
    };
    ns_window.setContentAspectRatio(NSSize::new(frame.0, frame.1));
    Ok(())
}
