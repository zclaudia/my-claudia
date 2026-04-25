//! Windows-only WSL helpers invoked from the renderer.
//!
//! The Tauri JS shell-plugin's `Command.execute()` hangs when it spawns
//! `wsl.exe bash -c "..."`: the plugin lets the child inherit the
//! GUI-parent's stdin handle, which is never a usable console and never
//! signals EOF. wsl.exe's stdio relay then waits forever for the parent
//! to close its end. Routing through `std::process::Command` with an
//! explicit `Stdio::null()` stdin gives wsl.exe a valid NUL handle that
//! reports EOF immediately, and the call returns as fast as it does
//! from PowerShell.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslExecResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub async fn wsl_exec(args: Vec<String>) -> Result<WslExecResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("wsl")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to spawn wsl: {}", e))?;

        Ok(WslExecResult {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    })
    .await
    .map_err(|e| format!("wsl_exec join error: {}", e))?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslStartServerResult {
    pub port: u16,
}

#[tauri::command]
pub async fn wsl_start_server() -> Result<WslStartServerResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut child = Command::new("wsl")
            .args([
                "bash",
                "-c",
                "cd ~/.my-claudia && exec ./server/node ./server/server.mjs",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn wsl: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[WslServer/Rust] stderr: {}", line);
            }
        });

        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();
        let mut port: Option<u16> = None;

        loop {
            buf.clear();
            match reader.read_line(&mut buf) {
                Ok(0) => break, // EOF — server died before SERVER_READY
                Ok(_) => {
                    let line = buf.trim_end();
                    eprintln!("[WslServer/Rust] stdout: {}", line);
                    if let Some(rest) = line.strip_prefix("SERVER_READY:") {
                        if let Ok(p) = rest.trim().parse::<u16>() {
                            port = Some(p);
                            break;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[WslServer/Rust] stdout read error: {}", e);
                    break;
                }
            }
        }

        // Drain remaining stdout in the background so the pipe stays open
        // and the server keeps writing logs without backpressure.
        std::thread::spawn(move || {
            let mut buf = String::new();
            loop {
                buf.clear();
                match reader.read_line(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => eprintln!("[WslServer/Rust] stdout: {}", buf.trim_end()),
                }
            }
        });

        match port {
            Some(p) => {
                // Intentionally drop `child` without waiting: the server must
                // outlive this command. Dropping the Child handle on Windows
                // closes our side of the handle but does not terminate the
                // process — wsl.exe + bash + node keep running until the user
                // shuts down WSL or closes the app.
                std::mem::drop(child);
                Ok(WslStartServerResult { port: p })
            }
            None => {
                let _ = child.kill();
                let _ = child.wait();
                Err("Server exited before emitting SERVER_READY".to_string())
            }
        }
    })
    .await
    .map_err(|e| format!("wsl_start_server join error: {}", e))?
}
