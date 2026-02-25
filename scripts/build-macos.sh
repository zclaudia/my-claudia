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

# --- Smart version bump ---
# Only bump when there are actual changes since the last version bump:
#   1. Working tree has uncommitted changes, OR
#   2. HEAD commit differs from version.json's recorded commit
echo "=== Version check ==="
VERSION_COMMIT=$(python3 -c "import json; d=json.load(open('version.json')); print(d.get('commit', ''))")
HEAD_COMMIT=$(git rev-parse --short HEAD)
HAS_DIRTY=$(git status --porcelain | head -1)

if [ -n "$HAS_DIRTY" ] || [ "$VERSION_COMMIT" != "$HEAD_COMMIT" ]; then
  echo "Changes detected (dirty=$([[ -n "$HAS_DIRTY" ]] && echo yes || echo no), version_commit=$VERSION_COMMIT, head=$HEAD_COMMIT)"
  echo "Bumping version..."
  ./scripts/version-bump.sh --platform macos --bump

  # Auto-commit version bump
  git add version.json package.json apps/desktop/package.json \
    apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
    apps/desktop/src-tauri/tauri.conf.json
  git commit -m "chore: version bump for macOS build" --no-verify 2>/dev/null || true
else
  echo "No changes since last bump (commit=$VERSION_COMMIT). Reusing current version."
  ./scripts/version-bump.sh --platform macos
fi
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

# --- Clean stale bundle artifacts ---
# Tauri's bundle_dmg.sh (create-dmg) fails when:
#   1. Old DMG files exist (hdiutil convert -o won't overwrite)
#   2. Stale DMG images are still mounted from failed previous runs
#      (causes volume name conflicts and AppleScript "Can't get disk" errors)
BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"
if [ -d "$BUNDLE_DIR" ]; then
  echo "=== Cleaning stale bundle artifacts ==="
  # Detach any mounted DMG images from previous builds
  # In hdiutil info, /dev/disk lines appear AFTER the image-path line
  hdiutil info 2>/dev/null | grep -A20 "image-path.*$BUNDLE_DIR" | grep '/dev/disk' | awk '{print $1}' | grep -o '/dev/disk[0-9]*' | sort -u | while read -r disk; do
    echo "  Detaching stale mount: $disk"
    hdiutil detach "$disk" -force 2>/dev/null || true
  done
  # Remove old DMG files
  find "$BUNDLE_DIR/dmg" -name '*.dmg' -delete 2>/dev/null || true
  # Remove temp read-write DMG images from failed runs
  find "$BUNDLE_DIR/macos" -name 'rw.*.dmg' -delete 2>/dev/null || true
  echo ""
fi

# --- Build ---
echo "Building macOS desktop app..."
pnpm --filter @my-claudia/desktop exec tauri build
echo ""

# --- Rename outputs with version ---
echo "=== Renaming outputs with version ==="

# .app stays as MyClaudia.app (it's a folder, no version needed)
if [ -d "$BUNDLE_DIR/macos/MyClaudia.app" ]; then
  echo "  APP: $BUNDLE_DIR/macos/MyClaudia.app"
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
