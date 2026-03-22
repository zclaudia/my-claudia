#[cfg(not(target_os = "android"))]
use tauri::{LogicalPosition, Manager, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(not(target_os = "android"))]
mod server;

#[cfg(not(target_os = "android"))]
mod permissions;

#[cfg(not(target_os = "android"))]
mod network_probe;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to MyClaudia!", name)
}

/// Focus a window by label (bring to front, unminimize if needed)
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn focus_window(app: tauri::AppHandle, label: String) {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Close a window by label
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn close_window(app: tauri::AppHandle, label: String) {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
}

#[cfg(not(target_os = "android"))]
const CHAT_WIDTH: f64 = 400.0;
#[cfg(not(target_os = "android"))]
const CHAT_HEIGHT: f64 = 600.0;
#[cfg(not(target_os = "android"))]
const CHAT_GAP: f64 = 16.0;
#[cfg(not(target_os = "android"))]
const SCREEN_MARGIN: f64 = 16.0;

#[cfg(not(target_os = "android"))]
fn compute_claudia_chat_position(ball_window: &WebviewWindow, screen_width: f64, screen_height: f64) -> Option<(f64, f64)> {
    let scale = ball_window.scale_factor().ok().filter(|s| *s > 0.0).unwrap_or(1.0);
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

/// macOS: make window fully transparent (for floating ball — no shadow, no background).
#[cfg(target_os = "macos")]
fn make_ball_transparent(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
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
fn make_chat_transparent(window: &WebviewWindow) {
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

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn create_claudia_ball(
    app: tauri::AppHandle,
    ball_url: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if app.get_webview_window("claudia-ball").is_some() {
        return Ok(());
    }

    let parsed = url::Url::parse(&ball_url).map_err(|e| e.to_string())?;
    let builder = WebviewWindowBuilder::new(&app, "claudia-ball", WebviewUrl::External(parsed))
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

    Ok(())
}

/// Toggle Claudia chat window visibility (shared by command + global shortcut).
#[cfg(not(target_os = "android"))]
fn toggle_claudia_visibility(app: &tauri::AppHandle) {
    let ball_window = match app.get_webview_window("claudia-ball") {
        Some(w) => w,
        None => return,
    };
    let chat_window = match app.get_webview_window("claudia-chat") {
        Some(w) => w,
        None => return,
    };

    let visible = chat_window.is_visible().unwrap_or(false);
    if visible {
        let _ = chat_window.hide();
        let _ = ball_window.show();
    } else {
        // Get screen dimensions from the ball window's monitor
        let scale = ball_window.scale_factor().ok().filter(|s| *s > 0.0).unwrap_or(1.0);
        let monitor = ball_window.current_monitor().ok().flatten();
        let (screen_w, screen_h) = monitor
            .as_ref()
            .map(|m| (m.size().width as f64 / scale, m.size().height as f64 / scale))
            .unwrap_or((1920.0, 1080.0));

        if let Some((chat_x, chat_y)) = compute_claudia_chat_position(&ball_window, screen_w, screen_h) {
            let _ = chat_window.set_position(Position::Logical(LogicalPosition::new(chat_x, chat_y)));
        }
        let _ = chat_window.show();
        let _ = chat_window.set_focus();
        let _ = ball_window.hide();
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn toggle_claudia_chat(
    app: tauri::AppHandle,
    chat_url: String,
    screen_width: f64,
    screen_height: f64,
) -> Result<(), String> {
    // If chat window already exists, just toggle visibility
    if app.get_webview_window("claudia-chat").is_some() {
        toggle_claudia_visibility(&app);
        return Ok(());
    }

    // First time: create the chat window
    let ball_window = app
        .get_webview_window("claudia-ball")
        .ok_or_else(|| "claudia-ball window not found".to_string())?;
    let (chat_x, chat_y) = compute_claudia_chat_position(&ball_window, screen_width, screen_height)
        .ok_or_else(|| "failed to compute chat window position".to_string())?;

    let parsed = url::Url::parse(&chat_url).map_err(|e| e.to_string())?;
    let chat = WebviewWindowBuilder::new(&app, "claudia-chat", WebviewUrl::External(parsed))
        .title("Claudia")
        .inner_size(CHAT_WIDTH, CHAT_HEIGHT)
        .position(chat_x, chat_y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(true)
        .min_inner_size(320.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    make_chat_transparent(&chat);

    ball_window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn hide_claudia_chat(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(chat_window) = app.get_webview_window("claudia-chat") {
        let _ = chat_window.hide();
    }
    if let Some(ball_window) = app.get_webview_window("claudia-ball") {
        let _ = ball_window.show();
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn preload_claudia_chat(app: tauri::AppHandle, chat_url: String) -> Result<(), String> {
    if app.get_webview_window("claudia-chat").is_some() {
        return Ok(());
    }

    let parsed = url::Url::parse(&chat_url).map_err(|e| e.to_string())?;
    let chat_window = WebviewWindowBuilder::new(&app, "claudia-chat", WebviewUrl::External(parsed))
        .title("Claudia")
        .inner_size(CHAT_WIDTH, CHAT_HEIGHT)
        .position(0.0, 0.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(true)
        .min_inner_size(320.0, 400.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    make_chat_transparent(&chat_window);

    let _ = chat_window.hide();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init());

    // Updater + process (restart) — desktop only
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Global shortcut: Cmd+Shift+. (macOS) / Ctrl+Shift+. (others) to toggle Claudia
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    let _ = shortcut; // single shortcut registered, no need to match
                    toggle_claudia_visibility(app);
                }
            })
            .with_shortcut("CmdOrCtrl+Shift+.")
            .expect("failed to parse Claudia shortcut")
            .build(),
    );

    // Single-instance only in release builds — allows dev and production to coexist
    #[cfg(all(not(target_os = "android"), not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // When a second instance is launched, focus the existing window
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
            let _ = window.unminimize();
        }
    }));

    #[cfg(not(target_os = "android"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        server::start_server,
        server::stop_server,
        server::register_dev_server_pid,
        server::get_shell_network_env,
        network_probe::probe_opencode_endpoints,
        network_probe::probe_network_endpoint,
        permissions::check_full_disk_access,
        permissions::open_full_disk_access_settings,
        permissions::check_folder_permissions,
        permissions::open_files_and_folders_settings,
        focus_window,
        close_window,
        create_claudia_ball,
        toggle_claudia_chat,
        hide_claudia_chat,
        preload_claudia_chat,
    ]);

    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![greet]);

    // On macOS, probe TCC-protected folders at startup so the consent dialogs
    // appear while the user is at the keyboard. Without this, remote sessions
    // (phone via gateway) would fail to access Desktop/Documents/Downloads
    // because TCC dialogs require local GUI interaction.
    // The dialogs only appear once per folder — macOS caches the decision.
    #[cfg(target_os = "macos")]
    let builder = builder.setup(|_app| {
        std::thread::spawn(|| {
            // Small delay so the window appears first, then TCC dialogs overlay it
            std::thread::sleep(std::time::Duration::from_secs(1));
            let results = permissions::check_folder_permissions();
            let pending: Vec<_> = results.iter().filter(|r| !r.granted).map(|r| r.name.as_str()).collect();
            if !pending.is_empty() {
                eprintln!("[Permissions] Folders not yet authorized: {:?}", pending);
            }
        });
        Ok(())
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(not(target_os = "android"))]
            if let tauri::RunEvent::Exit = _event {
                server::stop_server_sync();
            }
        });
}
