#!/usr/bin/env bash
# Build Android APK (aarch64)
# Requires: JDK 17, Android SDK, NDK, Rust Android targets
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Environment ---
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.0.12077973}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# --- Preflight checks ---
for cmd in java rustup; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done
[ -d "$ANDROID_HOME" ] || { echo "ERROR: ANDROID_HOME not found at $ANDROID_HOME"; exit 1; }
[ -d "$NDK_HOME" ]     || { echo "ERROR: NDK not found at $NDK_HOME"; exit 1; }
rustup target list --installed | grep -q aarch64-linux-android || {
  echo "Adding Rust Android targets..."
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
}

# --- Build ---
echo "Building Android APK..."
pnpm --filter @my-claudia/desktop exec tauri android build --apk --target aarch64

# --- Sign ---
APK_DIR="apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release"
UNSIGNED="$APK_DIR/app-universal-release-unsigned.apk"
KEYSTORE="${KEYSTORE:-$HOME/.android/debug.keystore}"

if [ ! -f "$KEYSTORE" ]; then
  echo "Creating debug keystore..."
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkey -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey \
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Debug,OU=Debug,O=Debug,L=Debug,ST=Debug,C=US"
fi

ALIGNED="$APK_DIR/app-aligned.apk"
OUTPUT="$APK_DIR/my-claudia.apk"

"$ANDROID_HOME/build-tools/35.0.0/zipalign" -f -p 4 "$UNSIGNED" "$ALIGNED"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" sign \
  --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --out "$OUTPUT" "$ALIGNED"
rm -f "$ALIGNED"

echo ""
echo "=== Android APK built ==="
echo "  $OUTPUT"
ls -lh "$OUTPUT"
