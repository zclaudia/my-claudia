#!/usr/bin/env bash
# Build macOS desktop app (DMG + app bundle)
# Requires: Rust, Node.js, pnpm
# Run on macOS only
set -euo pipefail
cd "$(dirname "$0")/../.."

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

# Load .env if present (for TAURI_SIGNING_PRIVATE_KEY_PATH, etc.)
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# Local macOS signing certificate support.
# CI imports a .p12 into a temporary keychain before building; do the same locally
# when a developer has exported the certificate into ~/.tauri/.
TEMP_KEYCHAIN_PATH=""
cleanup_temp_keychain() {
  if [ -n "$TEMP_KEYCHAIN_PATH" ] && [ -f "$TEMP_KEYCHAIN_PATH" ]; then
    security delete-keychain "$TEMP_KEYCHAIN_PATH" >/dev/null 2>&1 || true
  fi
}
trap cleanup_temp_keychain EXIT

DEFAULT_MACOS_CERT_PATH="$HOME/.tauri/MyClaudia-signing.p12"
DEFAULT_MACOS_CERT_PASSWORD_FILE="$HOME/.tauri/MyClaudia-signing.pwd"
if [ -z "${MACOS_CERT_P12_PATH:-}" ] && [ -f "$DEFAULT_MACOS_CERT_PATH" ]; then
  MACOS_CERT_P12_PATH="$DEFAULT_MACOS_CERT_PATH"
  export MACOS_CERT_P12_PATH
fi
if [ -z "${MACOS_CERT_PASSWORD:-}" ] && [ -f "$DEFAULT_MACOS_CERT_PASSWORD_FILE" ]; then
  MACOS_CERT_PASSWORD="$(tr -d '\r\n' < "$DEFAULT_MACOS_CERT_PASSWORD_FILE")"
  export MACOS_CERT_PASSWORD
fi

if [ "${SKIP_SIGNING:-}" != "1" ] && [ -n "${MACOS_CERT_P12_PATH:-}" ] && [ -f "${MACOS_CERT_P12_PATH}" ]; then
  echo "=== Importing macOS signing certificate into temporary keychain ==="
  TEMP_KEYCHAIN_PATH="$(python3 - <<'PY'
import tempfile
from pathlib import Path

fd, path = tempfile.mkstemp(prefix='my-claudia-build-keychain.', suffix='-db')
Path(path).unlink(missing_ok=True)
print(f"{path}.keychain-db")
PY
)"
  if [ -z "${KEYCHAIN_PASSWORD:-}" ]; then
    KEYCHAIN_PASSWORD="$(python3 - <<'PY'
import secrets
import string

alphabet = string.ascii_letters + string.digits
print(''.join(secrets.choice(alphabet) for _ in range(32)))
PY
)"
  fi
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN_PATH"
  security set-keychain-settings -lut 21600 "$TEMP_KEYCHAIN_PATH"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN_PATH"
  security import "$MACOS_CERT_P12_PATH" -P "${MACOS_CERT_PASSWORD:-}" -A -t cert -f pkcs12 -k "$TEMP_KEYCHAIN_PATH"
  security list-keychains -d user -s "$TEMP_KEYCHAIN_PATH" login.keychain-db
  security default-keychain -d user -s "$TEMP_KEYCHAIN_PATH"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$TEMP_KEYCHAIN_PATH"
  echo "Using temporary keychain: $TEMP_KEYCHAIN_PATH"
  echo ""
fi

# Prefer the existing local Tauri updater keypair when no explicit path is set.
DEFAULT_TAURI_KEY_PATH="$HOME/.tauri/my-claudia.key"
DEFAULT_TAURI_PUBKEY_PATH="$HOME/.tauri/my-claudia.key.pub"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ] && [ -f "$DEFAULT_TAURI_KEY_PATH" ]; then
  TAURI_SIGNING_PRIVATE_KEY_PATH="$DEFAULT_TAURI_KEY_PATH"
  export TAURI_SIGNING_PRIVATE_KEY_PATH
fi

