#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
VITEST_BIN="../node_modules/.bin/vitest"

run_check() {
  local label="$1"
  shift
  echo
  echo "==> $label"
  (
    cd "$SERVER_DIR"
    "$VITEST_BIN" run "$@"
  )
}

echo "Verifying AI review hardening regressions from: $ROOT_DIR"

run_check \
  "AI review parser and repair flow" \
  src/domains/conversation/agent/__tests__/delegation-evaluator.test.ts

run_check \
  "Local payload guard rules" \
  src/domains/conversation/agent/__tests__/review-payload-guard.test.ts \
  src/domains/conversation/agent/__tests__/ai-review-queue.test.ts

run_check \
  "OpenCode non-JSON HTTP response observability" \
  src/providers/__tests__/opencode-sdk.test.ts \
  -t "warns when session creation returns non-JSON text"

run_check \
  "Kimi non-JSON stdout observability" \
  src/providers/__tests__/kimi-sdk.test.ts \
  -t "handles non-JSON lines as assistant text"

echo
echo "AI review hardening verification passed."
