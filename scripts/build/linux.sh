#!/usr/bin/env bash
# Build Linux desktop app (deb + rpm)
# Requires: libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev
set -euo pipefail
cd "$(dirname "$0")/../.."

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

# Release remote config
RELEASE_REMOTE="${RELEASE_REMOTE:-origin}"

# --- Version selection ---
# In CI (RELEASE_VERSION + RELEASE_BUILD set by workflow), use those directly.
# Locally, always build a dev version from the latest release tag without
# advancing the next release number.
echo "=== Version check ==="

if [ -n "${RELEASE_VERSION:-}" ] && [ -n "${RELEASE_BUILD:-}" ]; then
  # CI mode: use workflow-provided version
  VERSION="$RELEASE_VERSION"
  BUILD="$RELEASE_BUILD"
  VERSION_CODE="${RELEASE_VERSION_CODE:-0}"
  MAJOR=$(echo "$VERSION" | cut -d. -f1)
  MINOR=$(echo "$VERSION" | cut -d. -f2)
  echo "Using CI-provided version: $VERSION (build $BUILD)"
else
  echo "Local build → deriving dev version from latest release tag"
  eval "$(./scripts/version-bump.sh --platform linux --dev-suffix)"
fi
echo ""

# --- Install / update dependencies ---
echo "=== Installing dependencies ==="
pnpm install
echo ""

# --- Pre-build (shared + server) ---
echo "=== Building shared packages ==="
export APP_VERSION="$VERSION"
pnpm -r run build
pnpm --filter @my-claudia/server run bundle
echo ""

# --- Build ---
echo "Building Linux desktop app..."
# Use --bundles to skip AppImage (often fails in WSL2 without xdg-open)
# Override beforeBuildCommand to empty since we already built above.
TAURI_CONFIG_FILE="apps/desktop/src-tauri/tauri.linux.release.generated.json"

# Tauri requires strict semver (MAJOR.MINOR.PATCH) — strip v prefix and prerelease suffixes
TAURI_VERSION="$(echo "$VERSION" | sed 's/^v//; s/-.*//')"

cat > "$TAURI_CONFIG_FILE" <<EOF
{
  "version": "$TAURI_VERSION",
  "build": {
    "beforeBuildCommand": ""
  },
  "bundle": {
    "createUpdaterArtifacts": false,
    "resources": {
      "../../../server/bundle/": "server/"
    }
  }
}
EOF

pnpm --filter @my-claudia/desktop exec tauri build --bundles deb,rpm --config src-tauri/tauri.linux.release.generated.json || {
  rm -f "$TAURI_CONFIG_FILE"
  echo "ERROR: Tauri build failed"
  exit 1
}
rm -f "$TAURI_CONFIG_FILE"

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"
echo ""
echo "=== Linux builds ==="
echo "  DEB: $(ls "$BUNDLE_DIR"/deb/*.deb)"
echo "  RPM: $(ls "$BUNDLE_DIR"/rpm/*.rpm)"
ls -lh "$BUNDLE_DIR"/deb/*.deb "$BUNDLE_DIR"/rpm/*.rpm
