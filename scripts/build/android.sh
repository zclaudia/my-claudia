#!/usr/bin/env bash
# Build, sign, and optionally install Android APK
# Usage:
#   ./scripts/build-android.sh              # build + sign release
#   ./scripts/build-android.sh --dev        # build + sign dev variant
#   ./scripts/build-android.sh --install    # build + sign + install
#   ./scripts/build-android.sh --install-only                  # install existing APK
#
# Environment:
#   KEYSTORE_PASS  - keystore password (default: "android")
#   KEYSTORE       - override keystore path (default: ~/.android/my-claudia-{release,dev}.keystore)
#   KEY_ALIAS      - override key alias (default: my-claudia-{release,dev})
#
# Requires: JDK 17, Android SDK, NDK, Rust Android targets
set -euo pipefail
cd "$(dirname "$0")/../.."

# Load .env if present (for RELEASE_REMOTE, etc.)
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# Release remote config (only needed when RELEASE=1)
RELEASE_REMOTE="${RELEASE_REMOTE:-origin}"
# Lazily resolve RELEASE_REPO only when needed for release
resolve_release_repo() {
  if ! git remote get-url "$RELEASE_REMOTE" &>/dev/null; then
    echo "ERROR: Release remote '$RELEASE_REMOTE' not found. Available remotes:" >&2
    git remote -v >&2
    return 1
  fi
  git remote get-url "$RELEASE_REMOTE" | sed 's/.*github\.com[:/]\(.*\)\.git/\1/'
}

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
  # JAVA_HOME: prefer env var > java_home utility > Homebrew openjdk@17
  if [ -z "${JAVA_HOME:-}" ]; then
    JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || true)
    [ -z "$JAVA_HOME" ] && [ -d "/opt/homebrew/opt/openjdk@17" ] && JAVA_HOME="/opt/homebrew/opt/openjdk@17"
    [ -z "$JAVA_HOME" ] && [ -d "/usr/local/opt/openjdk@17" ] && JAVA_HOME="/usr/local/opt/openjdk@17"
  fi
  export JAVA_HOME
  export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
  # Prefer rustup-managed toolchain over Homebrew Rust
  export PATH="$HOME/.cargo/bin:$PATH"
  # Ensure Node.js is available (fnm / nvm) and matches .node-version
  if command -v fnm >/dev/null 2>&1; then eval "$(fnm env --use-on-cd)"; fnm use --silent-if-unchanged 2>/dev/null || true; fi
  if command -v nvm >/dev/null 2>&1; then nvm use 2>/dev/null || true; fi
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

# --- Version selection ---
# In CI (RELEASE_VERSION + RELEASE_BUILD set by workflow), use those directly.
# Locally, always build a dev version from the latest release tag without
# advancing the next release number.
if [ "$INSTALL_ONLY" = false ] && [ "$NO_BUMP" = false ]; then
  echo "=== Version check ==="

  if [ -n "${RELEASE_VERSION:-}" ] && [ -n "${RELEASE_BUILD:-}" ]; then
    # CI mode: use workflow-provided version
    VERSION="$RELEASE_VERSION"
    BUILD="$RELEASE_BUILD"
    VERSION_CODE="${RELEASE_VERSION_CODE:-$(($(echo "$VERSION" | cut -d. -f1) * 1000000 + $(echo "$VERSION" | cut -d. -f2) * 10000 + BUILD))}"
    MAJOR=$(echo "$VERSION" | cut -d. -f1)
    MINOR=$(echo "$VERSION" | cut -d. -f2)
    echo "Using CI-provided version: $VERSION (build $BUILD)"
  else
    DEV=true
    echo "Local build → deriving dev version from latest release tag"
    eval "$(./scripts/version-bump.sh --platform android --dev-suffix)"
  fi

  # Export version for Gradle (build.gradle.kts reads env vars with priority over tauri.properties)
  export ANDROID_VERSION_CODE="$VERSION_CODE"
  export ANDROID_VERSION_NAME="$VERSION"
  echo "  [OK] ANDROID_VERSION_CODE=$VERSION_CODE, ANDROID_VERSION_NAME=$VERSION"
  echo ""
fi

# --- APK paths ---
APK_DIR="apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release"
UNSIGNED="$APK_DIR/app-universal-release-unsigned.apk"
if [ "$INSTALL_ONLY" = true ]; then
  # Find latest existing APK
  if [ "$DEV" = true ]; then
    OUTPUT=$(ls -t "$APK_DIR"/my-claudia-*-dev*.apk 2>/dev/null | head -1)
  else
    OUTPUT=$(ls -t "$APK_DIR"/my-claudia-*.apk 2>/dev/null | grep -v -- '-dev' | head -1)
  fi
  [ -z "$OUTPUT" ] && { echo "ERROR: No APK found in $APK_DIR"; exit 1; }
