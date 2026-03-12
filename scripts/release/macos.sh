#!/usr/bin/env bash
# Build and publish macOS release to GitHub (draft)
# Wraps build-macos.sh with RELEASE=1
set -euo pipefail
export RELEASE=1
exec "$(dirname "$0")/../build/macos.sh" "$@"
