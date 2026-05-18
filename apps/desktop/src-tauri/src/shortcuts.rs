#![cfg(not(target_os = "android"))]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState as GlobalShortcutState};

use crate::claudia_chat::toggle_claudia_visibility;

// Global shortcut state
pub const DEFAULT_CLAUDIA_SHORTCUT: &str = "CmdOrCtrl+Shift+.";

pub struct ShortcutConfigState {
    pub current_shortcut: Option<String>,
}

pub type ShortcutStateHandle = Mutex<ShortcutConfigState>;

/// Update the global shortcut for toggling Claudia visibility.
/// Pass `None` to disable the shortcut.
#[tauri::command]
pub fn update_global_shortcut(
    app: tauri::AppHandle,
    shortcut: Option<String>,
) -> Result<(), String> {
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
