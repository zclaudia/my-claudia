#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};

#[cfg(not(target_os = "android"))]
use tauri::{LogicalPosition, Manager, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(not(target_os = "android"))]
use std::sync::Mutex;
#[cfg(not(target_os = "android"))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState as GlobalShortcutState};
#[cfg(not(target_os = "android"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(target_os = "android"))]
use tauri::menu::{MenuBuilder, MenuItemBuilder};

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

#[cfg(target_os = "android")]
const NTFY_BRIDGE_URL: &str = "http://127.0.0.1:9595";

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct AndroidNotificationConfig {
    enabled: bool,
    ntfy_url: String,
    ntfy_topic: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct AndroidNtfyBridgeStatus {
    ok: bool,
    uptime: Option<String>,
    version: Option<String>,
    subscriptions: serde_json::Value,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct AndroidBridgeSubscribeRequest {
    id: String,
    ntfy_url: String,
    topic: String,
    package: String,
    receiver: String,
}

#[cfg(target_os = "android")]
fn android_bridge_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_get_ntfy_bridge_status() -> Result<AndroidNtfyBridgeStatus, String> {
    let response = android_bridge_client()?
        .get(format!("{NTFY_BRIDGE_URL}/status"))
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("status failed: {}", response.status()));
    }

    let value = response.json::<serde_json::Value>().map_err(|e| e.to_string())?;
    Ok(AndroidNtfyBridgeStatus {
        ok: value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        uptime: value.get("uptime").and_then(|v| v.as_str()).map(ToOwned::to_owned),
        version: value.get("version").and_then(|v| v.as_str()).map(ToOwned::to_owned),
        subscriptions: value
            .get("subscriptions")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_sync_ntfy_bridge(config: AndroidNotificationConfig, package_id: String) -> Result<(), String> {
    let client = android_bridge_client()?;

    if config.enabled && !config.ntfy_url.trim().is_empty() && !config.ntfy_topic.trim().is_empty() {
        let response = client
            .post(format!("{NTFY_BRIDGE_URL}/subscribe"))
            .json(&AndroidBridgeSubscribeRequest {
                id: package_id.clone(),
                ntfy_url: config.ntfy_url.trim().to_string(),
                topic: config.ntfy_topic.trim().to_string(),
                package: package_id,
                receiver: "com.myClaudia.mobile.NotificationRenderService".to_string(),
            })
            .send()
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("ntfy-bridge register failed: {}", response.status()));
        }
        return Ok(());
    }

    let response = client
        .delete(format!("{NTFY_BRIDGE_URL}/subscribe"))
        .json(&serde_json::json!({ "id": package_id }))
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("ntfy-bridge unregister failed: {}", response.status()));
    }

    Ok(())
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
fn compute_claudia_chat_position(
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

#[cfg(not(target_os = "android"))]
fn claudia_window_url(raw_url: &str) -> Result<WebviewUrl, String> {
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

    Ok(())
}

// Global shortcut state
#[cfg(not(target_os = "android"))]
const DEFAULT_CLAUDIA_SHORTCUT: &str = "CmdOrCtrl+Shift+.";

#[cfg(not(target_os = "android"))]
struct ShortcutConfigState {
    current_shortcut: Option<String>,
}

#[cfg(not(target_os = "android"))]
type ShortcutStateHandle = Mutex<ShortcutConfigState>;

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
        let scale = ball_window
            .scale_factor()
            .ok()
            .filter(|s| *s > 0.0)
            .unwrap_or(1.0);
        let monitor = ball_window.current_monitor().ok().flatten();
        let (screen_w, screen_h) = monitor
            .as_ref()
            .map(|m| {
                (
                    m.size().width as f64 / scale,
                    m.size().height as f64 / scale,
                )
            })
            .unwrap_or((1920.0, 1080.0));

        if let Some((chat_x, chat_y)) =
            compute_claudia_chat_position(&ball_window, screen_w, screen_h)
        {
            let _ =
                chat_window.set_position(Position::Logical(LogicalPosition::new(chat_x, chat_y)));
        }
        let _ = chat_window.show();
        let _ = chat_window.set_focus();
        let _ = ball_window.hide();
    }
}

