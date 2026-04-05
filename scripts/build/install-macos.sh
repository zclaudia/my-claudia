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

# --- Write upgrader script and submit as launchd job ---
# The upgrader runs as an independent launchd job so it survives when
# MyClaudia (our parent process) is killed during the upgrade.
UPGRADER="/tmp/myclaudia-upgrade-$$.sh"
UPGRADER_LOG="/tmp/myclaudia-upgrade-$$.log"
UPGRADER_LABEL="com.myClaudia.upgrader.$$"
cat > "$UPGRADER" << UPGRADE_EOF
#!/bin/bash
exec > "$UPGRADER_LOG" 2>&1
echo "[\$(date)] Upgrader started"

APP_SRC="$APP_SRC"
APP_DEST="$APP_DEST"

# Close running app
if pgrep -x "my-claudia" >/dev/null 2>&1; then
  echo "Closing MyClaudia..."
  osascript -e 'quit app "MyClaudia"' 2>/dev/null || true
  for i in {1..10}; do
    pgrep -x "my-claudia" >/dev/null 2>&1 || break
    sleep 0.5
  done
  # Force kill if still running
  pkill -9 -x "my-claudia" 2>/dev/null || true
  sleep 1
fi

echo "Installing \$APP_SRC → \$APP_DEST"
rm -rf "\$APP_DEST"
cp -R "\$APP_SRC" "\$APP_DEST"

# Verify critical files were copied
if [ ! -f "\$APP_DEST/Contents/Resources/server/domains/plugins/mcp-bridge.js" ]; then
  echo "ERROR: domains/plugins/mcp-bridge.js missing after install!"
  exit 1
fi
echo "Install verified OK"

# Relaunch
UID_NUM=\$(id -u)
launchctl asuser "\$UID_NUM" open "\$APP_DEST"
echo "[\$(date)] Upgrade complete, app relaunched"

# Clean up upgrader and launchd job
launchctl remove "$UPGRADER_LABEL" 2>/dev/null || true
rm -f "$UPGRADER"
UPGRADE_EOF
chmod +x "$UPGRADER"

echo "=== Starting upgrade (close → install → relaunch) ==="
echo "  Log: $UPGRADER_LOG"

# Submit as a one-shot launchd job — fully independent of our process tree.
# This survives even if our entire process group is killed.
launchctl submit -l "$UPGRADER_LABEL" -- /bin/bash "$UPGRADER"

echo "  Upgrade job submitted (label: $UPGRADER_LABEL)"
echo "  The app will close, update, and relaunch automatically."
echo ""
echo "=== Build complete ==="
