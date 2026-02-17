#!/usr/bin/env bash
# Build Linux desktop app (deb + rpm)
# Requires: libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Preflight checks ---
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

# --- Build ---
echo "Building Linux desktop app..."
# Use --bundles to skip AppImage (often fails in WSL2 without xdg-open)
pnpm --filter @my-claudia/desktop exec tauri build --bundles deb,rpm

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"
echo ""
echo "=== Linux builds ==="
echo "  DEB: $(ls "$BUNDLE_DIR"/deb/*.deb)"
echo "  RPM: $(ls "$BUNDLE_DIR"/rpm/*.rpm)"
ls -lh "$BUNDLE_DIR"/deb/*.deb "$BUNDLE_DIR"/rpm/*.rpm