else
  APK_NAME="my-claudia-${VERSION}"
  OUTPUT="$APK_DIR/${APK_NAME}.apk"
fi

# Stable Android customizations live outside `src-tauri/gen`, which may be
# regenerated from scratch in CI or after `tauri android init`.
ANDROID_GEN_DIR="apps/desktop/src-tauri/gen/android"
ANDROID_APP_DIR="$ANDROID_GEN_DIR/app/src/main"
ANDROID_RES_DIR="$ANDROID_APP_DIR/res"
ANDROID_OVERRIDES_DIR="apps/desktop/src-tauri/android-overrides/app/src/main"
ANDROID_APP_ID="com.myClaudia.mobile"
ANDROID_APP_PACKAGE_PATH="com/myClaudia/mobile"
ANDROID_SOURCE_PACKAGE_PATH="com/myClaudia/desktop"

# --- Install / update dependencies ---
if [ "$INSTALL_ONLY" = false ]; then
  echo "=== Installing dependencies ==="
  pnpm install
  echo ""

  # --- Pre-build (shared + desktop frontend) ---
  echo "=== Building shared packages ==="
  export APP_VERSION="${VERSION:-0.0.0}"
  pnpm -r run build
  echo ""
fi

# --- Ensure generated Android project exists ---
# `src-tauri/gen/android` is generated by Tauri and may be absent in CI when
# generated files are ignored. Recreate it before patching/building.
if [ ! -d "$ANDROID_GEN_DIR" ]; then
  echo "=== Initializing Tauri Android project ==="
  (
    cd apps/desktop
    pnpm tauri android init --ci
  )
  echo ""
fi

# --- Re-apply Android overrides ---
echo "=== Syncing Android overrides ==="
mkdir -p "$ANDROID_APP_DIR/java/$ANDROID_APP_PACKAGE_PATH" "$ANDROID_APP_DIR/res/xml"
rm -rf "$ANDROID_APP_DIR/java/com/myClaudia/desktop"
cp "$ANDROID_OVERRIDES_DIR/java/$ANDROID_SOURCE_PACKAGE_PATH/MainActivity.kt" "$ANDROID_APP_DIR/java/$ANDROID_APP_PACKAGE_PATH/MainActivity.kt"
cp "$ANDROID_OVERRIDES_DIR/java/$ANDROID_SOURCE_PACKAGE_PATH/FileHelper.kt" "$ANDROID_APP_DIR/java/$ANDROID_APP_PACKAGE_PATH/FileHelper.kt"
cp "$ANDROID_OVERRIDES_DIR/java/$ANDROID_SOURCE_PACKAGE_PATH/NtfyReceiver.kt" "$ANDROID_APP_DIR/java/$ANDROID_APP_PACKAGE_PATH/NtfyReceiver.kt"
cp "$ANDROID_OVERRIDES_DIR/java/$ANDROID_SOURCE_PACKAGE_PATH/NotificationRenderer.kt" "$ANDROID_APP_DIR/java/$ANDROID_APP_PACKAGE_PATH/NotificationRenderer.kt"
cp "$ANDROID_OVERRIDES_DIR/java/$ANDROID_SOURCE_PACKAGE_PATH/NotificationRenderService.kt" "$ANDROID_APP_DIR/java/$ANDROID_APP_PACKAGE_PATH/NotificationRenderService.kt"
cp "$ANDROID_OVERRIDES_DIR/res/xml/file_paths.xml" "$ANDROID_APP_DIR/res/xml/file_paths.xml"
cp "$ANDROID_OVERRIDES_DIR/res/xml/network_security_config.xml" "$ANDROID_APP_DIR/res/xml/network_security_config.xml"
cp -R apps/desktop/src-tauri/icons/android/. "$ANDROID_RES_DIR/"

