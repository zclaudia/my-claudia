#![cfg(not(target_os = "android"))]

use serde::Serialize;
#[cfg(not(target_os = "macos"))]
use tauri::{LogicalPosition, Position};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};

use crate::claudia_ball::claudia_window_url;
#[cfg(target_os = "macos")]
use crate::claudia_ball::make_ball_transparent;

// Dimensions for the independent NotchPanel window.
// Closed state: a small notch-extending strip flush with the top of the screen
// (flat top, rounded bottom, pure black — visually "extends" the physical notch
// on MacBook Pro 14"/16").
// Opened state: a wider panel that drops down from the notch.
pub const NOTCH_WINDOW_WIDTH: f64 = 620.0;
pub const NOTCH_WINDOW_HEIGHT: f64 = 440.0;
#[cfg(not(target_os = "macos"))]
const NOTCH_CLOSED_WIDTH: f64 = 244.0;
#[cfg(not(target_os = "macos"))]
const NOTCH_CLOSED_HEIGHT: f64 = 32.0;
#[cfg(not(target_os = "macos"))]
const NOTCH_OPENED_WIDTH: f64 = NOTCH_WINDOW_WIDTH;
#[cfg(not(target_os = "macos"))]
const NOTCH_OPENED_HEIGHT: f64 = NOTCH_WINDOW_HEIGHT;
const NOTCH_VISIBLE_OPEN_WIDTH: f64 = 460.0;
const NOTCH_VISIBLE_OPEN_HEIGHT: f64 = 440.0;

