//! Windows-only WSL helpers invoked from the renderer.
//!
//! `wsl.exe` depends on console I/O relay to bridge Linux↔Windows stdio.
//! Spawning it from a GUI (windowless) parent requires care:
//!
//! - **stdin** must be `Stdio::null()` so the child doesn't inherit the
//!   GUI parent's stdin handle (which never signals EOF).
//!
//! - **Console allocation**: we intentionally do NOT use `CREATE_NO_WINDOW`.
//!   That flag suppresses console handle creation, which wsl.exe needs for
//!   its internal stdio relay. Instead, we let Windows allocate a real
//!   console for the child (since the GUI parent has none, Windows creates
//!   a new one automatically). A console window may flash briefly — this is
//!   acceptable and can be refined later if needed.

use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// 60s is a deliberate compromise: a hot wsl call returns in <1s, but a cold
// distro start (first invocation after Windows boot, or after `wsl --shutdown`)
// can chew through 20-40s before the VM responds. The frontend layers a 3s
// heartbeat on top of this so the user sees progress while we wait.
const WSL_EXEC_TIMEOUT: Duration = Duration::from_secs(60);

/// Build a `wsl` command that won't hang from a GUI (no-console) parent.
///
/// We launch via `cmd.exe /C wsl ...` so that cmd.exe creates a real
/// console for wsl.exe to attach to (wsl.exe depends on console I/O
/// relay internally). Stdin is null to avoid inheriting the GUI parent's
/// handle. No `CREATE_NO_WINDOW` — that flag suppresses console handle
/// creation which breaks wsl.exe. The console window may flash briefly.
fn wsl_command<I, S>(args: I) -> Command
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut wsl_args: Vec<String> = vec!["/C".to_string(), "wsl".to_string()];
    for arg in args {
        wsl_args.push(arg.as_ref().to_string_lossy().into_owned());
    }
    let mut cmd = Command::new("cmd.exe");
    cmd.args(&wsl_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

fn spawn_pipe_reader<R>(mut reader: R, buf: Arc<Mutex<String>>, done: Arc<Mutex<bool>>)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut chunk = [0_u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&chunk[..n]);
                    if let Ok(mut b) = buf.lock() {
                        b.push_str(&text);
                    }
                }
                Err(_) => break,
            }
        }
        if let Ok(mut d) = done.lock() {
            *d = true;
        }
    });
}

#[cfg(windows)]
fn kill_child_tree(child: &mut Child) {
    use std::os::windows::process::CommandExt;
    // taskkill doesn't need a console — safe to use CREATE_NO_WINDOW here
    // (unlike wsl.exe which depends on console I/O relay).
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let pid = child.id().to_string();
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid, "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.status();
}

#[cfg(not(windows))]
fn kill_child_tree(child: &mut Child) {
    let _ = child.kill();
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslExecResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub async fn wsl_exec(
    args: Vec<String>,
    timeout_secs: Option<u64>,
) -> Result<WslExecResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let timeout = Duration::from_secs(timeout_secs.unwrap_or(WSL_EXEC_TIMEOUT.as_secs()));
        let mut child = wsl_command(&args)
            .spawn()
            .map_err(|e| format!("Failed to spawn wsl: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        // Drain pipes in parallel so a chatty child can't deadlock on a full pipe.
        // We use Arc<Mutex<String>> so we can read partial output even if the
        // thread never finishes (leaked pipe handle from WSL background processes).
        let stdout_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let stderr_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let stdout_done: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
        let stderr_done: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
        spawn_pipe_reader(stdout, Arc::clone(&stdout_buf), Arc::clone(&stdout_done));
        spawn_pipe_reader(stderr, Arc::clone(&stderr_buf), Arc::clone(&stderr_done));

        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => {
                    if started.elapsed() >= timeout {
                        eprintln!(
                            "[wsl_exec] timeout after {}s for args={:?}",
                            timeout.as_secs(),
                            args
                        );
                        kill_child_tree(&mut child);
                        // Wait with a bounded spin — don't block forever if
                        // the wrapped wsl.exe refuses to exit after termination.
                        let kill_deadline = Instant::now() + Duration::from_secs(5);
                        loop {
                            match child.try_wait() {
                                Ok(Some(_)) | Err(_) => break,
                                Ok(None) => {
                                    if Instant::now() >= kill_deadline {
                                        eprintln!("[wsl_exec] child did not exit within 5s after kill, abandoning");
                                        break;
                                    }
                                    std::thread::sleep(Duration::from_millis(50));
                                }
                            }
                        }
                        return Err(format!(
                            "wsl command timed out after {}s",
                            timeout.as_secs()
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => return Err(format!("wsl wait error: {}", e)),
            }
        };

        // Process exited. Give the reader threads a short window to finish
        // draining — if WSL background processes hold the pipe open, don't
        // wait forever.
        let drain_deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let out_ok = stdout_done.lock().map(|d| *d).unwrap_or(true);
            let err_ok = stderr_done.lock().map(|d| *d).unwrap_or(true);
            if (out_ok && err_ok) || Instant::now() >= drain_deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        let stdout = stdout_buf.lock().map(|s| s.clone()).unwrap_or_default();
        let stderr = stderr_buf.lock().map(|s| s.clone()).unwrap_or_default();

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
                kill_child_tree(&mut child);
                let _ = child.wait();
                // Give the stderr reader a tick to flush whatever was buffered.
                std::thread::sleep(Duration::from_millis(150));
                let detail = stderr_tail.lock().map(|t| t.join("\n")).unwrap_or_default();
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
