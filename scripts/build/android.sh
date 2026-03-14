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
  # Ensure Node.js is available (fnm / nvm)
  if command -v fnm >/dev/null 2>&1; then eval "$(fnm env)"; fi
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

# --- Smart version bump ---
# In CI (RELEASE_VERSION + RELEASE_BUILD set by workflow), use those directly.
# Locally, use git tags to track builds:
#   - HEAD has build-* tag + clean tree → reuse version
#   - HEAD has no build-* tag → new commits exist → bump + tag
#   - Dirty working tree → dev build (no bump, -dev.<platform>.<timestamp> suffix)
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
    # Local mode: compute from git tags
    MAJOR=$(python3 -c "import json; print(json.load(open('version.json'))['major'])")
    MINOR=$(python3 -c "import json; print(json.load(open('version.json'))['minor'])")
    HAS_DIRTY=$(git status --porcelain | head -1)
    HAS_BUILD_TAG=$(git tag --points-at HEAD 2>/dev/null | grep '^build-' | head -1 || true)

    if [ -n "$HAS_DIRTY" ]; then
      DEV=true
      echo "Dirty working tree → dev build"
      LATEST_TAG=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | head -1)
      CURRENT_BUILD=$(echo "$LATEST_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
      [ -z "$CURRENT_BUILD" ] && CURRENT_BUILD=0
      eval "$(./scripts/version-bump.sh --platform android --set-build "$CURRENT_BUILD" --dev-suffix)"

    elif [ -z "$HAS_BUILD_TAG" ]; then
      echo "New commits detected → bumping version"
      eval "$(./scripts/version-bump.sh --platform android --bump)"

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
      eval "$(./scripts/version-bump.sh --platform android --set-build "$CURRENT_BUILD")"
    fi
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
if [ ! -d "apps/desktop/src-tauri/gen/android" ]; then
  echo "=== Initializing Tauri Android project ==="
  (
    cd apps/desktop
    pnpm tauri android init --ci
  )
  echo ""
fi

# --- Patch Android build.gradle.kts (fix duplicate libc++_shared.so) ---
GRADLE_FILE="apps/desktop/src-tauri/gen/android/app/build.gradle.kts"
if [ -f "$GRADLE_FILE" ] && ! grep -q "pickFirsts" "$GRADLE_FILE"; then
  echo "=== Patching Android build.gradle.kts ==="
  # Add packaging option to handle duplicate libc++_shared.so.
  # Use a temp file so this works on both GNU sed (Linux CI) and BSD sed (macOS).
  TMP_GRADLE_FILE="$(mktemp)"
  awk '
    /namespace = "com.myClaudia.desktop"/ {
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
  pnpm tauri android build --apk --config "{\"version\":\"${VERSION:-0.0.0}\",\"build\":{\"beforeBuildCommand\":\"\"},\"bundle\":{\"externalBin\":[],\"resources\":null}}" || {
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
  RELEASE_TAG="v${MAJOR}.${MINOR}.${BUILD}"
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

    # Create draft release (idempotent — may already exist from macOS build)
    gh release create "$TAG" --repo "$RELEASE_REPO" --title "MyClaudia ${MAJOR}.${MINOR}.${BUILD}" --notes "MyClaudia ${MAJOR}.${MINOR}.${BUILD}" --draft 2>/dev/null || true

    # Upload APK + manifest
    gh release upload "$TAG" --repo "$RELEASE_REPO" "$OUTPUT" "$ANDROID_LATEST" --clobber
    echo "  Uploaded to: https://github.com/${RELEASE_REPO}/releases/tag/$TAG"
    echo "  NOTE: Release is in DRAFT state. Publish it to make the update live."
  fi
fi
