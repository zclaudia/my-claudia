#!/usr/bin/env bash
# Build macOS desktop app (DMG + app bundle)
# Requires: Xcode Command Line Tools, Rust, Node.js, pnpm
# Run on macOS only
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Preflight checks ---
if [[ "$(uname)" != "Darwin" ]]; then
  echo "ERROR: This script must be run on macOS"
  exit 1
fi

for cmd in rustup pnpm xcodebuild; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done

# --- Version bump ---
echo "=== Version bump ==="
./scripts/version-bump.sh --platform macos --bump
echo ""

# --- Build ---
echo "Building macOS desktop app..."
pnpm --filter @my-claudia/desktop exec tauri build

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"
echo ""
echo "=== macOS builds ==="
if [ -d "$BUNDLE_DIR/dmg" ]; then
  echo "  DMG: $(ls "$BUNDLE_DIR"/dmg/*.dmg)"
  ls -lh "$BUNDLE_DIR"/dmg/*.dmg
fi
if [ -d "$BUNDLE_DIR/macos" ]; then
  echo "  APP: $(ls -d "$BUNDLE_DIR"/macos/*.app)"
fi
