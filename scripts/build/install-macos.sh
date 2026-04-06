#!/usr/bin/env bash
# Build, close running app, install to /Applications, and relaunch.
# Usage: bash scripts/install-macos.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

# --- Build ---
bash scripts/build-macos.sh

APP_SRC="$(pwd)/apps/desktop/src-tauri/target/release/bundle/macos/MyClaudia.app"
APP_DEST="/Applications/MyClaudia.app"

if [ ! -d "$APP_SRC" ]; then
  echo "ERROR: Build output not found at $APP_SRC"
  exit 1
fi

echo "=== Starting upgrade (close → install → relaunch) ==="

# --- Close running app ---
# This script runs from the user's shell, not as a child of MyClaudia,
# so killing MyClaudia does not affect this script. No need for launchd.
if pgrep -x "my-claudia" >/dev/null 2>&1; then
  echo "  Closing MyClaudia..."
  osascript -e 'quit app "MyClaudia"' 2>/dev/null || true
  for _ in {1..10}; do
    pgrep -x "my-claudia" >/dev/null 2>&1 || break
    sleep 0.5
  done
  # Force kill if still running
  pkill -9 -x "my-claudia" 2>/dev/null || true
  sleep 1
fi

# --- Install ---
echo "  Installing $APP_SRC → $APP_DEST"
rm -rf "$APP_DEST"
cp -R "$APP_SRC" "$APP_DEST"

# Verify critical files were copied
if [ ! -f "$APP_DEST/Contents/Resources/server/domains/plugins/mcp-bridge.js" ]; then
  echo "ERROR: domains/plugins/mcp-bridge.js missing after install!"
  exit 1
fi
echo "  Install verified OK"

# --- Relaunch ---
open "$APP_DEST"
echo "  App relaunched"
echo ""
echo "=== Install complete ==="
