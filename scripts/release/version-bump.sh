#!/usr/bin/env bash
# Compute release version from git tags. Pure computation — no files are modified.
#
# Usage:
#   source <(./scripts/release/version-bump.sh --platform macos)
#   echo "$VERSION"   # e.g. 0.1.220
#
#   source <(./scripts/release/version-bump.sh --platform macos --bump)
#   echo "$VERSION"   # e.g. 0.1.221
#
# Outputs shell variable assignments to stdout:
#   VERSION=x.y.z       (or x.y.z-dev.<platform>.<timestamp>)
#   VERSION_CODE=NNN    (integer, for Android versionCode)
#   BUILD=N             (raw build number)
#
# version.json holds only { "major": N, "minor": N }
# Build number is derived from git tags: build-{major}.{minor}-{N}
#
# Release builds share the same app version. Dirty local dev builds append
# platform + timestamp so parallel local artifacts are distinguishable.
#
# Android still requires a monotonically increasing integer versionCode, so we
# derive one separately from major/minor/build.
set -euo pipefail
cd "$(dirname "$0")/../.."

# --- Parse args ---
PLATFORM=""
BUMP=false
SET_BUILD=""
DEV_SUFFIX=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --bump) BUMP=true; shift ;;
    --set-build) SET_BUILD="$2"; shift 2 ;;
    --dev-suffix) DEV_SUFFIX=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$PLATFORM" ]; then
  echo "ERROR: --platform is required (android|macos|linux|windows)" >&2
  exit 1
fi

# --- Validate platform ---
case "$PLATFORM" in
  android|macos|linux|windows) ;;
  *) echo "ERROR: Unknown platform '$PLATFORM'. Use: android|macos|linux|windows" >&2; exit 1 ;;
esac

# --- Read version.json (only major + minor) ---
VERSION_FILE="version.json"
if [ ! -f "$VERSION_FILE" ]; then
  echo "ERROR: $VERSION_FILE not found" >&2
  exit 1
fi

MAJOR=$(python3 -c "import json; print(json.load(open('$VERSION_FILE'))['major'])")
MINOR=$(python3 -c "import json; print(json.load(open('$VERSION_FILE'))['minor'])")

# --- Get build number from git tags ---
LATEST_TAG=$(git tag -l "build-${MAJOR}.${MINOR}-*" --sort=-version:refname | head -1)
if [ -n "$LATEST_TAG" ]; then
  BUILD=$(echo "$LATEST_TAG" | sed "s/build-${MAJOR}.${MINOR}-//")
else
  BUILD=0
fi

# --- Bump or set build ---
if [ "$BUMP" = true ]; then
  BUILD=$((BUILD + 1))
  echo "Build number bumped to $BUILD" >&2
elif [ -n "$SET_BUILD" ]; then
  BUILD="$SET_BUILD"
fi

# --- Compute version strings ---
VERSION="${MAJOR}.${MINOR}.${BUILD}"
if [ "$DEV_SUFFIX" = true ]; then
  DEV_TIMESTAMP="${DEV_TIMESTAMP:-$(date -u +%Y%m%d%H%M%S)}"
  VERSION="${VERSION}-dev.${PLATFORM}.${DEV_TIMESTAMP}"
fi

# Android requires an integer versionCode that monotonically increases across
# all releases. Reserve 2 digits for minor and 4 digits for build.
VERSION_CODE=$((MAJOR * 1000000 + MINOR * 10000 + BUILD))

# --- Info to stderr (doesn't affect source) ---
echo "  Platform: $PLATFORM  Build: $BUILD  Version: $VERSION  VersionCode: $VERSION_CODE" >&2

# --- Output variable assignments to stdout ---
echo "VERSION=$VERSION"
echo "VERSION_CODE=$VERSION_CODE"
echo "BUILD=$BUILD"
