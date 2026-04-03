#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPECTED_NODE="$(tr -d '[:space:]' < "$PROJECT_ROOT/.node-version")"
CURRENT_NODE="$(node -p "process.version.slice(1)")"

if [[ "$CURRENT_NODE" == "$EXPECTED_NODE" ]]; then
  exec "$@"
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd)" >/dev/null 2>&1 || true
  exec fnm exec --using "$EXPECTED_NODE" "$@"
fi

echo "Node version mismatch: expected $EXPECTED_NODE, current $CURRENT_NODE." >&2
echo "Install fnm and run: eval \"\$(fnm env)\" && fnm use $EXPECTED_NODE" >&2
exit 1
