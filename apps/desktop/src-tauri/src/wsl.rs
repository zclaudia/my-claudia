//! Windows-only WSL helpers invoked from the renderer.
//!
//! Two distinct Windows quirks both manifest as `wsl bash -c "..."`
//! hanging forever when called from the Tauri main (windowed) process:
//!
//! 1. **stdin handle inheritance.** Without `Stdio::null()`, the child
//!    inherits the windowed parent's stdin handle, which never signals
//!    EOF, so wsl.exe's stdio relay waits indefinitely.
//!
//! 2. **Console allocation.** A windowed Tauri parent has no console.
//!    Without `CREATE_NO_WINDOW`, wsl.exe wedges while Windows tries
//!    to attach the child to a non-existent console — calls from
//!    PowerShell return instantly while calls from Tauri hang forever.
//!
//! Both must be set; either alone still hangs in some scenarios.

use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// 60s is a deliberate compromise: a hot wsl call returns in <1s, but a cold
// distro start (first invocation after Windows boot, or after `wsl --shutdown`)
// can chew through 20-40s before the VM responds. The frontend layers a 3s
// heartbeat on top of this so the user sees progress while we wait.
const WSL_EXEC_TIMEOUT: Duration = Duration::from_secs(60);

fn wsl_command<I, S>(args: I) -> Command
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = Command::new("wsl");
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

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
        let mut child = wsl_command(&args)
            .spawn()
            .map_err(|e| format!("Failed to spawn wsl: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        // Drain pipes in parallel so a chatty child can't deadlock on a full pipe.
        let stdout_thread = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = BufReader::new(stdout).read_to_string(&mut s);
            s
        });
        let stderr_thread = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut s);
            s
        });

        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => {
                    if started.elapsed() >= WSL_EXEC_TIMEOUT {
                        eprintln!(
                            "[wsl_exec] timeout after {}s for args={:?}",
                            WSL_EXEC_TIMEOUT.as_secs(),
                            args
                        );
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(format!(
                            "wsl command timed out after {}s",
                            WSL_EXEC_TIMEOUT.as_secs()
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => return Err(format!("wsl wait error: {}", e)),
            }
        };

        let stdout = stdout_thread.join().unwrap_or_default();
        let stderr = stderr_thread.join().unwrap_or_default();

        Ok(WslExecResult {
            code: status.code().unwrap_or(-1),
            stdout,
            stderr,
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
        let mut child = wsl_command([
            "bash",
            "-c",
            "cd ~/.my-claudia && exec ./server/node ./server/server.mjs",
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn wsl: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        // Buffer the tail of stderr so we can surface the real cause when the
        // server dies before printing SERVER_READY. Keep eprintln'ing each
        // line so app-side logs still capture the full stream.
        let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        {
            let tail = Arc::clone(&stderr_tail);
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[WslServer/Rust] stderr: {}", line);
                    if let Ok(mut t) = tail.lock() {
                        if t.len() >= 50 {
                            t.remove(0);
                        }
                        t.push(line);
                    }
                }
            });
        }

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
                // Give the stderr reader a tick to flush whatever was buffered.
                std::thread::sleep(Duration::from_millis(150));
                let detail = stderr_tail
                    .lock()
                    .map(|t| t.join("\n"))
                    .unwrap_or_default();
                Err(if detail.trim().is_empty() {
                    "Server exited before emitting SERVER_READY".to_string()
                } else {
                    format!(
                        "Server exited before emitting SERVER_READY:\n{}",
                        detail.trim_end()
                    )
                })
            }
        }
    })
    .await
    .map_err(|e| format!("wsl_start_server join error: {}", e))?
}
