#!/usr/bin/env bash
# Build macOS desktop app (DMG + app bundle)
# Requires: Rust, Node.js, pnpm
# Run on macOS only
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Preflight checks ---
if [[ "$(uname)" != "Darwin" ]]; then
  echo "ERROR: This script must be run on macOS"
  exit 1
fi

for cmd in rustup pnpm; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done

# --- Version bump ---
echo "=== Version bump ==="
./scripts/version-bump.sh --platform macos --bump
echo ""

# Read version for output naming
VERSION=$(python3 -c "import json; d=json.load(open('version.json')); print(f\"{d['major']}.{d['minor']}.2{d['build']:02d}\")")
ARCH=$(uname -m)  # aarch64 or x86_64
echo "Version: $VERSION  Arch: $ARCH"

# --- Server bundle ---
echo "=== Building server bundle ==="
pnpm -r run build
pnpm --filter @my-claudia/server run bundle
echo ""

# --- Build ---
echo "Building macOS desktop app..."
pnpm --filter @my-claudia/desktop exec tauri build

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"
echo ""

# --- Rename outputs with version ---
echo "=== Renaming outputs with version ==="

# Rename .app → MyClaudia-{version}.app
if [ -d "$BUNDLE_DIR/macos/MyClaudia.app" ]; then
  VERSIONED_APP="$BUNDLE_DIR/macos/MyClaudia-${VERSION}.app"
  rm -rf "$VERSIONED_APP"
  mv "$BUNDLE_DIR/macos/MyClaudia.app" "$VERSIONED_APP"
  echo "  APP: $VERSIONED_APP"
fi

# Rename .dmg → MyClaudia-{version}_{arch}.dmg
if [ -d "$BUNDLE_DIR/dmg" ]; then
  for dmg in "$BUNDLE_DIR"/dmg/MyClaudia_*.dmg; do
    [ -f "$dmg" ] || continue
    VERSIONED_DMG="$BUNDLE_DIR/dmg/MyClaudia-${VERSION}_${ARCH}.dmg"
    mv "$dmg" "$VERSIONED_DMG"
    echo "  DMG: $VERSIONED_DMG"
    ls -lh "$VERSIONED_DMG"
  done
fi

echo ""
echo "=== Build complete: MyClaudia $VERSION ==="