ANDROID_MANIFEST="$ANDROID_APP_DIR/AndroidManifest.xml"
if [ -f "$ANDROID_MANIFEST" ]; then
  missing_notification_permission=0
  missing_fgs_permission=0
  missing_fgs_data_sync_permission=0
  missing_install_permission=0

  grep -q 'android.permission.POST_NOTIFICATIONS' "$ANDROID_MANIFEST" || missing_notification_permission=1
  grep -q 'android.permission.FOREGROUND_SERVICE' "$ANDROID_MANIFEST" || missing_fgs_permission=1
  grep -q 'android.permission.FOREGROUND_SERVICE_DATA_SYNC' "$ANDROID_MANIFEST" || missing_fgs_data_sync_permission=1
  grep -q 'android.permission.REQUEST_INSTALL_PACKAGES' "$ANDROID_MANIFEST" || missing_install_permission=1

  if [ "$missing_notification_permission" -eq 1 ] || [ "$missing_fgs_permission" -eq 1 ] || [ "$missing_fgs_data_sync_permission" -eq 1 ] || [ "$missing_install_permission" -eq 1 ]; then
    echo "=== Patching AndroidManifest.xml for required permissions ==="
    TMP_MANIFEST="$(mktemp)"
    awk -v add_post="$missing_notification_permission" -v add_fgs="$missing_fgs_permission" -v add_fgs_data_sync="$missing_fgs_data_sync_permission" -v add_install="$missing_install_permission" '
      /<uses-permission android:name="android.permission.INTERNET"/ {
        print
        if (add_post == 1) {
          print "    <uses-permission android:name=\"android.permission.POST_NOTIFICATIONS\" />"
        }
        if (add_fgs == 1) {
          print "    <uses-permission android:name=\"android.permission.FOREGROUND_SERVICE\" />"
        }
        if (add_fgs_data_sync == 1) {
          print "    <uses-permission android:name=\"android.permission.FOREGROUND_SERVICE_DATA_SYNC\" />"
        }
        if (add_install == 1) {
          print "    <uses-permission android:name=\"android.permission.REQUEST_INSTALL_PACKAGES\" />"
        }
        next
      }
      { print }
    ' "$ANDROID_MANIFEST" > "$TMP_MANIFEST"
    mv "$TMP_MANIFEST" "$ANDROID_MANIFEST"
    echo "  Added missing Android permissions"
    echo ""
  fi
fi

if [ -f "$ANDROID_MANIFEST" ] && ! grep -q 'android:networkSecurityConfig="@xml/network_security_config"' "$ANDROID_MANIFEST"; then
  echo "=== Patching AndroidManifest.xml for network security config ==="
  TMP_MANIFEST="$(mktemp)"
  awk '
    /android:theme="@style\/Theme.my_claudia"/ {
      print
      print "        android:networkSecurityConfig=\"@xml/network_security_config\""
      next
    }
    { print }
  ' "$ANDROID_MANIFEST" > "$TMP_MANIFEST"
  mv "$TMP_MANIFEST" "$ANDROID_MANIFEST"
  echo "  Added networkSecurityConfig"
  echo ""
fi

if [ -f "$ANDROID_MANIFEST" ] && ! grep -q 'manifestPlaceholders\["appIcon"\]' "$ANDROID_MANIFEST" && grep -q 'android:icon="@mipmap/ic_launcher"' "$ANDROID_MANIFEST"; then
  echo "=== Patching AndroidManifest.xml for launcher icon placeholders ==="
  TMP_MANIFEST="$(mktemp)"
  awk '
    /android:icon="@mipmap\/ic_launcher"/ {
      print "        android:icon=\"${appIcon}\""
      print "        android:roundIcon=\"${appRoundIcon}\""
      next
    }
    { print }
  ' "$ANDROID_MANIFEST" > "$TMP_MANIFEST"
  mv "$TMP_MANIFEST" "$ANDROID_MANIFEST"
  echo "  Added appIcon/appRoundIcon placeholders"
  echo ""
fi

if [ -f "$ANDROID_MANIFEST" ] && ! grep -q 'android:name=".NtfyReceiver"' "$ANDROID_MANIFEST"; then
  echo "=== Patching AndroidManifest.xml for ntfy receiver ==="
  TMP_MANIFEST="$(mktemp)"
  awk '
    /<\/application>/ {
      print "        <receiver"
      print "            android:name=\".NtfyReceiver\""
      print "            android:enabled=\"true\""
      print "            android:exported=\"true\" />"
      print ""
    }
    { print }
  ' "$ANDROID_MANIFEST" > "$TMP_MANIFEST"
  mv "$TMP_MANIFEST" "$ANDROID_MANIFEST"
  echo "  Added NtfyReceiver registration"
  echo ""
fi

if [ -f "$ANDROID_MANIFEST" ] && ! grep -q 'android:name=".NotificationRenderService"' "$ANDROID_MANIFEST"; then
  echo "=== Patching AndroidManifest.xml for notification render service ==="
  TMP_MANIFEST="$(mktemp)"
  awk '
    /<\/application>/ {
      print "        <service"
      print "            android:name=\".NotificationRenderService\""
      print "            android:enabled=\"true\""
      print "            android:exported=\"true\""
      print "            android:foregroundServiceType=\"dataSync\" />"
      print ""
    }
    { print }
  ' "$ANDROID_MANIFEST" > "$TMP_MANIFEST"
  mv "$TMP_MANIFEST" "$ANDROID_MANIFEST"
  echo "  Added NotificationRenderService registration"
  echo ""
