#!/usr/bin/env bash
#
# MyClaudia App — start dev app (Tauri or Standalone mode)
#
# Usage:
#   ./scripts/dev/start-app.sh [tauri|desktop|standalone|server]
#
# Default: Tauri dev mode
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

info() { echo -e "\033[0;34m>\033[0m $*"; }
ok()   { echo -e "\033[0;32m+\033[0m $*"; }
warn() { echo -e "\033[0;33m!\033[0m $*"; }
die()  { echo -e "\033[0;31mx\033[0m $*" >&2; exit 1; }

# Ensure fnm is available
setup_node() {
  eval "$(fnm env)" 2>/dev/null || die "fnm not found. Install fnm first."
}

# Determine mode from argument
MODE="tauri"
ARG="${1:-}"
case "$ARG" in
  standalone|server) MODE="standalone" ;;
  tauri|desktop|"") MODE="tauri" ;;
  *) die "Unknown mode: $ARG. Use: tauri, desktop, standalone, or server" ;;
esac

info "Mode: $MODE"

# --- Kill stale processes ---
kill_stale() {
  info "Stopping stale dev processes..."
  pgrep -f "tauri.dev.conf.json" | xargs -r kill 2>/dev/null || true
  pgrep -f "target/debug/my-claudia" | xargs -r kill 2>/dev/null || true
  pkill -f "server/dist/index.js" 2>/dev/null || true
  pkill -f "binaries/node.*server/dist/index.js" 2>/dev/null || true
  pkill -f "tsx watch src/index.ts" 2>/dev/null || true
  lsof -ti:1420 | xargs -r kill 2>/dev/null || true
  lsof -ti:3100 | xargs -r kill 2>/dev/null || true
}

# --- Wait for port to be free ---
wait_port_free() {
  local port=$1
  for i in $(seq 1 5); do
    if ! lsof -ti:"$port" >/dev/null 2>&1; then
      return 0
    fi
    info "Port $port still in use, waiting... ($i/5)"
    sleep 1
  done
  # Force kill
  local pid
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    warn "Force killing PID $pid on port $port"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  if lsof -ti:"$port" >/dev/null 2>&1; then
    die "Port $port is still occupied after force kill"
  fi
}

# --- Wait for URL to respond ---
wait_for_url() {
  local url=$1
  local timeout=$2
  local label=$3
  for i in $(seq 1 "$timeout"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      ok "$label is ready"
      return 0
    fi
    sleep 1
  done
  die "$label did not become ready at $url within ${timeout}s"
}

# --- Build shared + server ---
build() {
  info "Building shared..."
  (cd "$PROJECT_ROOT/shared" && setup_node && pnpm build)
  ok "Shared built"

  info "Building server..."
  (cd "$PROJECT_ROOT/server" && setup_node && pnpm build)
  ok "Server built"
}

# ============================================================
# Tauri dev mode
# ============================================================
start_tauri() {
  kill_stale

  wait_port_free 1420
  wait_port_free 3100

  build

  info "Starting Tauri dev..."
  cd "$PROJECT_ROOT/apps/desktop"
  setup_node
  exec pnpm exec tauri dev --config src-tauri/tauri.dev.conf.json
}

# ============================================================
# Standalone mode (separate server + vite)
# ============================================================
SERVER_PID=""
FRONTEND_PID=""

cleanup_standalone() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

start_standalone() {
  trap cleanup_standalone EXIT INT TERM

  kill_stale

  wait_port_free 3100
  wait_port_free 1420

  build

  info "Starting server (tsx watch)..."
  (cd "$PROJECT_ROOT/server" && setup_node && npx tsx watch src/index.ts) &
  SERVER_PID=$!

  info "Starting frontend (vite)..."
  (cd "$PROJECT_ROOT/apps/desktop" && setup_node && pnpm dev) &
  FRONTEND_PID=$!

  wait_for_url "http://localhost:3100/api/sessions" 20 "Backend"
  wait_for_url "http://localhost:1420" 20 "Frontend"

  ok "Standalone mode ready — backend :3100, frontend :1420"
  ok "Press Ctrl+C to stop"

  wait
}

# --- Main ---
case "$MODE" in
  tauri)       start_tauri ;;
  standalone)  start_standalone ;;
esac
