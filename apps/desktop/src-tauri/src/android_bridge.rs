#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize};

const NTFY_BRIDGE_URL: &str = "http://127.0.0.1:9595";

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AndroidNotificationConfig {
    enabled: bool,
    ntfy_url: String,
    ntfy_topic: String,
    #[serde(default)]
    ntfy_auth_mode: String,
    #[serde(default)]
    ntfy_auth_token: String,
    #[serde(default)]
    ntfy_username: String,
    #[serde(default)]
    ntfy_password: String,
}

#[derive(Serialize)]
pub struct AndroidNtfyBridgeStatus {
    ok: bool,
    uptime: Option<String>,
    version: Option<String>,
    subscriptions: serde_json::Value,
}

#[derive(Serialize)]
struct AndroidBridgeSubscribeRequest {
    id: String,
    ntfy_url: String,
    topic: String,
    auth_mode: String,
    auth_token: String,
    username: String,
    password: String,
    package: String,
    receiver: String,
}

fn android_bridge_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn android_get_ntfy_bridge_status() -> Result<AndroidNtfyBridgeStatus, String> {
    let response = android_bridge_client()?
        .get(format!("{NTFY_BRIDGE_URL}/status"))
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("status failed: {}", response.status()));
    }

    let value = response
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())?;
    Ok(AndroidNtfyBridgeStatus {
        ok: value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        uptime: value
            .get("uptime")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned),
        version: value
            .get("version")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned),
        subscriptions: value
            .get("subscriptions")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
    })
}

#[tauri::command]
pub fn android_sync_ntfy_bridge(
    config: AndroidNotificationConfig,
    package_id: String,
) -> Result<(), String> {
    let client = android_bridge_client()?;

    if config.enabled && !config.ntfy_url.trim().is_empty() && !config.ntfy_topic.trim().is_empty()
    {
        let response = client
            .post(format!("{NTFY_BRIDGE_URL}/subscribe"))
            .json(&AndroidBridgeSubscribeRequest {
                id: package_id.clone(),
                ntfy_url: config.ntfy_url.trim().to_string(),
                topic: config.ntfy_topic.trim().to_string(),
                auth_mode: config.ntfy_auth_mode.trim().to_string(),
                auth_token: config.ntfy_auth_token.trim().to_string(),
                username: config.ntfy_username.trim().to_string(),
                password: config.ntfy_password.clone(),
                package: package_id,
                receiver: "com.myClaudia.mobile.NotificationRenderService".to_string(),
            })
            .send()
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "ntfy-bridge register failed: {}",
                response.status()
            ));
        }
        return Ok(());
    }

    let response = client
        .delete(format!("{NTFY_BRIDGE_URL}/subscribe"))
        .json(&serde_json::json!({ "id": package_id }))
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "ntfy-bridge unregister failed: {}",
            response.status()
        ));
    }

    Ok(())
}