fi

if [ -f "$ANDROID_MANIFEST" ] && grep -q 'android:name=".NotificationRenderService"' "$ANDROID_MANIFEST" && ! grep -q 'android:name=".NotificationRenderService"[^>]*android:foregroundServiceType="dataSync"' "$ANDROID_MANIFEST"; then
  echo "=== Patching AndroidManifest.xml for foreground service type ==="
  TMP_MANIFEST="$(mktemp)"
  awk '
    /<service/ { in_service = 1 }
    in_service == 1 && /android:name=".NotificationRenderService"/ { target_service = 1 }
    target_service == 1 && /android:foregroundServiceType=/ { has_fgs_type = 1 }
    target_service == 1 && /\/>/ && has_fgs_type == 0 {
      sub(/\/>/, "            android:foregroundServiceType=\"dataSync\" />")
      print
      in_service = 0
      target_service = 0
      has_fgs_type = 0
      next
    }
    target_service == 1 && /<\/service>/ && has_fgs_type == 0 {
      print "            android:foregroundServiceType=\"dataSync\""
      print
      in_service = 0
      target_service = 0
      has_fgs_type = 0
      next
    }
    {
      print
      if (target_service == 1 && /\/>/) {
        in_service = 0
        target_service = 0
        has_fgs_type = 0
      }
    }
  ' "$ANDROID_MANIFEST" > "$TMP_MANIFEST"
  mv "$TMP_MANIFEST" "$ANDROID_MANIFEST"
  echo "  Added foregroundServiceType to NotificationRenderService"
  echo ""
fi

mkdir -p "$ANDROID_RES_DIR/mipmap-anydpi-v26"
cat > "$ANDROID_RES_DIR/mipmap-anydpi-v26/ic_launcher_dev.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_dev_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>
EOF
cat > "$ANDROID_RES_DIR/mipmap-anydpi-v26/ic_launcher_dev_round.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_dev_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>
EOF
node scripts/generate-dev-icons.js
echo ""

# --- Patch Android build.gradle.kts (fix duplicate libc++_shared.so) ---
GRADLE_FILE="$ANDROID_GEN_DIR/app/build.gradle.kts"
if [ -f "$GRADLE_FILE" ] && ! grep -q "pickFirsts" "$GRADLE_FILE"; then
  echo "=== Patching Android build.gradle.kts ==="
  # Add packaging option to handle duplicate libc++_shared.so.
  # Use a temp file so this works on both GNU sed (Linux CI) and BSD sed (macOS).
  TMP_GRADLE_FILE="$(mktemp)"
  awk '
    /namespace = "/ {
      print
      print "    packaging {"
      print "        jniLibs.pickFirsts.add(\"lib/**/libc++_shared.so\")"
      print "    }"
      next
    }
    { print }
  ' "$GRADLE_FILE" > "$TMP_GRADLE_FILE"
  mv "$TMP_GRADLE_FILE" "$GRADLE_FILE"
  echo "  Added pickFirsts for libc++_shared.so"
  echo ""
fi

# --- Patch Android build.gradle.kts (launcher icon placeholders) ---
if [ -f "$GRADLE_FILE" ] && ! grep -q 'manifestPlaceholders\["appIcon"\]' "$GRADLE_FILE"; then
  echo "=== Patching Android build.gradle.kts for launcher icon placeholders ==="
  TMP_GRADLE_FILE="$(mktemp)"
  awk '
    /manifestPlaceholders\["usesCleartextTraffic"\] = "false"/ {
      print
      print "        manifestPlaceholders[\"appIcon\"] = \"@mipmap/ic_launcher\""
      print "        manifestPlaceholders[\"appRoundIcon\"] = \"@mipmap/ic_launcher_round\""
      next
    }
    /resValue\("string", "app_name", "MyClaudia Dev"\)/ {
      print
      print "                manifestPlaceholders[\"appIcon\"] = \"@mipmap/ic_launcher_dev\""
      print "                manifestPlaceholders[\"appRoundIcon\"] = \"@mipmap/ic_launcher_dev_round\""
      next
    }
    { print }
  ' "$GRADLE_FILE" > "$TMP_GRADLE_FILE"
  mv "$TMP_GRADLE_FILE" "$GRADLE_FILE"
  echo "  Added dev/release launcher icon placeholders"
  echo ""