# Read signing key from file path if provided. `tauri build` uses the env var
# contents, while `tauri signer sign` is more reliable with an explicit key file.
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ] && [ -f "${TAURI_SIGNING_PRIVATE_KEY_PATH}" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY
fi

for cmd in rustup pnpm; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done

sign_updater_artifact() {
  local artifact_path="$1"
  local artifact_abs_path="$artifact_path"
  local key_path="${TAURI_SIGNING_PRIVATE_KEY_PATH:-}"
  local temp_key_path=""

  if [ ! -f "$artifact_abs_path" ] && [ -f "$PWD/$artifact_path" ]; then
    artifact_abs_path="$PWD/$artifact_path"
  fi

  if [ -f "$artifact_abs_path" ]; then
    artifact_abs_path="$(cd "$(dirname "$artifact_abs_path")" && pwd)/$(basename "$artifact_abs_path")"
  fi

  if [ -z "$key_path" ] && [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    temp_key_path="$(mktemp /tmp/my-claudia-tauri-key.XXXXXX)"
    chmod 600 "$temp_key_path"
    printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" > "$temp_key_path"
    key_path="$temp_key_path"
  fi

  if [ -z "$key_path" ] || [ ! -f "$key_path" ]; then
    [ -n "$temp_key_path" ] && rm -f "$temp_key_path"
    return 1
  fi

  if [ ! -f "$artifact_abs_path" ]; then
    echo "  WARNING: Updater artifact not found for signing: $artifact_path"
    [ -n "$temp_key_path" ] && rm -f "$temp_key_path"
    return 1
  fi

  local signer_cmd=(
    env
    -u TAURI_SIGNING_PRIVATE_KEY
    -u TAURI_SIGNING_PRIVATE_KEY_PATH
    pnpm
    --filter @my-claudia/desktop
    exec
    tauri
    signer
    sign
    --private-key-path "$key_path"
  )
  if [ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
    signer_cmd+=(--password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD")
  fi
  signer_cmd+=("$artifact_abs_path")

  rm -f "${artifact_abs_path}.sig"
  if "${signer_cmd[@]}"; then
    [ -n "$temp_key_path" ] && rm -f "$temp_key_path"
    return 0
  fi

  [ -n "$temp_key_path" ] && rm -f "$temp_key_path"
  return 1
}

# Release target: prefer the repository that triggered the GitHub Actions run.
# Fallback to a git remote only for local/manual releases.
RELEASE_REMOTE="${RELEASE_REMOTE:-origin}"
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  RELEASE_REPO="$GITHUB_REPOSITORY"
else
  RELEASE_REPO=$(git remote get-url "$RELEASE_REMOTE" 2>/dev/null | sed 's/.*github\.com[:/]\(.*\)\.git/\1/') || RELEASE_REPO=""
fi
echo "Release target: ${GITHUB_REPOSITORY:-$RELEASE_REMOTE} → $RELEASE_REPO"

# --- Smart version bump ---
# In CI (RELEASE_VERSION + RELEASE_BUILD set by workflow), use those directly.
# Locally, use git tags to track builds.
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
  # Local mode: compute from git tags
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
    git push "$RELEASE_REMOTE" "$TAG_NAME" 2>/dev/null || true

    # Clean old tags for this major.minor, keep latest 5
    OLD_TAGS=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | tail -n +6)
    if [ -n "$OLD_TAGS" ]; then
      echo "$OLD_TAGS" | xargs git tag -d
      echo "$OLD_TAGS" | while read -r tag; do
        git push "$RELEASE_REMOTE" --delete "$tag" 2>/dev/null || true
      done
      echo "  Cleaned $(echo "$OLD_TAGS" | wc -l | tr -d ' ') old tag(s)"
    fi

  else
    echo "No changes since $HAS_BUILD_TAG. Reusing version."
    CURRENT_BUILD=$(echo "$HAS_BUILD_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
    eval "$(./scripts/version-bump.sh --platform macos --set-build "$CURRENT_BUILD")"
  fi
fi

ARCH=$(uname -m)
# Map uname -m to Tauri platform identifier
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  TAURI_ARCH="aarch64"
else
  TAURI_ARCH="x86_64"
fi
echo "Version: $VERSION  Arch: $ARCH ($TAURI_ARCH)"
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
# Code signing is ON by default (uses signingIdentity from tauri.conf.json).
# To skip signing (community/local builds): SKIP_SIGNING=1 bash scripts/build-macos.sh
TAURI_CONFIG="{\"version\":\"$VERSION\",\"build\":{\"beforeBuildCommand\":\"\"}}"
if [ "${SKIP_SIGNING:-}" = "1" ]; then
  echo "Code signing disabled (SKIP_SIGNING=1)"
  TAURI_CONFIG="{\"version\":\"$VERSION\",\"build\":{\"beforeBuildCommand\":\"\"},\"bundle\":{\"macOS\":{\"signingIdentity\":null}}}"
else
  echo "Code signing enabled"
fi
echo "Building macOS desktop app..."
# Build only .app and updater (skip Tauri's DMG — we rebuild it after re-signing anyway)
pnpm --filter @my-claudia/desktop exec tauri build --bundles app,updater --config "$TAURI_CONFIG" || {
  echo "ERROR: Tauri build failed"
  exit 1
}
echo ""

# --- Re-sign native modules and node sidecar ---
# Tauri signs the node sidecar with hardened runtime, but self-signed certificates
# can't use disable-library-validation entitlements. Native .node modules
# (better-sqlite3, node-pty, ripgrep) are adhoc-signed and fail library validation
# under hardened runtime → SIGTRAP. Fix: sign .node files with same identity, and
# re-sign node WITHOUT hardened runtime so it can load third-party native modules.
if [ "${SKIP_SIGNING:-}" != "1" ]; then
  APP_BUNDLE="$BUNDLE_DIR/macos/MyClaudia.app"
  SIGNING_IDENTITY="${MACOS_SIGNING_IDENTITY:-MyClaudia Signing}"

  if [ -d "$APP_BUNDLE" ]; then
    echo "=== Re-signing native modules and node sidecar ==="

    # Sign all native .node modules with the app's signing identity
    find "$APP_BUNDLE/Contents/Resources/server" -name "*.node" -print0 | while IFS= read -r -d '' native; do
      echo "  Signing: $(basename "$native")"
      codesign --force --sign "$SIGNING_IDENTITY" "$native"
    done

    # Re-sign node binary WITHOUT hardened runtime (--options runtime omitted)
    # Self-signed certs can't use disable-library-validation entitlement,
    # so we must disable hardened runtime for the node sidecar entirely.
    echo "  Re-signing node without hardened runtime"
    codesign --force --sign "$SIGNING_IDENTITY" "$APP_BUNDLE/Contents/MacOS/node"

    # Re-sign the app bundle (inner signatures changed, outer must be refreshed)
    echo "  Re-signing app bundle"
    codesign --force --sign "$SIGNING_IDENTITY" --options runtime "$APP_BUNDLE"

    echo "  Verifying signature..."
    codesign --verify --deep --strict "$APP_BUNDLE" && echo "  Signature OK" || echo "  WARNING: Signature verification failed"

    # --- Rebuild DMG and updater artifacts ---
    # Tauri creates the DMG and .tar.gz BEFORE our re-signing, so they contain
    # the original (incorrect) signatures. We must rebuild them.

    # Rebuild .app.tar.gz (updater artifact)
    TAR_GZ_PATH="$BUNDLE_DIR/macos/MyClaudia.app.tar.gz"
    if [ -f "$TAR_GZ_PATH" ]; then
      echo "  Rebuilding updater tar.gz with corrected signatures"
      tar -czf "$TAR_GZ_PATH" -C "$BUNDLE_DIR/macos" "MyClaudia.app"
      # Re-sign the tar.gz if signing key is available
      if [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ] || [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
        echo "  Re-signing updater artifact"
        if sign_updater_artifact "$TAR_GZ_PATH"; then
          echo "  Updater signature refreshed"
        else
          echo "  WARNING: Could not re-sign updater artifact (non-fatal)"
        fi
      fi
    fi

    # Rebuild DMG with corrected app bundle
    echo "  Rebuilding DMG with corrected signatures"
    DMG_DIR="$BUNDLE_DIR/dmg"
    # Remove old DMG files
    find "$DMG_DIR" -name '*.dmg' -delete 2>/dev/null || true
    # Remove temp read-write DMG images from Tauri's bundle_dmg.sh
    find "$BUNDLE_DIR/macos" -name 'rw.*.dmg' -delete 2>/dev/null || true
    # Detach ALL mounted volumes named "MyClaudia"
    for disk in $(hdiutil info 2>/dev/null | grep -B20 '/Volumes/MyClaudia' | grep '/dev/disk' | awk '{print $1}' | grep -o '/dev/disk[0-9]*' | sort -u); do
      echo "  Detaching stale mount: $disk"
      hdiutil detach "$disk" -force 2>/dev/null || true
    done
    # Also detach any mounts referencing our bundle dir
    for disk in $(hdiutil info 2>/dev/null | grep -A20 "image-path.*$BUNDLE_DIR" | grep '/dev/disk' | awk '{print $1}' | grep -o '/dev/disk[0-9]*' | sort -u); do
      hdiutil detach "$disk" -force 2>/dev/null || true
    done
    # Create new DMG
    DMG_NAME="MyClaudia_${VERSION}_$(uname -m).dmg"
    DMG_PATH="$DMG_DIR/$DMG_NAME"
    mkdir -p "$DMG_DIR"
    hdiutil create -volname "MyClaudia" -srcfolder "$APP_BUNDLE" -ov -format UDZO "$DMG_PATH"
    # Sign the DMG
    codesign --force --sign "$SIGNING_IDENTITY" "$DMG_PATH"
    echo "  DMG rebuilt: $DMG_PATH"
    echo ""
  fi
fi

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

# --- Rename updater artifacts with architecture ---
# Tauri produces MyClaudia.app.tar.gz; rename to include arch so dual-arch
# builds (aarch64 + x86_64) don't collide on the same release.
TAR_GZ_ORIG="$BUNDLE_DIR/macos/MyClaudia.app.tar.gz"
TAR_SIG_ORIG="$BUNDLE_DIR/macos/MyClaudia.app.tar.gz.sig"
TAR_GZ_NAME="MyClaudia_${TAURI_ARCH}.app.tar.gz"
TAR_GZ="$BUNDLE_DIR/macos/$TAR_GZ_NAME"
TAR_SIG="$BUNDLE_DIR/macos/${TAR_GZ_NAME}.sig"

if [ -f "$TAR_GZ_ORIG" ]; then
  mv "$TAR_GZ_ORIG" "$TAR_GZ"
  echo "  Renamed updater artifact: $TAR_GZ_NAME"
fi
if [ -f "$TAR_SIG_ORIG" ]; then
  mv "$TAR_SIG_ORIG" "$TAR_SIG"
  echo "  Renamed updater signature: ${TAR_GZ_NAME}.sig"
fi

# --- Generate update manifest (latest.json) ---
if [ -f "$TAR_GZ" ] && [ -f "$TAR_SIG" ]; then
  echo "=== Generating update manifest ==="
  SIGNATURE=$(cat "$TAR_SIG")
  PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  RELEASE_TAG="${RELEASE_TAG:-v${MAJOR}.${MINOR}.${BUILD}}"
  DOWNLOAD_URL="https://github.com/${RELEASE_REPO}/releases/download/${RELEASE_TAG}/${TAR_GZ_NAME}"

  cat > "$BUNDLE_DIR/latest.json" << MANIFEST_EOF
{
  "version": "${VERSION}",
  "notes": "MyClaudia ${VERSION}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-${TAURI_ARCH}": {
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
  if command -v gh >/dev/null 2>&1 && [ "${RELEASE:-}" = "1" ]; then
    echo ""
    echo "=== Uploading to GitHub Release ==="
    RELEASE_TAG="${RELEASE_TAG:-v${MAJOR}.${MINOR}.${BUILD}}"
    TAG="$RELEASE_TAG"

    if [ "${RELEASE_CREATE_IF_MISSING:-1}" = "1" ]; then
      gh release create "$TAG" --repo "$RELEASE_REPO" --title "MyClaudia $VERSION" --notes "MyClaudia $VERSION" --draft 2>/dev/null || true
    fi

    # Upload artifacts (overwrite if exist). By default this script remains a
    # self-contained release entrypoint and uploads latest.json itself.
    # Dual-arch GitHub Actions builds set SKIP_LATEST_JSON_UPLOAD=1 and merge
    # the per-arch manifests in a follow-up job.
    UPLOAD_FILES=("$TAR_GZ")
    [ -f "$TAR_SIG" ] && UPLOAD_FILES+=("$TAR_SIG")
    if [ "${SKIP_LATEST_JSON_UPLOAD:-0}" != "1" ]; then
      UPLOAD_FILES+=("$BUNDLE_DIR/latest.json")
    fi
    [ -f "${VERSIONED_DMG:-}" ] && UPLOAD_FILES+=("$VERSIONED_DMG")

    gh release upload "$TAG" --repo "$RELEASE_REPO" "${UPLOAD_FILES[@]}" --clobber
    echo "  Uploaded to: https://github.com/${RELEASE_REPO}/releases/tag/$TAG"
    echo "  NOTE: Release is in DRAFT state. Publish it to make the update live."

    # Clean old draft releases, keep latest 5
    OLD_DRAFTS=$(gh release list --repo "$RELEASE_REPO" --json tagName,isDraft --jq '[.[] | select(.isDraft)] | sort_by(.tagName) | reverse | .[5:] | .[].tagName' 2>/dev/null || true)
    if [ -n "$OLD_DRAFTS" ]; then
      echo ""
      echo "=== Cleaning old draft releases ==="
      echo "$OLD_DRAFTS" | while read -r old_tag; do
        gh release delete "$old_tag" --repo "$RELEASE_REPO" --cleanup-tag --yes 2>/dev/null || true
        echo "  Deleted: $old_tag"
      done
    fi
  fi
else
  echo ""
  echo "  NOTE: No update artifacts generated."
  echo "  To enable auto-update signing, configure one of:"
  echo "    export TAURI_SIGNING_PRIVATE_KEY_PATH=\"$HOME/.tauri/my-claudia.key\""
  echo "    export TAURI_SIGNING_PRIVATE_KEY=\$(cat \"$HOME/.tauri/my-claudia.key\")"
fi

echo ""
echo "=== Build complete: MyClaudia $VERSION ==="
