#!/usr/bin/env bash
# Build, sign, and optionally install Android APK
# Usage:
#   ./scripts/build-android.sh              # build + sign only
#   ./scripts/build-android.sh --install    # build + sign + install to device
#   ./scripts/build-android.sh --install-only  # skip build, install existing APK
#
# Requires: JDK 17, Android SDK, NDK, Rust Android targets
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Parse args ---
INSTALL=false
INSTALL_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=true ;;
    --install-only) INSTALL_ONLY=true; INSTALL=true ;;
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

# --- APK paths ---
APK_DIR="apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release"
UNSIGNED="$APK_DIR/app-universal-release-unsigned.apk"
OUTPUT="$APK_DIR/my-claudia.apk"

# --- Build ---
if [ "$INSTALL_ONLY" = false ]; then
  echo "=== Building Android APK ==="
  cd apps/desktop
  pnpm tauri android build --apk
  cd ../..
  echo ""

  # --- Sign ---
  echo "=== Signing APK ==="
  KEYSTORE="${KEYSTORE:-$HOME/.android/debug.keystore}"

  if [ ! -f "$KEYSTORE" ]; then
    echo "  Creating debug keystore..."
    mkdir -p "$(dirname "$KEYSTORE")"
    keytool -genkey -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey \
      -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=Debug,OU=Debug,O=Debug,L=Debug,ST=Debug,C=US"
  fi

  ALIGNED="$APK_DIR/app-aligned.apk"
  "$BUILD_TOOLS/zipalign" -f -p 4 "$UNSIGNED" "$ALIGNED"
  "$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias androiddebugkey --out "$OUTPUT" "$ALIGNED"
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