#[cfg(not(target_os = "android"))]
fn show_claudia_chat_window(
    app: tauri::AppHandle,
    chat_url: String,
    screen_width: f64,
    screen_height: f64,
) -> Result<(), String> {
    if let Some(chat_window) = app.get_webview_window("claudia-chat") {
        let ball_window = app
            .get_webview_window("claudia-ball")
            .ok_or_else(|| "claudia-ball window not found".to_string())?;

        if let Some((chat_x, chat_y)) =
            compute_claudia_chat_position(&ball_window, screen_width, screen_height)
        {
            let _ =
                chat_window.set_position(Position::Logical(LogicalPosition::new(chat_x, chat_y)));
        }
        let _ = chat_window.show();
        let _ = chat_window.set_focus();
        let _ = ball_window.hide();
        return Ok(());
    }

    let ball_window = app
        .get_webview_window("claudia-ball")
        .ok_or_else(|| "claudia-ball window not found".to_string())?;
    let (chat_x, chat_y) = compute_claudia_chat_position(&ball_window, screen_width, screen_height)
        .ok_or_else(|| "failed to compute chat window position".to_string())?;

    let chat = WebviewWindowBuilder::new(&app, "claudia-chat", claudia_window_url(&chat_url)?)
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
fn toggle_claudia_chat(
    app: tauri::AppHandle,
    chat_url: String,
    screen_width: f64,
    screen_height: f64,
) -> Result<(), String> {
    if let Some(chat_window) = app.get_webview_window("claudia-chat") {
        let visible = chat_window.is_visible().unwrap_or(false);
        if visible {
            return hide_claudia_chat(app);
        }
    }

    show_claudia_chat_window(app, chat_url, screen_width, screen_height)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn show_claudia_chat(
    app: tauri::AppHandle,
    chat_url: String,
    screen_width: f64,
    screen_height: f64,
) -> Result<(), String> {
    show_claudia_chat_window(app, chat_url, screen_width, screen_height)
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

/// Update the global shortcut for toggling Claudia visibility.
/// Pass `None` to disable the shortcut.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn update_global_shortcut(app: tauri::AppHandle, shortcut: Option<String>) -> Result<(), String> {
    let state = app.state::<ShortcutStateHandle>();
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // Unregister the old shortcut if exists
    if let Some(old_shortcut) = &state.current_shortcut {
        if let Ok(s) = old_shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            let _ = app.global_shortcut().unregister(s);
        }
    }

    // Register the new shortcut if provided
    if let Some(new_shortcut) = &shortcut {
        let s = new_shortcut
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .map_err(|e| format!("Invalid shortcut: {}", e))?;

        app.global_shortcut()
            .on_shortcut(s, move |app, _shortcut, event| {
                if event.state == GlobalShortcutState::Pressed {
                    toggle_claudia_visibility(app);
                }
            })
            .map_err(|e| format!("Failed to register shortcut: {}", e))?;
    }

    state.current_shortcut = shortcut;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn preload_claudia_chat(app: tauri::AppHandle, chat_url: String) -> Result<(), String> {
    if app.get_webview_window("claudia-chat").is_some() {
        return Ok(());
    }

    let chat_window =
        WebviewWindowBuilder::new(&app, "claudia-chat", claudia_window_url(&chat_url)?)
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

    // Global shortcut plugin — initialized without fixed shortcuts, will be configured dynamically
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    // Keep desktop app single-instance. The clean dev launcher uses a separate
    // identifier, so dev and production can still coexist without spawning
    // duplicate floating windows inside the same channel.
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // When a second instance is launched, focus the existing window
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
            let _ = window.unminimize();
        }
    }));

    #[cfg(not(target_os = "android"))]
    let builder = builder
        .manage(Mutex::new(ShortcutConfigState {
            current_shortcut: None,
        }))
        .invoke_handler(tauri::generate_handler![
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
            show_claudia_chat,
            hide_claudia_chat,
            preload_claudia_chat,
            update_global_shortcut,
        ]);

    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        android_get_ntfy_bridge_status,
        android_sync_ntfy_bridge,
    ]);

    // Setup: initialize default shortcut and macOS permissions
    #[cfg(not(target_os = "android"))]
    let builder = builder.setup(|app| {
        // Register default shortcut (will be overridden if frontend has different config)
        let default_shortcut = DEFAULT_CLAUDIA_SHORTCUT
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .expect("failed to parse default shortcut");

        app.global_shortcut()
            .on_shortcut(default_shortcut, |app, _, event| {
                if event.state == GlobalShortcutState::Pressed {
                    toggle_claudia_visibility(app);
                }
            })
            .expect("failed to register default shortcut");

        // Update state to track the default shortcut
        let state = app.state::<ShortcutStateHandle>();
        if let Ok(mut state) = state.lock() {
            state.current_shortcut = Some(DEFAULT_CLAUDIA_SHORTCUT.to_string());
        }

        // macOS: probe TCC-protected folders at startup
        #[cfg(target_os = "macos")]
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let results = permissions::check_folder_permissions();
            let pending: Vec<_> = results
                .iter()
                .filter(|r| !r.granted)
                .map(|r| r.name.as_str())
                .collect();
            if !pending.is_empty() {
                eprintln!("[Permissions] Folders not yet authorized: {:?}", pending);
            }
        });

        // System tray icon
        let show_item = MenuItemBuilder::with_id("show", "Show MyClaudia").build(app)?;
        let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
        let tray_menu = MenuBuilder::new(app)
            .items(&[&show_item, &quit_item])
            .build()?;

        let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png"))
            .expect("failed to load tray icon");

        TrayIconBuilder::with_id("main-tray")
            .icon(tray_icon)
            .icon_as_template(true)
            .menu(&tray_menu)
            .tooltip("MyClaudia")
            .on_menu_event(|app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            })
            .build(app)?;

        Ok(())
    });

    #[cfg(target_os = "android")]
    let builder = builder.setup(|_app| Ok(()));

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(not(target_os = "android"))]
            match event {
                tauri::RunEvent::WindowEvent { label, event, .. } => {
                    if label == "claudia-chat"
                        && matches!(event, tauri::WindowEvent::Focused(false))
                    {
                        let _ = hide_claudia_chat(app.clone());
                    }
                    // Close button on main window: hide to tray instead of quitting
                    if label == "main" {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                }
                tauri::RunEvent::Exit => {
                    server::stop_server_sync();
                }
                _ => {}
            }
        });
}
