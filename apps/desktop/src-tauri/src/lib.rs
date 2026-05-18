#[cfg(not(target_os = "android"))]
use std::sync::Mutex;
#[cfg(not(target_os = "android"))]
use tauri::menu::{MenuBuilder, MenuItemBuilder};
#[cfg(not(target_os = "android"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(target_os = "android"))]
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState as GlobalShortcutState};

#[cfg(not(target_os = "android"))]
mod server;

#[cfg(not(target_os = "android"))]
mod permissions;

#[cfg(not(target_os = "android"))]
mod network_probe;

#[cfg(target_os = "windows")]
mod wsl;

#[cfg(target_os = "android")]
mod android_bridge;

#[cfg(not(target_os = "android"))]
mod claudia_ball;

#[cfg(not(target_os = "android"))]
mod claudia_chat;

#[cfg(not(target_os = "android"))]
mod notch;

#[cfg(not(target_os = "android"))]
mod shortcuts;

#[cfg(not(target_os = "android"))]
use shortcuts::{ShortcutConfigState, ShortcutStateHandle, DEFAULT_CLAUDIA_SHORTCUT};

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
            notch::list_windows,
            claudia_ball::create_claudia_ball,
            claudia_chat::toggle_claudia_chat,
            claudia_chat::show_claudia_chat,
            claudia_chat::hide_claudia_chat,
            claudia_chat::preload_claudia_chat,
            shortcuts::update_global_shortcut,
            notch::list_monitors,
            notch::create_notch_window,
            notch::resize_notch_window,
            notch::set_notch_passthrough,
            notch::check_notch_hover,
            notch::check_notch_panel_hover,
            notch::move_notch_to_monitor,
            notch::recenter_notch,
            #[cfg(target_os = "windows")]
            wsl::wsl_exec,
            #[cfg(target_os = "windows")]
            wsl::wsl_start_server,
        ]);

    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        android_bridge::android_get_ntfy_bridge_status,
        android_bridge::android_sync_ntfy_bridge,
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
                    claudia_chat::toggle_claudia_visibility(app);
                }
            })
            .expect("failed to register default shortcut");

        // Update state to track the default shortcut
        let state = app.state::<ShortcutStateHandle>();
        if let Ok(mut state) = state.lock() {
            state.current_shortcut = Some(DEFAULT_CLAUDIA_SHORTCUT.to_string());
        }

        // macOS: listen for display configuration changes (monitor plug/unplug/rearrange)
        // and recenter the notch window automatically.
        #[cfg(target_os = "macos")]
        {
            let app_handle = app.handle().clone();
            std::thread::spawn(move || unsafe {
                use objc2::msg_send;
                use objc2::runtime::{AnyClass, AnyObject};
                use objc2_foundation::NSString;

                let nc: *mut AnyObject = msg_send![
                    AnyClass::get(c"NSNotificationCenter").unwrap(),
                    defaultCenter
                ];
                if nc.is_null() {
                    return;
                }

                let name = NSString::from_str("NSApplicationDidChangeScreenParametersNotification");

                let handle = app_handle.clone();
                let block = block2::StackBlock::new(move |_notif: *mut AnyObject| {
                    notch::recenter_notch_on_current_screen(&handle);
                });
                let block = block.copy();

                let _: *mut AnyObject = msg_send![
                    nc,
                    addObserverForName: &*name,
                    object: std::ptr::null::<AnyObject>(),
                    queue: std::ptr::null::<AnyObject>(),
                    usingBlock: &*block
                ];
            });
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

        let tray_icon =
            tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png"))
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
                        let _ = claudia_chat::hide_claudia_chat(app.clone());
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