/// Recenter the notch window on its current screen.
/// Called when display configuration changes (monitors added/removed/rearranged).
pub fn recenter_notch_on_current_screen(app: &tauri::AppHandle) {
    let window = match app.get_webview_window("notch") {
        Some(w) => w,
        None => return,
    };

    #[cfg(target_os = "macos")]
    {
        let _ = window.with_webview(|webview| unsafe {
            use objc2::msg_send;
            use objc2::runtime::{AnyObject, Bool};
            use objc2_foundation::{NSPoint, NSRect};

            let win: *mut AnyObject = webview.ns_window() as _;
            if win.is_null() {
                return;
            }

            // Get the screen the window is currently on (or main screen as fallback).
            let mut screen: *mut AnyObject = msg_send![win, screen];
            if screen.is_null() {
                screen = msg_send![objc2::class!(NSScreen), mainScreen];
            }
            if screen.is_null() {
                return;
            }

            let screen_frame: NSRect = msg_send![screen, frame];
            let screen_top_y = screen_frame.origin.y + screen_frame.size.height;

            let win_frame: NSRect = msg_send![win, frame];
            let x = screen_frame.origin.x + (screen_frame.size.width - win_frame.size.width) / 2.0;

            let top_left = NSPoint { x, y: screen_top_y };
            let _: () = msg_send![win, setFrameTopLeftPoint: top_left];

            let no = Bool::from(false);
            let _: () = msg_send![win, setHasShadow: no];
            let _: () = msg_send![win, invalidateShadow];
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let scale = monitor.scale_factor().max(1e-3);
            let screen_w = monitor.size().width as f64 / scale;
            let mon_x = monitor.position().x as f64 / scale;
            let mon_y = monitor.position().y as f64 / scale;
            let x = mon_x + (screen_w - NOTCH_WINDOW_WIDTH) / 2.0;
            let _ = window.set_position(Position::Logical(LogicalPosition::new(x.max(0.0), mon_y)));
        }
    }
}

/// Tauri command: recenter the notch window on its current screen.
/// Called from the frontend when display changes are detected (e.g. via
/// screen resize/displaychange events), as a cross-platform supplement
/// to the macOS-only NSNotificationCenter observer.
#[tauri::command]
pub fn recenter_notch(app: tauri::AppHandle) -> Result<(), String> {
    recenter_notch_on_current_screen(&app);
    Ok(())
}

/// macOS: raise the notch window ABOVE the menu bar, pin it across all Spaces, and
/// force its top edge to the physical screen top (not the menu-bar-excluded visibleFrame).
/// Cocoa uses a bottom-left origin, so we use `setFrameTopLeftPoint` with y = screen
/// full height — otherwise Tauri's logical (x, 0) gets clamped below the menu bar.
#[cfg(target_os = "macos")]
fn make_notch_above_menu_bar(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Bool};
        use objc2_foundation::{NSPoint, NSRect};

        let win: *mut AnyObject = webview.ns_window() as _;
        if win.is_null() {
            return;
        }

        // NSStatusWindowLevel = 25. Keeps us above the menu bar (which is level 20-24)
        // but below system-critical overlays (screen-saver = 1000, etc.).
        let status_level: i64 = 25;
        let _: () = msg_send![win, setLevel: status_level];

        // NSWindowCollectionBehavior:
        //   canJoinAllSpaces     (1 << 0)  — follow user to every Space
        //   stationary           (1 << 4)  — don't animate during Mission Control
        //   fullScreenAuxiliary  (1 << 8)  — stay visible when another app is fullscreen
        //   ignoresCycle         (1 << 6)  — exclude from Cmd-` window cycling
        let collection_behavior: u64 = (1u64 << 0) | (1u64 << 4) | (1u64 << 6) | (1u64 << 8);
        let _: () = msg_send![win, setCollectionBehavior: collection_behavior];

        // Pin the window's TOP edge to the physical screen top (above menu bar).
        let screen: *mut AnyObject = msg_send![win, screen];
        if !screen.is_null() {
            let screen_frame: NSRect = msg_send![screen, frame];
            let window_frame: NSRect = msg_send![win, frame];
            let screen_top_y = screen_frame.origin.y + screen_frame.size.height;
            let top_left = NSPoint {
                x: window_frame.origin.x,
                y: screen_top_y,
            };
            let _: () = msg_send![win, setFrameTopLeftPoint: top_left];
        }

        // Re-disable the native NSWindow drop shadow AFTER moving the frame:
        // `setFrameTopLeftPoint` / level changes can re-enable it on some macOS
        // versions, leaving a rectangular grey halo visible outside the CSS-
        // rounded notch shape.
        let no = Bool::from(false);
        let _: () = msg_send![win, setHasShadow: no];
        let _: () = msg_send![win, invalidateShadow];
    });
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub fn set_notch_frame(window: &WebviewWindow, x: f64, width: f64, height: f64) {
    let _ = window.with_webview(move |webview| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Bool};
        use objc2_foundation::{NSPoint, NSRect, NSSize};

        let win: *mut AnyObject = webview.ns_window() as _;
        if win.is_null() {
            return;
        }

        let screen: *mut AnyObject = msg_send![win, screen];
        if screen.is_null() {
            return;
        }

        let screen_frame: NSRect = msg_send![screen, frame];
        let screen_top_y = screen_frame.origin.y + screen_frame.size.height;
        let frame = NSRect {
            origin: NSPoint {
                x,
                y: screen_top_y - height,
            },
            size: NSSize { width, height },
        };

        // display:YES ensures the webview viewport updates immediately so CSS
        // layout stays consistent with the new window size.
        // Shadow is already disabled by make_ball_transparent — no need to
        // re-set or invalidate it here.
        let _: () = msg_send![win, setFrame: frame, display: Bool::from(true)];
    });
}

#[derive(Serialize)]
pub struct WindowInfo {
    label: String,
    title: String,
    visible: bool,
    focused: bool,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    pid: u32,
}

#[tauri::command]
pub fn list_windows(app: tauri::AppHandle) -> Vec<WindowInfo> {
    let pid = std::process::id();
    let mut windows: Vec<WindowInfo> = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| {
            let title = window.title().unwrap_or_default();
            let visible = window.is_visible().unwrap_or(false);
            let focused = window.is_focused().unwrap_or(false);
            let size = window.inner_size().unwrap_or_default();
            let pos = window.outer_position().unwrap_or_default();
            WindowInfo {
                label,
                title,
                visible,
                focused,
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
                pid,
            }
        })
        .collect();
    windows.sort_by(|a, b| a.label.cmp(&b.label));
    windows
}

#[derive(Serialize)]
pub struct MonitorInfo {
    name: Option<String>,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[tauri::command]
pub fn list_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .map(|m| MonitorInfo {
            name: m.name().map(|n| n.to_string()),
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
        })
        .collect())
}

