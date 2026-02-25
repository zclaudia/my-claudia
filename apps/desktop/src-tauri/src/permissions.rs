/// macOS permission checks and system settings launchers.
///
/// Full Disk Access cannot be granted programmatically — the user must
/// manually toggle it in System Settings. Folder permissions (Desktop,
/// Documents, Downloads) can be triggered by attempting to read the directory,
/// which causes macOS to show a consent dialog on first access.

/// Check whether the app has Full Disk Access on macOS.
///
/// Probes the TCC database which is always present and protected by FDA.
/// Returns `true` if accessible (FDA granted), `false` otherwise.
#[tauri::command]
pub fn check_full_disk_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::fs::metadata("/Library/Application Support/com.apple.TCC/TCC.db").is_ok()
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
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

// --- Folder permission probing ---

#[derive(serde::Serialize)]
pub struct FolderPermission {
    pub name: String,
    pub granted: bool,
}

/// Probe access to TCC-protected folders (Desktop, Documents, Downloads).
///
/// On first call for each folder, macOS will show a consent dialog.
/// The TCC decision is attributed to MyClaudia.app, so child processes
/// (embedded node server, Claude CLI) inherit the permission.
#[tauri::command]
pub fn check_folder_permissions() -> Vec<FolderPermission> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        ["Desktop", "Documents", "Downloads"]
            .iter()
            .map(|name| {
                let path = format!("{}/{}", home, name);
                let granted = std::fs::read_dir(&path).is_ok();
                FolderPermission {
                    name: name.to_string(),
                    granted,
                }
            })
            .collect()
    }

    #[cfg(not(target_os = "macos"))]
    {
        vec![]
    }
}

/// Open System Settings → Privacy & Security → Files and Folders.
#[tauri::command]
pub fn open_files_and_folders_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders")
            .spawn();
    }
}
