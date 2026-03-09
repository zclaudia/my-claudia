#[cfg(all(not(target_os = "android"), not(debug_assertions)))]
use tauri::Manager;

#[cfg(not(target_os = "android"))]
mod server;

#[cfg(not(target_os = "android"))]
mod permissions;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to MyClaudia!", name)
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
        permissions::check_full_disk_access,
        permissions::open_full_disk_access_settings,
        permissions::check_folder_permissions,
        permissions::open_files_and_folders_settings,
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
