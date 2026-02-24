#!/usr/bin/env bash
# Build, sign, and optionally install Android APK
# Usage:
#   KEYSTORE_PASS=<pw> ./scripts/build-android.sh              # build + sign release
#   KEYSTORE_PASS=<pw> ./scripts/build-android.sh --dev        # build + sign dev variant
#   KEYSTORE_PASS=<pw> ./scripts/build-android.sh --install    # build + sign + install
#   ./scripts/build-android.sh --install-only                  # install existing APK
#
# Environment:
#   KEYSTORE_PASS  - keystore password (required for signing)
#   KEYSTORE       - override keystore path (default: ~/.android/my-claudia-{release,dev}.keystore)
#   KEY_ALIAS      - override key alias (default: my-claudia-{release,dev})
#
# Requires: JDK 17, Android SDK, NDK, Rust Android targets
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Parse args ---
INSTALL=false
INSTALL_ONLY=false
NO_BUMP=false
DEV=false
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=true ;;
    --install-only) INSTALL_ONLY=true; INSTALL=true ;;
    --no-bump) NO_BUMP=true ;;
    --dev) DEV=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# --- Environment (macOS / Linux) ---
if [[ "$(uname)" == "Darwin" ]]; then
  export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17 2>/dev/null || echo "")}"
  export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
  # Prefer rustup-managed toolchain over Homebrew Rust
  export PATH="$HOME/.cargo/bin:$PATH"
else
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
fi

export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" 2>/dev/null | sort -V | tail -1)}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# --- Locate build-tools ---
BUILD_TOOLS_VERSION=$(ls "$ANDROID_HOME/build-tools" 2>/dev/null | sort -V | tail -1)
BUILD_TOOLS="$ANDROID_HOME/build-tools/$BUILD_TOOLS_VERSION"

# --- Preflight checks ---
echo "=== Preflight checks ==="
for cmd in java rustup pnpm adb; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  [OK] $cmd"
  else
    echo "  [FAIL] $cmd not found"
    exit 1
  fi
done
[ -d "$ANDROID_HOME" ] || { echo "ERROR: ANDROID_HOME not found at $ANDROID_HOME"; exit 1; }
echo "  [OK] ANDROID_HOME=$ANDROID_HOME"
[ -d "$NDK_HOME" ] || { echo "ERROR: NDK not found at $NDK_HOME"; exit 1; }
echo "  [OK] NDK_HOME=$NDK_HOME"
[ -d "$BUILD_TOOLS" ] || { echo "ERROR: build-tools not found"; exit 1; }
echo "  [OK] build-tools=$BUILD_TOOLS_VERSION"

# Ensure Rust Android targets
TARGETS=(aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android)
INSTALLED=$(rustup target list --installed)
for target in "${TARGETS[@]}"; do
  if ! echo "$INSTALLED" | grep -q "$target"; then
    echo "  Adding Rust target: $target"
    rustup target add "$target"
  fi
done
echo "  [OK] Rust Android targets"
echo ""

# --- Smart version bump ---
# Only bump when there are actual changes since the last version bump
if [ "$INSTALL_ONLY" = false ] && [ "$NO_BUMP" = false ]; then
  echo "=== Version check ==="
  VERSION_COMMIT=$(python3 -c "import json; d=json.load(open('version.json')); print(d.get('commit', ''))")
  HEAD_COMMIT=$(git rev-parse --short HEAD)
  HAS_DIRTY=$(git status --porcelain | head -1)

  if [ -n "$HAS_DIRTY" ] || [ "$VERSION_COMMIT" != "$HEAD_COMMIT" ]; then
    echo "Changes detected (dirty=$([[ -n "$HAS_DIRTY" ]] && echo yes || echo no), version_commit=$VERSION_COMMIT, head=$HEAD_COMMIT)"
    echo "Bumping version..."
    ./scripts/version-bump.sh --platform android --bump

    # Auto-commit version bump
    git add version.json package.json apps/desktop/package.json \
      apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
      apps/desktop/src-tauri/tauri.conf.json
    git commit -m "chore: version bump for Android build" --no-verify 2>/dev/null || true
  else
    echo "No changes since last bump (commit=$VERSION_COMMIT). Reusing current version."
    ./scripts/version-bump.sh --platform android
  fi
  echo ""
