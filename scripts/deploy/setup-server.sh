#!/usr/bin/env bash
#
# MyClaudia Server — One-click setup & systemd service installer
#
# Usage:
#   ./scripts/deploy/setup-server.sh [command]
#
# Commands:
#   install   (default) Check deps, build, create systemd service
#   start     Start the service
#   stop      Stop the service
#   restart   Restart the service
#   status    Show service status
#   logs      Tail service logs
#   uninstall Remove systemd service
#   env       Edit environment config file
#
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────

SERVICE_NAME="my-claudia-server"
SERVICE_USER="${SUDO_USER:-$USER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env.server"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Minimum versions
MIN_NODE_MAJOR=20
MIN_PNPM_MAJOR=9

# ── Colors ─────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { err "$@"; exit 1; }

# ── Helper Functions ───────────────────────────────────────────

check_node() {
  if ! command -v node &>/dev/null; then
    die "Node.js is not installed. Please install Node.js >= ${MIN_NODE_MAJOR}.x first.
    Recommended: https://github.com/nvm-sh/nvm or https://nodejs.org/"
  fi

  local node_version
  node_version="$(node -v | sed 's/^v//')"
  local major="${node_version%%.*}"

  if (( major < MIN_NODE_MAJOR )); then
    die "Node.js ${node_version} is too old. Required: >= ${MIN_NODE_MAJOR}.x"
  fi

  ok "Node.js ${node_version}"
}

check_pnpm() {
  if ! command -v pnpm &>/dev/null; then
    warn "pnpm is not installed. Installing via corepack..."
    corepack enable && corepack prepare pnpm@latest --activate \
      || die "Failed to install pnpm. Please install manually: npm install -g pnpm"
  fi

  local pnpm_version
  pnpm_version="$(pnpm --version)"
  local major="${pnpm_version%%.*}"

  if (( major < MIN_PNPM_MAJOR )); then
    die "pnpm ${pnpm_version} is too old. Required: >= ${MIN_PNPM_MAJOR}.x"
  fi

  ok "pnpm ${pnpm_version}"
}

check_claude_cli() {
  if ! command -v claude &>/dev/null; then
    warn "Claude CLI is not installed. The server needs it to run AI queries."
    warn "Install: npm install -g @anthropic-ai/claude-code"
    warn "Then run: claude login"
  else
    ok "Claude CLI $(claude --version 2>/dev/null || echo '(version unknown)')"
  fi
}

