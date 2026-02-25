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
        .plugin(tauri_plugin_shell::init());

    #[cfg(not(target_os = "android"))]
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

    // On macOS, probe TCC-protected folders at startup to trigger consent dialogs
    // while the user is at the keyboard, rather than later during remote sessions.
    #[cfg(target_os = "macos")]
    let builder = builder.setup(|_app| {
        std::thread::spawn(|| {
            // Small delay so the window appears first, then TCC dialogs overlay it
            std::thread::sleep(std::time::Duration::from_secs(1));
            permissions::check_folder_permissions();
        });
        Ok(())
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            #[cfg(not(target_os = "android"))]
            if let tauri::RunEvent::Exit = event {
                server::stop_server_sync();
            }
        });
}
