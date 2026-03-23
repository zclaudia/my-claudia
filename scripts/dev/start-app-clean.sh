#!/usr/bin/env bash
#
# MyClaudia App — start desktop dev app with a sanitized environment
#
# This avoids inheriting model/provider variables from the current shell,
# which can interfere with Tauri, Vite, or the embedded server.
#
# Usage:
#   ./scripts/dev/start-app-clean.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
TAURI_CONFIG_OVERRIDE="$DESKTOP_DIR/src-tauri/tauri.clean.conf.json"
VITE_PORT="1420"
VITE_URL="http://127.0.0.1:${VITE_PORT}"
VITE_PID=""

info() { echo -e "\033[0;34m>\033[0m $*"; }
ok()   { echo -e "\033[0;32m+\033[0m $*"; }
die()  { echo -e "\033[0;31mx\033[0m $*" >&2; exit 1; }

cleanup() {
  if [[ -n "$VITE_PID" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

run_clean_env() {
  local -a env_args=(
    "HOME=${HOME:-}"
    "PATH=${PATH:-}"
    "SHELL=${SHELL:-/bin/sh}"
    "USER=${USER:-}"
    "TMPDIR=${TMPDIR:-/tmp}"
    "LANG=${LANG:-en_US.UTF-8}"
    "TERM=${TERM:-xterm-256color}"
    "NODE_ENV=development"
  )

  if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
    env_args+=("SSH_AUTH_SOCK=${SSH_AUTH_SOCK}")
  fi
  if [[ -n "${DISPLAY:-}" ]]; then
    env_args+=("DISPLAY=${DISPLAY}")
  fi
  if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    env_args+=("WAYLAND_DISPLAY=${WAYLAND_DISPLAY}")
  fi
  if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    env_args+=("XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR}")
  fi
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    env_args+=("XDG_CONFIG_HOME=${XDG_CONFIG_HOME}")
  fi
  if [[ -n "${XDG_CACHE_HOME:-}" ]]; then
    env_args+=("XDG_CACHE_HOME=${XDG_CACHE_HOME}")
  fi

  env -i "${env_args[@]}" "$@"
}

wait_for_vite() {
  for _ in $(seq 1 120); do
    if is_vite_ready; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

is_vite_ready() {
  curl --silent --fail "$VITE_URL" >/dev/null 2>&1
}

is_port_in_use() {
  lsof -nP -iTCP:"$VITE_PORT" -sTCP:LISTEN >/dev/null 2>&1
}

cd "$PROJECT_ROOT"

info "Installing dependencies..."
run_clean_env pnpm install --frozen-lockfile 2>/dev/null || run_clean_env pnpm install
ok "Dependencies ready"

info "Building shared..."
run_clean_env pnpm --filter @my-claudia/shared run build
ok "Shared built"

if is_vite_ready; then
  ok "Vite already running on ${VITE_URL}, reusing existing dev server"
elif is_port_in_use; then
  die "Port ${VITE_PORT} is already in use, but no Vite server responded at ${VITE_URL}. Stop the conflicting process and retry."
else
  info "Starting Vite on ${VITE_URL}..."
  (
    cd "$DESKTOP_DIR"
    run_clean_env pnpm run dev -- --host 127.0.0.1
  ) &
  VITE_PID=$!

  if ! wait_for_vite; then
    die "Vite did not become ready at ${VITE_URL}"
  fi
  ok "Vite ready"
fi

info "Starting Tauri dev with sanitized environment..."
cd "$DESKTOP_DIR"
run_clean_env pnpm exec tauri dev -c "$TAURI_CONFIG_OVERRIDE" --no-dev-server-wait
