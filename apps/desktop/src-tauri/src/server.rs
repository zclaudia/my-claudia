use std::io::{BufRead, BufReader, Write as IoWrite};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static SERVER_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

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

/// Resolve the user's login shell PATH.
/// GUI apps on macOS don't inherit the full shell environment (nvm, homebrew, etc.),
/// so we run the user's login shell to extract the real PATH.
fn resolve_shell_path(data_dir: &str) -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home = std::env::var("HOME").unwrap_or_else(|_| String::new());
    let current_path = std::env::var("PATH").unwrap_or_default();

    debug_log(data_dir, &format!("SHELL={}, HOME={}, current PATH={}", shell, home, current_path));

    // Use -l (login) + -i (interactive) to ensure all config files are sourced
    let output = Command::new(&shell)
        .args(["-l", "-i", "-c", "echo $PATH"])
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
    // Scan common locations where CLI tools might be installed
    let mut paths: Vec<String> = vec![current.to_string()];

    // Homebrew
    for p in &["/opt/homebrew/bin", "/usr/local/bin"] {
        if std::path::Path::new(p).is_dir() {
            paths.push(p.to_string());
        }
    }

    // nvm - scan for installed node versions
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

/// Start the embedded Node.js server as a child process.
/// Returns the port number once SERVER_READY:<port> is detected on stdout.
#[tauri::command]
pub async fn start_server(
    _app: tauri::AppHandle,
    server_path: String,
    data_dir: String,
) -> Result<ServerResult, String> {
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
    let shell_path = resolve_shell_path(&data_dir);

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
            let status = child.wait().map_err(|e| e.to_string())?;
            Err(format!(
                "Server process exited without SERVER_READY (status={})",
                status
            ))
        }
    }
}

/// Stop the embedded server process.
#[tauri::command]
pub async fn stop_server() -> Result<(), String> {
    let mut guard = SERVER_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        eprintln!("[EmbeddedServer/Rust] Killing server process...");
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("[EmbeddedServer/Rust] Server stopped");
    }
    Ok(())
}
