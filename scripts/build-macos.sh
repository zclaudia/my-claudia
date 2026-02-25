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
# Uses git tags to track builds:
#   - HEAD has build-* tag + clean tree → reuse version
#   - HEAD has no build-* tag → new commits exist → bump
#   - Dirty working tree → dev build (no bump, -dev suffix)
echo "=== Version check ==="
MAJOR=$(python3 -c "import json; print(json.load(open('version.json'))['major'])")
MINOR=$(python3 -c "import json; print(json.load(open('version.json'))['minor'])")
HAS_DIRTY=$(git status --porcelain | head -1)
HAS_BUILD_TAG=$(git tag --points-at HEAD 2>/dev/null | grep '^build-' | head -1)

if [ -n "$HAS_DIRTY" ]; then
  echo "Dirty working tree → dev build"
  LATEST_TAG=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | head -1)
  CURRENT_BUILD=$(echo "$LATEST_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
  [ -z "$CURRENT_BUILD" ] && CURRENT_BUILD=0
  ./scripts/version-bump.sh --platform macos --set-build "$CURRENT_BUILD" --dev-suffix

elif [ -z "$HAS_BUILD_TAG" ]; then
  echo "New commits detected → bumping version"
  ./scripts/version-bump.sh --platform macos --bump

  git add package.json apps/desktop/package.json \
    apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
    apps/desktop/src-tauri/tauri.conf.json
  git commit -m "chore: version bump for macOS build" --no-verify 2>/dev/null || true

  # Tag the version bump commit
  LATEST_TAG=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | head -1)
  BUILD=$(echo "$LATEST_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
  [ -z "$BUILD" ] && BUILD=1
  TAG_NAME="build-${MAJOR}.${MINOR}-${BUILD}"
  git tag "$TAG_NAME"

  # Push tag to remote
  git push origin "$TAG_NAME" 2>/dev/null || true

  # Clean old tags for this major.minor, keep latest 5
  OLD_TAGS=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | tail -n +6)
  if [ -n "$OLD_TAGS" ]; then
    echo "$OLD_TAGS" | xargs git tag -d
    echo "$OLD_TAGS" | while read -r tag; do
      git push origin --delete "$tag" 2>/dev/null || true
    done
    echo "  Cleaned $(echo "$OLD_TAGS" | wc -l | tr -d ' ') old tag(s)"
  fi

else
  echo "No changes since $HAS_BUILD_TAG. Reusing version."
  CURRENT_BUILD=$(echo "$HAS_BUILD_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
  ./scripts/version-bump.sh --platform macos --set-build "$CURRENT_BUILD"

  # If platform files changed (e.g. switching from Android), commit them
  if [ -n "$(git status --porcelain)" ]; then
    git add package.json apps/desktop/package.json \
      apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
      apps/desktop/src-tauri/tauri.conf.json
    git commit -m "chore: set version for macOS build" --no-verify 2>/dev/null || true
    git tag -f "build-${MAJOR}.${MINOR}-${CURRENT_BUILD}"
  fi
fi
echo ""

# Read version for output naming
LATEST_TAG=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | head -1)
BUILD_NUM=$(echo "$LATEST_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
[ -z "$BUILD_NUM" ] && BUILD_NUM=0
VERSION=$(printf "%d.%d.2%02d" "$MAJOR" "$MINOR" "$BUILD_NUM")
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
