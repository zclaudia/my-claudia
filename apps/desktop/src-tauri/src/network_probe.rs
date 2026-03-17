use std::collections::HashSet;
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use url::Url;

#[derive(Serialize)]
pub struct NetworkProbeResult {
    pub base_url: String,
    pub host: String,
    pub port: u16,
    pub ok: bool,
    pub detail: String,
}

fn load_opencode_config() -> Option<Value> {
    let home = std::env::var("HOME").ok()?;
    let paths = [
        PathBuf::from(&home).join(".config/opencode/opencode.json"),
        PathBuf::from(&home).join(".config/opencode/config.json"),
    ];

    for path in paths {
        let raw = match fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let parsed = match serde_json::from_str::<Value>(&raw) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        return Some(parsed);
    }

    None
}

fn extract_base_urls(config: &Value) -> Vec<String> {
    let mut urls = HashSet::new();
    let Some(provider) = config.get("provider").and_then(Value::as_object) else {
        return vec![];
    };

    for provider_config in provider.values() {
        let Some(base_url) = provider_config
            .get("options")
            .and_then(|value| value.get("baseURL"))
            .and_then(Value::as_str)
        else {
            continue;
        };

        let trimmed = base_url.trim();
        if !trimmed.is_empty() {
            urls.insert(trimmed.to_string());
        }
    }

    let mut items: Vec<_> = urls.into_iter().collect();
    items.sort();
    items
}

fn probe_url(base_url: &str) -> NetworkProbeResult {
    let parsed = match Url::parse(base_url) {
        Ok(url) => url,
        Err(err) => {
            return NetworkProbeResult {
                base_url: base_url.to_string(),
                host: String::new(),
                port: 0,
                ok: false,
                detail: format!("invalid URL: {}", err),
            };
        }
    };

    let host = parsed.host_str().unwrap_or_default().to_string();
    let port = parsed.port_or_known_default().unwrap_or(0);
    let addr_str = format!("{}:{}", host, port);

    let addrs = match addr_str.to_socket_addrs() {
        Ok(addrs) => addrs.collect::<Vec<_>>(),
        Err(err) => {
            return NetworkProbeResult {
                base_url: base_url.to_string(),
                host,
                port,
                ok: false,
                detail: format!("resolve failed: {}", err),
            };
        }
    };

    let timeout = Duration::from_secs(3);
    let mut last_error = String::from("no addresses resolved");

    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(_) => {
                return NetworkProbeResult {
                    base_url: base_url.to_string(),
                    host,
                    port,
                    ok: true,
                    detail: format!("tcp connect ok via {}", addr),
                };
            }
            Err(err) => {
                last_error = format!("tcp connect failed via {}: {}", addr, err);
            }
        }
    }

    NetworkProbeResult {
        base_url: base_url.to_string(),
        host,
        port,
        ok: false,
        detail: last_error,
    }
}

#[tauri::command]
pub fn probe_opencode_endpoints() -> Vec<NetworkProbeResult> {
    let Some(config) = load_opencode_config() else {
        return vec![];
    };

    extract_base_urls(&config)
        .into_iter()
        .map(|base_url| probe_url(&base_url))
        .collect()
}

#[tauri::command]
pub fn probe_network_endpoint(base_url: String) -> NetworkProbeResult {
    probe_url(&base_url)
}
