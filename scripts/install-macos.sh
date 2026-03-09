#!/usr/bin/env bash
# Build, close running app, install to /Applications, and relaunch.
# Usage: bash scripts/install-macos.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Build ---
bash scripts/build-macos.sh

APP_SRC="$(pwd)/apps/desktop/src-tauri/target/release/bundle/macos/MyClaudia.app"
APP_DEST="/Applications/MyClaudia.app"

if [ ! -d "$APP_SRC" ]; then
  echo "ERROR: Build output not found at $APP_SRC"
  exit 1
fi

# --- Spawn detached upgrader ---
# The close → copy → relaunch steps run in a background process
# so that killing MyClaudia doesn't kill this script.
echo "=== Starting upgrade (close → install → relaunch) ==="
nohup bash -c '
  APP_SRC="'"$APP_SRC"'"
  APP_DEST="'"$APP_DEST"'"

  # Close running app
  if pgrep -x "MyClaudia" >/dev/null 2>&1; then
    osascript -e "quit app \"MyClaudia\"" 2>/dev/null || true
    for i in {1..10}; do
      pgrep -x "MyClaudia" >/dev/null 2>&1 || break
      sleep 0.5
    done
    pkill -x "MyClaudia" 2>/dev/null || true
    sleep 1
  fi

  # Install
  rm -rf "$APP_DEST"
  cp -R "$APP_SRC" "$APP_DEST"

  # Relaunch
  open "$APP_DEST"
' >/dev/null 2>&1 &

echo "  Upgrade process spawned in background."
echo "  The app will close, update, and relaunch automatically."
echo ""
echo "=== Build complete ==="
