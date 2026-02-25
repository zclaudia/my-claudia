/// macOS Full Disk Access permission check and system settings launcher.
///
/// Full Disk Access cannot be granted programmatically — the user must
/// manually toggle it in System Settings. These commands let the frontend
/// check the current status and open the correct settings pane.

/// Check whether the app has Full Disk Access on macOS.
///
/// Probes the TCC database which is always present and protected by FDA.
/// Returns `true` if accessible (FDA granted), `false` otherwise.
#[tauri::command]
pub fn check_full_disk_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        // The TCC database is always protected by Full Disk Access.
        // If we can stat it, FDA is granted.
        std::fs::metadata("/Library/Application Support/com.apple.TCC/TCC.db").is_ok()
    }

    #[cfg(not(target_os = "macos"))]
    {
        true // Not macOS — permission not applicable
    }
}

/// Open System Settings → Privacy & Security → Full Disk Access.
#[tauri::command]
pub fn open_full_disk_access_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn();
    }
}
