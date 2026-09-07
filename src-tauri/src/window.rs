// window.rs — keep the phone frame's proportions when the user resizes.
// AppKit enforces the ratio during live resize, which Tauri's own min/max
// size constraints cannot express.

use objc2_app_kit::NSWindow;
use objc2_foundation::NSSize;
use tauri::WebviewWindow;

pub const FRAME: (f64, f64) = (390.0, 844.0);

/// Must run on the main thread (the setup hook does).
pub fn lock_aspect(window: &WebviewWindow) -> tauri::Result<()> {
    let ptr = window.ns_window()?;
    // SAFETY: Tauri hands us the live NSWindow it owns; we only borrow it for
    // one main-thread call and never retain it.
    let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
    ns_window.setContentAspectRatio(NSSize::new(FRAME.0, FRAME.1));
    Ok(())
}