fi

# --- APK paths ---
APK_DIR="apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release"
UNSIGNED="$APK_DIR/app-universal-release-unsigned.apk"
if [ "$DEV" = true ]; then
  OUTPUT="$APK_DIR/my-claudia-dev.apk"
else
  OUTPUT="$APK_DIR/my-claudia.apk"
fi

# --- Build ---
if [ "$INSTALL_ONLY" = false ]; then
  if [ "$DEV" = true ]; then
    echo "=== Building Android APK (dev) ==="
  else
    echo "=== Building Android APK ==="
  fi
  cd apps/desktop
  # Android doesn't use embedded server — override tauri config to skip
  # sidecar binaries, server bundle resources, and server bundle step.
  export TAURI_CONFIG='{"build":{"beforeBuildCommand":"pnpm build"},"bundle":{"externalBin":[],"resources":null}}'
  pnpm tauri android build --apk
  if [ "$DEV" = true ]; then
    # Tauri CLI's -- passes args to cargo, not Gradle.
    # Re-run Gradle with -PisDev=true, skipping Rust build (already done).
    echo "  Re-packaging as dev variant..."
    cd src-tauri/gen/android
    ./gradlew assembleUniversalRelease -PisDev=true \
      -x rustBuildArm64Release -x rustBuildArmRelease \
      -x rustBuildX86Release -x rustBuildX86_64Release
    cd ../../../../..
  else
    cd ../..
  fi
  echo ""

  # --- Sign ---
  echo "=== Signing APK ==="
  if [ "$DEV" = true ]; then
    KEYSTORE="${KEYSTORE:-$HOME/.android/my-claudia-dev.keystore}"
    KEY_ALIAS="${KEY_ALIAS:-my-claudia-dev}"
  else
    KEYSTORE="${KEYSTORE:-$HOME/.android/my-claudia-release.keystore}"
    KEY_ALIAS="${KEY_ALIAS:-my-claudia-release}"
  fi

  if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: Keystore not found at $KEYSTORE"
    echo "       Generate one with: keytool -genkeypair -v -keystore $KEYSTORE -alias $KEY_ALIAS -keyalg RSA -keysize 2048 -validity 10000"
    exit 1
  fi

  if [ -z "${KEYSTORE_PASS:-}" ]; then
    echo "ERROR: KEYSTORE_PASS environment variable is required"
    echo "       Usage: KEYSTORE_PASS=<password> ./scripts/build-android.sh [--dev]"
    exit 1
  fi

  ALIGNED="$APK_DIR/app-aligned.apk"
  "$BUILD_TOOLS/zipalign" -f -p 4 "$UNSIGNED" "$ALIGNED"
  "$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_PASS" --key-pass "pass:$KEYSTORE_PASS" \
    --ks-key-alias "$KEY_ALIAS" --out "$OUTPUT" "$ALIGNED"
  rm -f "$ALIGNED"

  echo ""
  echo "=== APK ready ==="
  echo "  $OUTPUT"
  ls -lh "$OUTPUT"
  echo ""
fi

# --- Install ---
if [ "$INSTALL" = true ]; then
  if [ ! -f "$OUTPUT" ]; then
    echo "ERROR: APK not found at $OUTPUT"
    echo "       Run without --install-only first to build."
    exit 1
  fi
  echo "=== Installing to device ==="
  DEVICES=$(adb devices | grep -w 'device' | grep -v 'List')
  if [ -z "$DEVICES" ]; then
    echo "ERROR: No Android device connected."
    echo "       Connect a device via USB or start an emulator."
    exit 1
  fi
  echo "  Device: $(echo "$DEVICES" | head -1 | cut -f1)"
  adb install -r "$OUTPUT"
  echo ""
  echo "=== Installed successfully ==="
fi
