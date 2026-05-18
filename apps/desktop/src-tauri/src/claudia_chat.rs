#![cfg(not(target_os = "android"))]

use tauri::{LogicalPosition, Manager, Position, WebviewWindowBuilder};

use crate::claudia_ball::{
    claudia_window_url, compute_claudia_chat_position, CHAT_HEIGHT, CHAT_WIDTH,
};
#[cfg(target_os = "macos")]
use crate::claudia_ball::make_chat_transparent;

pub fn show_claudia_chat_window(
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

    #[cfg(not(target_os = "macos"))]
    let _ = chat;
    ball_window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_claudia_chat(
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

#[tauri::command]
pub fn show_claudia_chat(
    app: tauri::AppHandle,
    chat_url: String,
    screen_width: f64,
    screen_height: f64,
) -> Result<(), String> {
    show_claudia_chat_window(app, chat_url, screen_width, screen_height)
}

#[tauri::command]
pub fn hide_claudia_chat(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(chat_window) = app.get_webview_window("claudia-chat") {
        let _ = chat_window.hide();
    }
    if let Some(ball_window) = app.get_webview_window("claudia-ball") {
        let _ = ball_window.show();
    }
    Ok(())
}

#[tauri::command]
pub fn preload_claudia_chat(app: tauri::AppHandle, chat_url: String) -> Result<(), String> {
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

/// Toggle Claudia chat window visibility (shared by command + global shortcut).
pub fn toggle_claudia_visibility(app: &tauri::AppHandle) {
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
