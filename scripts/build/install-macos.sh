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

# --- Write and spawn a detached upgrader script ---
# We write to a temp file and run it via /bin/bash so it's fully independent
# of the current process tree (survives MyClaudia being killed).
UPGRADER="/tmp/myclaudia-upgrade-$$.sh"
cat > "$UPGRADER" << UPGRADE_EOF
#!/bin/bash
APP_SRC="$APP_SRC"
APP_DEST="$APP_DEST"

# Close running app
if pgrep -x "my-claudia" >/dev/null 2>&1; then
  osascript -e 'quit app "MyClaudia"' 2>/dev/null || true
  for i in {1..10}; do
    pgrep -x "my-claudia" >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -x "my-claudia" 2>/dev/null || true
  sleep 1
fi

# Install
rm -rf "\$APP_DEST"
cp -R "\$APP_SRC" "\$APP_DEST"

# Relaunch — use launchctl asuser to ensure it opens in the GUI session
# (a double-forked background process may lose the SecuritySession)
UID_NUM=\$(id -u)
launchctl asuser "\$UID_NUM" open "\$APP_DEST"

# Clean up
rm -f "$UPGRADER"
UPGRADE_EOF
chmod +x "$UPGRADER"

echo "=== Starting upgrade (close → install → relaunch) ==="
# Double fork: outer subshell exits immediately, orphaning the inner process
# so it's adopted by launchd and survives MyClaudia being killed.
( ( /bin/bash "$UPGRADER" ) & )

echo "  Upgrade process spawned."
echo "  The app will close, update, and relaunch automatically."
echo ""
echo "=== Build complete ==="
