#!/usr/bin/env bash
# Build Linux desktop app (deb + rpm)
# Requires: libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Preflight checks ---
export PATH="$HOME/.cargo/bin:$PATH"

for cmd in rustup pnpm; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done

MISSING_DEPS=()
for pkg in libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev; do
  dpkg -s "$pkg" &>/dev/null || MISSING_DEPS+=("$pkg")
done
if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  echo "ERROR: Missing system dependencies: ${MISSING_DEPS[*]}"
  echo "Install with: sudo apt-get install -y ${MISSING_DEPS[*]}"
  exit 1
fi

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
  eval "$(./scripts/version-bump.sh --platform linux --set-build "$CURRENT_BUILD" --dev-suffix)"

elif [ -z "$HAS_BUILD_TAG" ]; then
  echo "New commits detected → bumping version"
  eval "$(./scripts/version-bump.sh --platform linux --bump)"

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
  eval "$(./scripts/version-bump.sh --platform linux --set-build "$CURRENT_BUILD")"
fi
echo ""

# --- Build ---
echo "Building Linux desktop app..."
# Use --bundles to skip AppImage (often fails in WSL2 without xdg-open)
pnpm --filter @my-claudia/desktop exec tauri build --bundles deb,rpm --config "{\"version\":\"$VERSION\"}"

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"
echo ""
echo "=== Linux builds ==="
echo "  DEB: $(ls "$BUNDLE_DIR"/deb/*.deb)"
echo "  RPM: $(ls "$BUNDLE_DIR"/rpm/*.rpm)"
ls -lh "$BUNDLE_DIR"/deb/*.deb "$BUNDLE_DIR"/rpm/*.rpm
