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

# Prefer rustup-managed toolchain over Homebrew Rust
export PATH="$HOME/.cargo/bin:$PATH"

# Ensure Node.js is available (fnm / nvm)
if command -v fnm >/dev/null 2>&1; then eval "$(fnm env)"; fi
if command -v nvm >/dev/null 2>&1; then nvm use 2>/dev/null || true; fi

for cmd in rustup pnpm; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done

# --- Smart version bump ---
# Uses git tags to track builds:
#   - HEAD has build-* tag + clean tree → reuse version
#   - HEAD has no build-* tag → new commits exist → bump + tag
#   - Dirty working tree → dev build (no bump, -dev suffix)
echo "=== Version check ==="
MAJOR=$(python3 -c "import json; print(json.load(open('version.json'))['major'])")
MINOR=$(python3 -c "import json; print(json.load(open('version.json'))['minor'])")
HAS_DIRTY=$(git status --porcelain | head -1)
HAS_BUILD_TAG=$(git tag --points-at HEAD 2>/dev/null | grep '^build-' | head -1 || true)

if [ -n "$HAS_DIRTY" ]; then
  echo "Dirty working tree → dev build"
  LATEST_TAG=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | head -1)
  CURRENT_BUILD=$(echo "$LATEST_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
  [ -z "$CURRENT_BUILD" ] && CURRENT_BUILD=0
  eval "$(./scripts/version-bump.sh --platform macos --set-build "$CURRENT_BUILD" --dev-suffix)"

elif [ -z "$HAS_BUILD_TAG" ]; then
  echo "New commits detected → bumping version"
  eval "$(./scripts/version-bump.sh --platform macos --bump)"

  TAG_NAME="build-${MAJOR}.${MINOR}-${BUILD}"
  git tag "$TAG_NAME"
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
  eval "$(./scripts/version-bump.sh --platform macos --set-build "$CURRENT_BUILD")"
fi

ARCH=$(uname -m)
echo "Version: $VERSION  Arch: $ARCH"
echo ""

# --- Install / update dependencies ---
echo "=== Installing dependencies ==="
pnpm install
echo ""

# --- Server bundle ---
echo "=== Building server bundle ==="
export APP_VERSION="$VERSION"
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
  STALE_DISKS=$(hdiutil info 2>/dev/null | grep -A20 "image-path.*$BUNDLE_DIR" | grep '/dev/disk' | awk '{print $1}' | grep -o '/dev/disk[0-9]*' | sort -u || true)
  for disk in $STALE_DISKS; do
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
pnpm --filter @my-claudia/desktop exec tauri build --config "{\"version\":\"$VERSION\",\"build\":{\"beforeBuildCommand\":\"\"}}"
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

# --- Generate update manifest (latest.json) ---
# When TAURI_SIGNING_PRIVATE_KEY is set, `tauri build` automatically produces:
#   - MyClaudia.app.tar.gz  (the update payload)
#   - MyClaudia.app.tar.gz.sig  (EdDSA signature)
TAR_GZ="$BUNDLE_DIR/macos/MyClaudia.app.tar.gz"
TAR_SIG="$BUNDLE_DIR/macos/MyClaudia.app.tar.gz.sig"

if [ -f "$TAR_GZ" ] && [ -f "$TAR_SIG" ]; then
  echo "=== Generating update manifest ==="
  SIGNATURE=$(cat "$TAR_SIG")
  PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  DOWNLOAD_URL="https://github.com/zhvala/my-claudia/releases/download/v${VERSION}/MyClaudia.app.tar.gz"

  cat > "$BUNDLE_DIR/latest.json" << MANIFEST_EOF
{
  "version": "${VERSION}",
  "notes": "MyClaudia ${VERSION}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${SIGNATURE}",
      "url": "${DOWNLOAD_URL}"
    },
    "darwin-x86_64": {
      "signature": "${SIGNATURE}",
      "url": "${DOWNLOAD_URL}"
    }
  }
}
MANIFEST_EOF

  echo "  Generated: $BUNDLE_DIR/latest.json"
  echo "  TAR.GZ:    $TAR_GZ"
  echo "  Signature: $TAR_SIG"

  # --- Optional: Upload to GitHub Release ---
  if command -v gh >/dev/null 2>&1 && [ "${SKIP_RELEASE:-}" != "1" ]; then
    echo ""
    echo "=== Uploading to GitHub Release ==="
    TAG="v${VERSION}"

    # Create draft release (idempotent)
    gh release create "$TAG" --title "MyClaudia $VERSION" --notes "MyClaudia $VERSION" --draft 2>/dev/null || true

    # Upload artifacts (overwrite if exist)
    UPLOAD_FILES=("$TAR_GZ" "$BUNDLE_DIR/latest.json")
    [ -f "${VERSIONED_DMG:-}" ] && UPLOAD_FILES+=("$VERSIONED_DMG")

    gh release upload "$TAG" "${UPLOAD_FILES[@]}" --clobber
    echo "  Uploaded to: https://github.com/zhvala/my-claudia/releases/tag/$TAG"
    echo "  NOTE: Release is in DRAFT state. Publish it to make the update live."
  fi
else
  echo ""
  echo "  NOTE: No update artifacts generated."
  echo "  To enable auto-update signing, set TAURI_SIGNING_PRIVATE_KEY before building:"
  echo "    export TAURI_SIGNING_PRIVATE_KEY=\$(cat ~/.tauri/myClaudia.key)"
fi

echo ""
echo "=== Build complete: MyClaudia $VERSION ==="
