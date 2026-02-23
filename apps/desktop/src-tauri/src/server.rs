use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static SERVER_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

#[derive(serde::Serialize)]
pub struct ServerResult {
    pub port: u16,
}

/// Start the embedded Node.js server as a child process.
/// Returns the port number once SERVER_READY:<port> is detected on stdout.
#[tauri::command]
pub async fn start_server(
    app: tauri::AppHandle,
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
