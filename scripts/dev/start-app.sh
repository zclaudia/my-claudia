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

# Ensure fnm is available and uses the project's .node-version
setup_node() {
  eval "$(fnm env --use-on-cd)" 2>/dev/null || die "fnm not found. Install fnm first."
  fnm use --silent-if-unchanged 2>/dev/null || true
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

# --- Ensure native modules work with the Tauri sidecar Node ---
ensure_native_modules() {
  local sidecar
  sidecar=$(ls "$PROJECT_ROOT/apps/desktop/src-tauri/binaries/node-"* 2>/dev/null | head -1)

  if [[ -n "$sidecar" && -x "$sidecar" ]]; then
    if ! "$sidecar" -e "require('module').createRequire(process.cwd()+'/package.json')('better-sqlite3')" 2>/dev/null; then
      info "Rebuilding native modules for sidecar Node ($("$sidecar" --version))..."
      (cd "$PROJECT_ROOT" && pnpm rebuild better-sqlite3)
      if "$sidecar" -e "require('module').createRequire(process.cwd()+'/package.json')('better-sqlite3')" 2>/dev/null; then
        ok "Native modules rebuilt for sidecar"
      else
        warn "Native module rebuild may not have matched sidecar ABI — app might fail to start"
      fi
    fi
  fi
}

# --- Build shared + server ---
build() {
  setup_node
  ensure_native_modules

  info "Building shared..."
  (cd "$PROJECT_ROOT/shared" && setup_node && pnpm build)
  ok "Shared built"

  info "Building server..."
  (cd "$PROJECT_ROOT/server" && setup_node && pnpm build)
  ok "Server built"
}

# ============================================================
# Shared cleanup — always kill port 3100 on exit
# ============================================================
TAURI_PID=""
SERVER_PID=""
FRONTEND_PID=""

cleanup() {
  info "Cleaning up..."
  # Kill tracked child processes
  [[ -n "$TAURI_PID" ]]    && kill "$TAURI_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]]   && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  # Wait for children to exit gracefully (1s)
  sleep 1
  # Port-level fallback: kill anything still on 3100 and 1420
  lsof -ti:3100 | xargs -r kill 2>/dev/null || true
  lsof -ti:1420 | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
  ok "Dev processes stopped"
}

trap cleanup EXIT INT TERM

# ============================================================
# Tauri dev mode
# ============================================================
start_tauri() {
  kill_stale

  wait_port_free 1420
  wait_port_free 3100

  build

  # Pre-start the server so the Tauri app reuses it via health check,
  # bypassing the sidecar native module check entirely.
  info "Starting server (pre-launch)..."
  (
    cd "$PROJECT_ROOT"
    setup_node
    MY_CLAUDIA_DATA_DIR=/tmp/my-claudia-dev/ \
    MY_CLAUDIA_CHANNEL=dev \
    PORT=3100 \
    SERVER_HOST=127.0.0.1 \
    node server/dist/index.js
  ) &
  SERVER_PID=$!

  wait_for_url "http://127.0.0.1:3100/health" 15 "Backend"

  info "Starting Tauri dev..."
  cd "$PROJECT_ROOT/apps/desktop"
  setup_node
  # Run in foreground (not exec) so trap cleanup fires on exit
  pnpm exec tauri dev --config src-tauri/tauri.dev.conf.json &
  TAURI_PID=$!
  wait "$TAURI_PID" || true
}

# ============================================================
# Standalone mode (separate server + vite)
# ============================================================
start_standalone() {
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