check_build_tools() {
  # better-sqlite3 needs native compilation
  local missing=()
  command -v python3 &>/dev/null || command -v python &>/dev/null || missing+=("python3")
  command -v make    &>/dev/null || missing+=("make")
  command -v gcc     &>/dev/null || command -v cc &>/dev/null || missing+=("gcc")

  if (( ${#missing[@]} > 0 )); then
    warn "Native build tools may be needed for better-sqlite3: ${missing[*]}"
    warn "If install fails, run: sudo apt install -y python3 make gcc g++"
  fi
}

install_deps() {
  info "Installing dependencies..."
  cd "$PROJECT_ROOT"
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  ok "Dependencies installed"
}

build_project() {
  info "Building shared package..."
  cd "$PROJECT_ROOT"
  pnpm --filter @my-claudia/shared run build
  ok "Shared package built"

  info "Building server..."
  pnpm --filter @my-claudia/server run build
  ok "Server built"
}

create_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    info "Environment file already exists: $ENV_FILE"
    return
  fi

  info "Creating environment file: $ENV_FILE"
  cat > "$ENV_FILE" <<'ENVEOF'
# MyClaudia Server Environment Configuration
# Edit this file, then run: ./scripts/deploy/setup-server.sh restart

# Server binding
PORT=3100
SERVER_HOST=0.0.0.0

# Gateway connection (optional — can also be configured via the UI)
# GATEWAY_URL=wss://your-gateway.example.com
# GATEWAY_SECRET=your-secret-here
# GATEWAY_NAME=My Remote Server

# Note: No ANTHROPIC_API_KEY needed here.
# The server calls Claude CLI on the host machine, which manages its own auth.
# Make sure to run `claude login` on this machine first.

# Proxy settings (optional)
# HTTP_PROXY=
# HTTPS_PROXY=
ENVEOF

  ok "Environment file created at $ENV_FILE"
  warn "Please edit $ENV_FILE if you need to change PORT or Gateway settings"
}

get_node_path() {
  # Resolve the actual node binary path (handles nvm, fnm, etc.)
  command -v node
}

get_pnpm_path() {
  command -v pnpm
}

create_systemd_service() {
  local node_bin
  node_bin="$(get_node_path)"
  local node_dir
  node_dir="$(dirname "$node_bin")"

  info "Creating systemd service: $SERVICE_NAME"

  local service_content
  service_content="[Unit]
Description=MyClaudia Server
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${PROJECT_ROOT}
EnvironmentFile=${ENV_FILE}
Environment=PATH=${node_dir}:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
ExecStart=${node_bin} ${PROJECT_ROOT}/server/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${PROJECT_ROOT} /home/${SERVICE_USER}/.my-claudia

[Install]
WantedBy=multi-user.target"

  # Need sudo to write systemd service file
  if [[ $EUID -ne 0 ]]; then
    info "Requesting sudo to install systemd service..."
    echo "$service_content" | sudo tee "$SERVICE_FILE" > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
  else
    echo "$service_content" > "$SERVICE_FILE"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
  fi

  ok "Systemd service installed and enabled"
}

# ── Commands ───────────────────────────────────────────────────

cmd_install() {
  echo ""
  echo "═══════════════════════════════════════════════"
  echo "  MyClaudia Server — Setup"
  echo "═══════════════════════════════════════════════"
  echo ""

  info "Step 1/5: Checking prerequisites..."
  check_node
  check_pnpm
  check_claude_cli
  check_build_tools

  info "Step 2/5: Installing dependencies..."
  install_deps

  info "Step 3/5: Building project..."
  build_project

  info "Step 4/5: Creating environment file..."
  create_env_file

  info "Step 5/5: Setting up systemd service..."
  create_systemd_service

  # Create data directory
  local data_dir="/home/${SERVICE_USER}/.my-claudia"
  mkdir -p "$data_dir"

  echo ""
  echo "═══════════════════════════════════════════════"
  echo -e "  ${GREEN}Setup complete!${NC}"
  echo "═══════════════════════════════════════════════"
  echo ""
  echo "  Next steps:"
  echo ""
  echo "  1. Edit environment config:"
  echo "     $ENV_FILE"
  echo ""
  echo "  2. Start the server:"
  echo "     ./scripts/deploy/setup-server.sh start"
  echo ""
  echo "  3. Check status:"
  echo "     ./scripts/deploy/setup-server.sh status"
  echo ""
  echo "  4. View logs:"
  echo "     ./scripts/deploy/setup-server.sh logs"
  echo ""
  echo "  Data directory: /home/${SERVICE_USER}/.my-claudia"
  echo "  Server address: http://0.0.0.0:3100 (edit in .env.server)"
  echo ""
}

cmd_start() {
  info "Starting $SERVICE_NAME..."
  sudo systemctl start "$SERVICE_NAME"
  ok "Service started"
  systemctl --no-pager status "$SERVICE_NAME" || true
}

cmd_stop() {
  info "Stopping $SERVICE_NAME..."
  sudo systemctl stop "$SERVICE_NAME"
  ok "Service stopped"
}

cmd_restart() {
  info "Restarting $SERVICE_NAME..."
  sudo systemctl restart "$SERVICE_NAME"
  ok "Service restarted"
  systemctl --no-pager status "$SERVICE_NAME" || true
}

cmd_status() {
  systemctl --no-pager status "$SERVICE_NAME" || true
}

cmd_logs() {
  journalctl -u "$SERVICE_NAME" -f --no-pager
}

cmd_uninstall() {
  info "Removing $SERVICE_NAME service..."
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "$SERVICE_FILE"
  sudo systemctl daemon-reload
  ok "Service removed"
  info "Environment file preserved at: $ENV_FILE"
  info "Data preserved at: /home/${SERVICE_USER}/.my-claudia"
}

cmd_env() {
  local editor="${EDITOR:-vi}"
  "$editor" "$ENV_FILE"
}

cmd_rebuild() {
  info "Rebuilding project..."
  build_project
  ok "Rebuild complete. Run './scripts/deploy/setup-server.sh restart' to apply."
}

# ── Main ───────────────────────────────────────────────────────

main() {
  local cmd="${1:-install}"

  case "$cmd" in
    install)   cmd_install   ;;
    start)     cmd_start     ;;
    stop)      cmd_stop      ;;
    restart)   cmd_restart   ;;
    status)    cmd_status    ;;
    logs)      cmd_logs      ;;
    uninstall) cmd_uninstall ;;
    env)       cmd_env       ;;
    rebuild)   cmd_rebuild   ;;
    *)
      echo "Usage: $0 {install|start|stop|restart|status|logs|uninstall|env|rebuild}"
      exit 1
      ;;
  esac
}

main "$@"
