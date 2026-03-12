#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/diagnostics/test-gateway-e2e.sh" "$@"
