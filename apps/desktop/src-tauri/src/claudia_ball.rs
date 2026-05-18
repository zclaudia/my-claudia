#![cfg(not(target_os = "android"))]

use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const CHAT_WIDTH: f64 = 400.0;
pub const CHAT_HEIGHT: f64 = 600.0;
pub const CHAT_GAP: f64 = 16.0;
pub const SCREEN_MARGIN: f64 = 16.0;

pub fn compute_claudia_chat_position(
    ball_window: &WebviewWindow,
    screen_width: f64,
    screen_height: f64,
) -> Option<(f64, f64)> {
    let scale = ball_window
        .scale_factor()
        .ok()
        .filter(|s| *s > 0.0)
        .unwrap_or(1.0);
    let ball_pos = ball_window.outer_position().ok()?;
    let ball_size = ball_window.outer_size().ok()?;

    let ball_x = ball_pos.x as f64 / scale;
    let ball_y = ball_pos.y as f64 / scale;
    let ball_w = ball_size.width as f64 / scale;
    let ball_h = ball_size.height as f64 / scale;

    let max_x = (screen_width - CHAT_WIDTH - SCREEN_MARGIN).max(SCREEN_MARGIN);
    let max_y = (screen_height - CHAT_HEIGHT - SCREEN_MARGIN).max(SCREEN_MARGIN);
    // Preferred placement: chat appears above-left of the floating ball,
    // with the chat window's bottom-right near the ball's bottom-right.
    let target_x = ball_x + ball_w - CHAT_WIDTH - CHAT_GAP;
    let target_y = ball_y + ball_h - CHAT_HEIGHT - CHAT_GAP;

    Some((
        target_x.clamp(SCREEN_MARGIN, max_x),
        target_y.clamp(SCREEN_MARGIN, max_y),
    ))
}

pub fn claudia_window_url(raw_url: &str) -> Result<WebviewUrl, String> {
    let parsed = url::Url::parse(raw_url).map_err(|e| e.to_string())?;
    let mut app_path = parsed.path().trim_start_matches('/').to_string();
    if app_path.is_empty() {
        app_path = "index.html".to_string();
    }
    if let Some(query) = parsed.query() {
        app_path.push('?');
        app_path.push_str(query);
    }
    Ok(WebviewUrl::App(app_path.into()))
}

/// macOS: make window fully transparent (for floating ball — no shadow, no background).
#[cfg(target_os = "macos")]
pub fn make_ball_transparent(window: &WebviewWindow) {
    let _ = window.with_webview(move |webview| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject, Bool};

        let ns_color = AnyClass::get(c"NSColor").unwrap();
        let clear_color: *const AnyObject = msg_send![ns_color, clearColor];
        let no = Bool::from(false);

        let win: *mut AnyObject = webview.ns_window() as _;
        if !win.is_null() {
            let _: () = msg_send![win, setOpaque: no];
            let _: () = msg_send![win, setBackgroundColor: clear_color];
            let _: () = msg_send![win, setHasShadow: no];
            let content_view: *mut AnyObject = msg_send![win, contentView];
            if !content_view.is_null() {
                let yes = Bool::from(true);
                let _: () = msg_send![content_view, setWantsLayer: yes];
                let layer: *mut AnyObject = msg_send![content_view, layer];
                if !layer.is_null() {
                    let cg_ref: *const AnyObject = msg_send![clear_color, CGColor];
                    let _: () = msg_send![layer, setBackgroundColor: cg_ref];
                }
            }
        }

        let wk: *mut AnyObject = webview.inner() as _;
        if !wk.is_null() {
            let _: () = msg_send![wk, setOpaque: no];
            let _: () = msg_send![wk, _setDrawsBackground: no];
            let _: () = msg_send![wk, setUnderPageBackgroundColor: clear_color];
        }
    });
}

/// macOS: make webview background transparent for CSS border-radius (chat window — keeps shadow).
#[cfg(target_os = "macos")]
pub fn make_chat_transparent(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject, Bool};

        let ns_color = AnyClass::get(c"NSColor").unwrap();
        let clear_color: *const AnyObject = msg_send![ns_color, clearColor];
        let no = Bool::from(false);

        // NSWindow: transparent background but KEEP shadow
        let win: *mut AnyObject = webview.ns_window() as _;
        if !win.is_null() {
            let _: () = msg_send![win, setOpaque: no];
            let _: () = msg_send![win, setBackgroundColor: clear_color];
            // Keep shadow: let _: () = msg_send![win, setHasShadow: yes];
        }

        // WKWebView: transparent so CSS rounded corners show
        let wk: *mut AnyObject = webview.inner() as _;
        if !wk.is_null() {
            let _: () = msg_send![wk, setOpaque: no];
            let _: () = msg_send![wk, _setDrawsBackground: no];
            let _: () = msg_send![wk, setUnderPageBackgroundColor: clear_color];
        }
    });
}

#[tauri::command]
pub fn create_claudia_ball(
    app: tauri::AppHandle,
    ball_url: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if app.get_webview_window("claudia-ball").is_some() {
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "claudia-ball", claudia_window_url(&ball_url)?)
        .title("")
        .inner_size(80.0, 80.0)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false);

    let ball = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    make_ball_transparent(&ball);

    #[cfg(not(target_os = "macos"))]
    let _ = ball;
    Ok(())
}
