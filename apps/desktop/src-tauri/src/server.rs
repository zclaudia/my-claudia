use std::io::{BufRead, BufReader, Write as IoWrite};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static SERVER_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
/// Data directory path, set once at start_server for use by cleanup functions.
static DATA_DIR: Mutex<Option<String>> = Mutex::new(None);

#[derive(serde::Serialize)]
pub struct ServerResult {
    pub port: u16,
}

/// Write a debug log line to a file in the data directory for troubleshooting.
fn debug_log(data_dir: &str, msg: &str) {
    let log_path = std::path::Path::new(data_dir).join("server-debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(f, "[{}] {}", chrono_now(), msg);
    }
    eprintln!("[EmbeddedServer/Rust] {}", msg);
}

fn chrono_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", dur.as_secs())
}

// --- PID file management ---

fn pid_file_path(data_dir: &str) -> std::path::PathBuf {
    std::path::Path::new(data_dir).join("server.pid")
}

fn write_pid_file(data_dir: &str, pid: u32) {
    let path = pid_file_path(data_dir);
    if let Ok(mut f) = std::fs::File::create(&path) {
        let _ = write!(f, "{}", pid);
    }
}

fn remove_pid_file(data_dir: &str) {
    let _ = std::fs::remove_file(pid_file_path(data_dir));
}

/// Kill the process recorded in the pid file (orphan from a previous run).
fn cleanup_stale_pid_file(data_dir: &str) {
    let path = pid_file_path(data_dir);
    if let Ok(contents) = std::fs::read_to_string(&path) {
        if let Ok(pid) = contents.trim().parse::<i32>() {
            // Check if process is still alive
            #[cfg(unix)]
            {
                let alive = unsafe { libc::kill(pid, 0) } == 0;
                if alive {
                    eprintln!("[EmbeddedServer/Rust] Killing orphaned server (pid={})", pid);
                    unsafe { libc::kill(pid, libc::SIGTERM); }
                    // Brief wait for it to exit
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    // Force kill if still alive
                    let still_alive = unsafe { libc::kill(pid, 0) } == 0;
                    if still_alive {
                        unsafe { libc::kill(pid, libc::SIGKILL); }
                    }
                }
            }
        }
        // Remove stale pid file
        let _ = std::fs::remove_file(&path);
    }
}

// --- Shell PATH resolution ---

/// Resolve the user's login shell PATH.
/// GUI apps on macOS don't inherit the full shell environment (nvm, homebrew, etc.),
/// so we run the user's login shell to extract the real PATH.
fn resolve_shell_path(data_dir: &str) -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home = std::env::var("HOME").unwrap_or_else(|_| String::new());
    let current_path = std::env::var("PATH").unwrap_or_default();

    debug_log(data_dir, &format!("SHELL={}, HOME={}, current PATH={}", shell, home, current_path));

    // Use -l (login) only — NOT -i (interactive).
    // Interactive mode sources .zshrc which can trigger macOS TCC permission
    // dialogs (e.g. "network volume" access) from user shell plugins.
    // Login mode sources .zprofile/.zshenv which covers Homebrew, nvm PATH setup.
    // Anything missed is handled by build_fallback_path().
    let output = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .env("HOME", &home)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    match &output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            debug_log(data_dir, &format!("Resolved shell PATH: {}", path));
            path
        }
        Ok(out) => {
            debug_log(data_dir, &format!(
                "Shell exited with status={}, stderr={}",
                out.status,
                String::from_utf8_lossy(&out.stderr)
            ));
            build_fallback_path(&current_path, &home, data_dir)
        }
        Err(e) => {
            debug_log(data_dir, &format!("Failed to spawn shell: {}", e));
            build_fallback_path(&current_path, &home, data_dir)
        }
    }
}

fn build_fallback_path(current: &str, home: &str, data_dir: &str) -> String {
    let mut paths: Vec<String> = vec![current.to_string()];
    for p in &["/opt/homebrew/bin", "/usr/local/bin"] {
        if std::path::Path::new(p).is_dir() {
            paths.push(p.to_string());
        }
    }
    let nvm_dir = format!("{}/.nvm/versions/node", home);
    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
        for entry in entries.flatten() {
            let bin = entry.path().join("bin");
            if bin.is_dir() {
                paths.push(bin.to_string_lossy().to_string());
            }
        }
    }
    paths.push(format!("{}/.local/bin", home));
    paths.push(format!("{}/.cargo/bin", home));
    let fallback = paths.join(":");
    debug_log(data_dir, &format!("Using fallback PATH: {}", fallback));
    fallback
}

// --- Server lifecycle ---