fi

# --- Patch Android build.gradle.kts (force mobile app id for Android only) ---
if [ -f "$GRADLE_FILE" ] && ! grep -q "com.myClaudia.mobile" "$GRADLE_FILE"; then
  echo "=== Patching Android build.gradle.kts for mobile app id ==="
  TMP_GRADLE_FILE="$(mktemp)"
  awk -v android_app_id="$ANDROID_APP_ID" '
    /namespace = "/ {
      print "    namespace = \"" android_app_id "\""
      next
    }
    /applicationId = "/ {
      print "        applicationId = \"" android_app_id "\""
      next
    }
    { print }
  ' "$GRADLE_FILE" > "$TMP_GRADLE_FILE"
  mv "$TMP_GRADLE_FILE" "$GRADLE_FILE"
  echo "  Set namespace/applicationId to $ANDROID_APP_ID"
  echo ""
fi

# --- Patch Android build.gradle.kts (dev/prod package separation) ---
if [ -f "$GRADLE_FILE" ] && ! grep -q "isDevBuild" "$GRADLE_FILE"; then
  echo "=== Patching Android build.gradle.kts for dev package separation ==="
  TMP_GRADLE_FILE="$(mktemp)"
  awk '
    /^android \{/ {
      print ""
      print "val isDevBuild = providers.gradleProperty(\"isDev\").orNull == \"true\""
      print ""
      print
      next
    }
    /getByName\("release"\) \{/ {
      print
      print "            if (isDevBuild) {"
      print "                applicationIdSuffix = \".dev\""
      print "                versionNameSuffix = \"-dev\""
      print "                resValue(\"string\", \"app_name\", \"MyClaudia Dev\")"
      print "            }"
      next
    }
    { print }
  ' "$GRADLE_FILE" > "$TMP_GRADLE_FILE"
  mv "$TMP_GRADLE_FILE" "$GRADLE_FILE"
  echo "  Added applicationIdSuffix .dev for dev builds"
  echo ""
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
  # Also inject version so no files need to be modified.
  pnpm tauri android build --apk --config "{\"identifier\":\"$ANDROID_APP_ID\",\"version\":\"${VERSION:-0.0.0}\",\"build\":{\"beforeBuildCommand\":\"\"},\"bundle\":{\"externalBin\":[],\"resources\":null}}" || {
    echo "ERROR: Tauri Android build failed"
    exit 1
  }
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

  KEYSTORE_PASS="${KEYSTORE_PASS:-android}"
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

# --- Generate android-latest.json + upload to GitHub Release ---
if [ "$INSTALL_ONLY" = false ] && [ "${RELEASE:-}" = "1" ] && [ -f "$OUTPUT" ]; then
  # Resolve release repo only when actually releasing
  RELEASE_REPO=$(resolve_release_repo) || exit 1
  RELEASE_TAG="${RELEASE_TAG:-v${MAJOR}.${MINOR}.${BUILD}}"
  APK_FILENAME="$(basename "$OUTPUT")"
  DOWNLOAD_URL="https://github.com/${RELEASE_REPO}/releases/download/${RELEASE_TAG}/${APK_FILENAME}"

  echo "=== Generating android-latest.json ==="
  ANDROID_LATEST="$(dirname "$OUTPUT")/android-latest.json"
  cat > "$ANDROID_LATEST" << MANIFEST_EOF
{
  "version": "${VERSION}",
  "url": "${DOWNLOAD_URL}",
  "notes": "MyClaudia ${VERSION}"
}
MANIFEST_EOF
  echo "  Generated: $ANDROID_LATEST"

  if command -v gh >/dev/null 2>&1; then
    echo ""
    echo "=== Uploading to GitHub Release ==="
    TAG="$RELEASE_TAG"

    if [ "${RELEASE_CREATE_IF_MISSING:-1}" = "1" ]; then
      gh release create "$TAG" --repo "$RELEASE_REPO" --title "MyClaudia ${MAJOR}.${MINOR}.${BUILD}" --notes "MyClaudia ${MAJOR}.${MINOR}.${BUILD}" --draft 2>/dev/null || true
    fi

    # Upload APK + manifest
    gh release upload "$TAG" --repo "$RELEASE_REPO" "$OUTPUT" "$ANDROID_LATEST" --clobber
    echo "  Uploaded to: https://github.com/${RELEASE_REPO}/releases/tag/$TAG"
    echo "  NOTE: Release is in DRAFT state. Publish it to make the update live."
  fi
fi