/// Create the always-on-top notch window (Dynamic Island-style notification surface).
/// The underlying OS window is always sized for the fully-opened panel; the visible
/// notch shape is CSS-animated inside the (transparent) window. This avoids timing
/// issues between React state changes and asynchronous `set_size` calls.
#[tauri::command]
pub fn create_notch_window(
    app: tauri::AppHandle,
    notch_url: String,
    monitor_index: Option<usize>,
) -> Result<(), String> {
    if app.get_webview_window("notch").is_some() {
        return Ok(());
    }

    // Position at top-center of the chosen monitor (or primary by default).
    // y=0 is the absolute top edge of the screen. We'll raise the window
    // level above the menu bar below so this actually renders on top of it.
    let (x, y) = {
        let monitors = app.available_monitors().ok().unwrap_or_default();
        let chosen = monitor_index.and_then(|i| monitors.get(i).cloned());
        let monitor = chosen.or_else(|| app.primary_monitor().ok().flatten());
        if let Some(mon) = monitor {
            let scale = mon.scale_factor().max(1e-3);
            let screen_w = mon.size().width as f64 / scale;
            let mon_x = mon.position().x as f64 / scale;
            let mon_y = mon.position().y as f64 / scale;
            let x = mon_x + (screen_w - NOTCH_WINDOW_WIDTH) / 2.0;
            (x.max(0.0), mon_y)
        } else {
            (0.0, 0.0)
        }
    };

    let builder = WebviewWindowBuilder::new(&app, "notch", claudia_window_url(&notch_url)?)
        .title("")
        .inner_size(NOTCH_WINDOW_WIDTH, NOTCH_WINDOW_HEIGHT)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false);

    let notch = builder.build().map_err(|e| e.to_string())?;
    // The window is born visually collapsed, so it must not intercept clicks
    // before the React notch runtime finishes mounting and starts polling.
    let _ = notch.set_ignore_cursor_events(true);

    #[cfg(target_os = "macos")]
    {
        make_ball_transparent(&notch);
        make_notch_above_menu_bar(&notch);
    }

    #[cfg(not(target_os = "macos"))]
    let _ = notch;
    Ok(())
}

/// Resize the notch window when the panel expands or collapses.
///
/// macOS: no-op. The window stays at full size (620×600) permanently to avoid
/// the compositing flash caused by `setFrame`. Click pass-through is handled
/// by `set_notch_passthrough` + `check_notch_hover` instead.
///
/// Other platforms: resize the native window so transparent regions do not
/// intercept clicks.
#[tauri::command]
pub fn resize_notch_window(app: tauri::AppHandle, expanded: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = (app, expanded);
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app
            .get_webview_window("notch")
            .ok_or_else(|| "notch window not found".to_string())?;

        let (w, h) = if expanded {
            (NOTCH_OPENED_WIDTH, NOTCH_OPENED_HEIGHT)
        } else {
            (NOTCH_CLOSED_WIDTH, NOTCH_CLOSED_HEIGHT)
        };

        if let Ok(Some(monitor)) = window.current_monitor() {
            let scale = monitor.scale_factor().max(1e-3);
            let screen_w = monitor.size().width as f64 / scale;
            let mon_x = monitor.position().x as f64 / scale;
            let mon_y = monitor.position().y as f64 / scale;
            let x = mon_x + (screen_w - w) / 2.0;
            window
                .set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: w,
                    height: h,
                }))
                .map_err(|e| e.to_string())?;
            let _ = window.set_position(Position::Logical(LogicalPosition::new(x, mon_y)));
        } else {
            window
                .set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: w,
                    height: h,
                }))
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}

/// Toggle click pass-through on the notch window.
/// When `passthrough` is true, the window ignores all mouse events (clicks
/// and hovers pass through to whatever is below).
#[tauri::command]
pub fn set_notch_passthrough(app: tauri::AppHandle, passthrough: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("notch")
        .ok_or_else(|| "notch window not found".to_string())?;
    window
        .set_ignore_cursor_events(passthrough)
        .map_err(|e| e.to_string())
}