/// Start the embedded Node.js server as a child process.
/// Returns the port number once SERVER_READY:<port> is detected on stdout.
#[tauri::command]
pub async fn start_server(
    _app: tauri::AppHandle,
    server_path: String,
    data_dir: String,
) -> Result<ServerResult, String> {
    // Kill any orphaned server from a previous crash via pid file
    cleanup_stale_pid_file(&data_dir);

    // Store data_dir for use by stop/exit hooks
    if let Ok(mut guard) = DATA_DIR.lock() {
        *guard = Some(data_dir.clone());
    }

    // The node binary is in Contents/MacOS/ (same directory as the main executable)
    let node_bin = std::env::current_exe()
        .map_err(|e| format!("Failed to get current exe: {}", e))?
        .parent()
        .ok_or("Failed to get exe parent dir")?
        .join("node");

    if !node_bin.exists() {
        return Err(format!("Node binary not found at: {}", node_bin.display()));
    }

    // Ensure data directory exists
    std::fs::create_dir_all(&data_dir).ok();

    // Resolve the user's full shell PATH so the server can find CLIs (claude, etc.)
    // Prepend the sidecar directory so child processes (e.g. claude-agent-sdk)
    // can also find our bundled node binary via PATH.
    let sidecar_dir = node_bin.parent().unwrap().to_string_lossy().to_string();
    let shell_path = format!("{}:{}", sidecar_dir, resolve_shell_path(&data_dir));

    eprintln!(
        "[EmbeddedServer/Rust] node={}, server={}, data_dir={}",
        node_bin.display(),
        server_path,
        data_dir
    );

    // Spawn node with the server script
    let mut child = Command::new(&node_bin)
        .arg(&server_path)
        .env("PORT", "0")
        .env("SERVER_HOST", "127.0.0.1")
        .env("MY_CLAUDIA_DATA_DIR", &data_dir)
        .env("PATH", &shell_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn node: {}", e))?;

    let pid = child.id();
    eprintln!("[EmbeddedServer/Rust] Spawned node (pid={})", pid);

    // Write pid file for orphan cleanup
    write_pid_file(&data_dir, pid);

    // Read stdout line by line looking for SERVER_READY:<port>
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let reader = BufReader::new(stdout);
    let mut port: Option<u16> = None;
    let mut lines_iter = reader.lines();

    // Read until we find SERVER_READY
    while let Some(line) = lines_iter.next() {
        match line {
            Ok(line) => {
                eprintln!("[EmbeddedServer/Rust] stdout: {}", line);
                if let Some(rest) = line.strip_prefix("SERVER_READY:") {
                    if let Ok(p) = rest.trim().parse::<u16>() {
                        port = Some(p);
                        break;
                    }
                }
            }
            Err(e) => {
                eprintln!("[EmbeddedServer/Rust] stdout read error: {}", e);
                break;
            }
        }
    }

    // Keep draining stdout in a background thread so the pipe doesn't break (EPIPE).
    // The server continues to write log lines to stdout after SERVER_READY.
    std::thread::spawn(move || {
        for line in lines_iter {
            if let Ok(line) = line {
                eprintln!("[EmbeddedServer/Rust] stdout: {}", line);
            }
        }
        eprintln!("[EmbeddedServer/Rust] stdout stream closed");
    });

    // Drain stderr in a background thread
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    eprintln!("[EmbeddedServer/Rust] stderr: {}", line);
                }
            }
            eprintln!("[EmbeddedServer/Rust] stderr stream closed");
        });
    }

    match port {
        Some(p) => {
            // Store the child process for cleanup
            let mut guard = SERVER_PROCESS.lock().map_err(|e| e.to_string())?;
            *guard = Some(child);
            eprintln!("[EmbeddedServer/Rust] Server ready on port {}", p);
            Ok(ServerResult { port: p })
        }
        None => {
            // Process exited before outputting SERVER_READY
            remove_pid_file(&data_dir);
            let status = child.wait().map_err(|e| e.to_string())?;
            Err(format!(
                "Server process exited without SERVER_READY (status={})",
                status
            ))
        }
    }
}

/// Send SIGTERM and wait for graceful exit, falling back to SIGKILL.
fn graceful_kill(child: &mut Child, timeout_secs: u64) {
    let pid = child.id();

    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, libc::SIGTERM); }
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let _ = child.wait();
        return;
    }

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                eprintln!("[EmbeddedServer/Rust] Server exited gracefully ({})", status);
                return;
            }
            Ok(None) => {
                if start.elapsed() > std::time::Duration::from_secs(timeout_secs) {
                    eprintln!("[EmbeddedServer/Rust] Graceful timeout, sending SIGKILL");
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(_) => return,
        }
    }
}

/// Stop the embedded server process gracefully.
///
/// Sends SIGTERM first so the Node.js server can run its shutdown handlers
/// (disconnect from gateway, close database, etc.). Falls back to SIGKILL
/// if the process doesn't exit within 3 seconds.
#[tauri::command]
pub async fn stop_server() -> Result<(), String> {
    let mut guard = SERVER_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        eprintln!("[EmbeddedServer/Rust] Stopping server (pid={})...", child.id());
        graceful_kill(&mut child, 3);
        // Remove pid file
        if let Ok(dir_guard) = DATA_DIR.lock() {
            if let Some(dir) = dir_guard.as_deref() {
                remove_pid_file(dir);
            }
        }
        eprintln!("[EmbeddedServer/Rust] Server stopped");
    }
    Ok(())
}

/// Kill the server process synchronously (for use in exit hooks).
pub fn stop_server_sync() {
    if let Ok(mut guard) = SERVER_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            eprintln!("[EmbeddedServer/Rust] Exit hook: stopping server (pid={})...", child.id());
            graceful_kill(&mut child, 2);
            // Remove pid file
            if let Ok(dir_guard) = DATA_DIR.lock() {
                if let Some(dir) = dir_guard.as_deref() {
                    remove_pid_file(dir);
                }
            }
            eprintln!("[EmbeddedServer/Rust] Exit hook: server stopped");
        }
    }
}
