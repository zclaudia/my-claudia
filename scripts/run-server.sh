#!/usr/bin/env bash
#
# MyClaudia Server — run latest backend locally (isolated dev mode)
#
# Usage:
#   ./scripts/run-server.sh              # build + run (PORT=0, isolated data dir)
#   ./scripts/run-server.sh --port 3100  # use specific port
#   ./scripts/run-server.sh --stop       # stop running instance
#   ./scripts/run-server.sh --status     # check if running
#   ./scripts/run-server.sh --logs       # tail the log file
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="$HOME/.my-claudia-dev"
PID_FILE="$DATA_DIR/.server.pid"
LOG_FILE="$DATA_DIR/server.log"
PORT="${PORT:-0}"

# Parse args
ACTION="run"
while [[ $# -gt 0 ]]; do
  case $1 in
    --port)   PORT="$2"; shift 2 ;;
    --stop)   ACTION="stop"; shift ;;
    --status) ACTION="status"; shift ;;
    --logs)   ACTION="logs"; shift ;;
    -h|--help)
      echo "Usage: $0 [--port PORT] [--stop] [--status] [--logs]"
      echo "  --port PORT  Server port (default: 0 = random)"
      echo "  --stop       Stop running instance"
      echo "  --status     Check if running"
      echo "  --logs       Tail the log file"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$DATA_DIR"

# Colors
info() { echo -e "\033[0;34m>\033[0m $*"; }
ok()   { echo -e "\033[0;32m+\033[0m $*"; }
warn() { echo -e "\033[0;33m!\033[0m $*"; }
die()  { echo -e "\033[0;31mx\033[0m $*" >&2; exit 1; }

# Check if a saved PID is still alive
is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

stop_old() {
  if is_running; then
    local old_pid
    old_pid="$(cat "$PID_FILE")"
    info "Stopping old server (PID $old_pid)..."
    kill "$old_pid" 2>/dev/null
    # Wait up to 5 seconds for graceful shutdown
    for _ in $(seq 1 10); do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.5
    done
    # Force kill if still alive
    if kill -0 "$old_pid" 2>/dev/null; then
      warn "Force killing PID $old_pid"
      kill -9 "$old_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    ok "Old server stopped"
  fi
}

cmd_stop() {
  if is_running; then
    stop_old
  else
    info "No server running"
  fi
}

cmd_status() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    ok "Server running (PID $pid)"
    # Show the last few lines with port info
    if [[ -f "$LOG_FILE" ]]; then
      grep -m1 "SERVER_READY\|listening on" "$LOG_FILE" 2>/dev/null || true
    fi
  else
    info "Server not running"
    [[ -f "$PID_FILE" ]] && rm -f "$PID_FILE"
  fi
}

cmd_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -f "$LOG_FILE"
  else
    die "No log file at $LOG_FILE"
  fi
}

cmd_run() {
  cd "$PROJECT_ROOT"

  # Stop old instance
  stop_old

  # Install deps
  info "Installing dependencies..."
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  ok "Dependencies installed"

  # Build
  info "Building shared..."
  pnpm --filter @my-claudia/shared run build 2>&1
  info "Building server..."
  pnpm --filter @my-claudia/server run build 2>&1
  ok "Build complete"

  # Load env file if exists (GATEWAY_URL, GATEWAY_SECRET, etc.)
  ENV_FILE="$DATA_DIR/.env"
  if [[ -f "$ENV_FILE" ]]; then
    info "Loading env from $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
  fi

  # Start server in background (PORT and MY_CLAUDIA_DATA_DIR override .env)
  info "Starting server (PORT=$PORT, data=$DATA_DIR)..."
  PORT="$PORT" \
  MY_CLAUDIA_DATA_DIR="$DATA_DIR" \
  NODE_ENV=production \
    node "$PROJECT_ROOT/server/dist/index.js" \
    > "$LOG_FILE" 2>&1 &

  local pid=$!
  echo "$pid" > "$PID_FILE"

  # Wait for server to be ready (up to 10 seconds)
  local ready=false
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      die "Server exited unexpectedly. Check logs: $LOG_FILE"
    fi
    if grep -q "SERVER_READY\|listening on" "$LOG_FILE" 2>/dev/null; then
      ready=true
      break
    fi
    sleep 0.5
  done

  if [ "$ready" = true ]; then
    ok "Server started (PID $pid)"
    grep -m1 "SERVER_READY\|listening on" "$LOG_FILE" 2>/dev/null || true
  else
    warn "Server started (PID $pid) but readiness not confirmed yet"
    warn "Check logs: $LOG_FILE"
  fi

  ok "PID file: $PID_FILE"
  ok "Logs: $0 --logs"
}

case "$ACTION" in
  run)    cmd_run ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  logs)   cmd_logs ;;
esac