/// Check whether the cursor is currently hovering over the collapsed notch
/// pill area.  Returns `true` if the cursor falls inside a 240×40 logical-
/// pixel hit box centred at the top of the notch window.
#[tauri::command]
pub fn check_notch_hover(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("notch")
        .ok_or_else(|| "notch window not found".to_string())?;

    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let win_pos = window.outer_position().map_err(|e| e.to_string())?;
    let win_size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;

    // Relative position inside window (physical pixels).
    let rel_x = cursor.x - win_pos.x as f64;
    let rel_y = cursor.y - win_pos.y as f64;

    // Pill hit-box in physical pixels (slightly larger than visual for comfort).
    let pill_w = 240.0 * scale;
    let pill_h = 40.0 * scale;
    let pill_x = (win_size.width as f64 - pill_w) / 2.0;

    Ok(rel_x >= pill_x && rel_x <= pill_x + pill_w && rel_y >= 0.0 && rel_y <= pill_h)
}

/// Check whether the cursor is currently hovering over the visible opened notch
/// panel area. This ignores the transparent padding around the centered panel.
#[tauri::command]
pub fn check_notch_panel_hover(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("notch")
        .ok_or_else(|| "notch window not found".to_string())?;

    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let win_pos = window.outer_position().map_err(|e| e.to_string())?;
    let win_size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;

    let rel_x = cursor.x - win_pos.x as f64;
    let rel_y = cursor.y - win_pos.y as f64;

    let panel_w = NOTCH_VISIBLE_OPEN_WIDTH * scale;
    let panel_h = NOTCH_VISIBLE_OPEN_HEIGHT * scale;
    let panel_x = (win_size.width as f64 - panel_w) / 2.0;

    Ok(rel_x >= panel_x && rel_x <= panel_x + panel_w && rel_y >= 0.0 && rel_y <= panel_h)
}

/// Move the notch window to a different monitor by index.
///
/// macOS: use Cocoa NSScreen.screens directly, because `set_position` +
/// `make_notch_above_menu_bar` races — `[win screen]` may still return the
/// old screen before the move has taken effect.
///
/// Other platforms: use Tauri `set_position` which works correctly.
#[tauri::command]
pub fn move_notch_to_monitor(app: tauri::AppHandle, monitor_index: usize) -> Result<(), String> {
    let window = app
        .get_webview_window("notch")
        .ok_or_else(|| "notch window not found".to_string())?;

    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if monitor_index >= monitors.len() {
        return Err(format!("monitor index {} out of range", monitor_index));
    }

    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |webview| unsafe {
                use objc2::msg_send;
                use objc2::runtime::{AnyObject, Bool};
                use objc2_foundation::{NSPoint, NSRect};

                let win: *mut AnyObject = webview.ns_window() as _;
                if win.is_null() {
                    return;
                }

                // Get NSScreen.screens (ordered same as Tauri's available_monitors)
                let screens: *mut AnyObject = msg_send![objc2::class!(NSScreen), screens];
                if screens.is_null() {
                    return;
                }
                let count: usize = msg_send![screens, count];
                if monitor_index >= count {
                    return;
                }
                let target_screen: *mut AnyObject =
                    msg_send![screens, objectAtIndex: monitor_index];

                let screen_frame: NSRect = msg_send![target_screen, frame];
                let screen_top_y = screen_frame.origin.y + screen_frame.size.height;

                // Center the notch horizontally on the target screen.
                // `visibleFrame` excludes the menu bar/dock; `frame` is the full screen.
                let win_frame: NSRect = msg_send![win, frame];
                let x =
                    screen_frame.origin.x + (screen_frame.size.width - win_frame.size.width) / 2.0;

                let top_left = NSPoint { x, y: screen_top_y };
                let _: () = msg_send![win, setFrameTopLeftPoint: top_left];

                // Re-disable shadow (moving can re-enable it)
                let no = Bool::from(false);
                let _: () = msg_send![win, setHasShadow: no];
                let _: () = msg_send![win, invalidateShadow];
            })
            .map_err(|e| format!("with_webview failed: {:?}", e))?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let monitor = &monitors[monitor_index];
        let scale = monitor.scale_factor().max(1e-3);
        let screen_w = monitor.size().width as f64 / scale;
        let mon_x = monitor.position().x as f64 / scale;
        let mon_y = monitor.position().y as f64 / scale;
        let x = mon_x + (screen_w - NOTCH_WINDOW_WIDTH) / 2.0;

        window
            .set_position(Position::Logical(LogicalPosition::new(x.max(0.0), mon_y)))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
