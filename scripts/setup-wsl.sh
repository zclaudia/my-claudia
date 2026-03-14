#!/bin/bash
# WSL Quick Setup Script for MyClaudia
# This script sets up and runs the MyClaudia server in WSL

set -e

REPO_URL="https://github.com/zhvala/my-claudia.git"
REPO_DIR="$HOME/my-claudia"
DEFAULT_PORT=3100
LOG_FILE="$HOME/.my-claudia-server.log"
PID_FILE="$HOME/.my-claudia-server.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running in WSL
check_wsl() {
    if ! grep -qi microsoft /proc/version 2>/dev/null; then
        log_error "This script must be run inside WSL"
        exit 1
    fi
    log_success "Running in WSL"
}

# Check Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        log_warn "Node.js not found. Installing via nvm..."

        # Install nvm
        if [ ! -d "$HOME/.nvm" ]; then
            log_info "Installing nvm..."
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        fi

        if [ -s "$HOME/.nvm/nvm.sh" ]; then
            export NVM_DIR="$HOME/.nvm"
            \. "$NVM_DIR/nvm.sh"
        fi

        # Install Node.js LTS
        log_info "Installing Node.js LTS..."
        nvm install --lts
        nvm use --lts
    fi

    NODE_VERSION=$(node -v)
    log_success "Node.js $NODE_VERSION installed"
}

# Check pnpm
check_pnpm() {
    if ! command -v pnpm &> /dev/null; then
        log_info "Installing pnpm..."
        npm install -g pnpm
    fi
    PNPM_VERSION=$(pnpm -v)
    log_success "pnpm $PNPM_VERSION installed"
}

# Clone or update repository
setup_repo() {
    if [ -d "$REPO_DIR" ]; then
        log_info "Repository exists. Updating..."
        cd "$REPO_DIR"
        git pull origin main || git pull origin master
    else
        log_info "Cloning repository..."
        git clone "$REPO_URL" "$REPO_DIR"
        cd "$REPO_DIR"
    fi
    log_success "Repository ready"
}

# Install dependencies and build
build_server() {
    log_info "Installing dependencies..."
    pnpm install

    log_info "Building shared package..."
    pnpm --filter shared build

    log_info "Building server..."
    pnpm --filter server build

    log_success "Build complete"
}

# Start the server
start_server() {
    log_info "Starting server on port $DEFAULT_PORT..."

    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            log_info "Stopping previous MyClaudia server (PID $OLD_PID)..."
            kill "$OLD_PID" 2>/dev/null || true
            sleep 1
        fi
        rm -f "$PID_FILE"
    fi

    if command -v lsof &> /dev/null; then
        EXISTING_PID=$(lsof -ti:$DEFAULT_PORT 2>/dev/null | head -n 1 || true)
        if [ -n "$EXISTING_PID" ]; then
            log_warn "Port $DEFAULT_PORT is already in use by PID $EXISTING_PID. Stopping it..."
            kill "$EXISTING_PID" 2>/dev/null || true
            sleep 1
        fi
    fi

    cd "$REPO_DIR/server"

    log_info "Writing server logs to $LOG_FILE"
    nohup env PORT=$DEFAULT_PORT node dist/index.js > "$LOG_FILE" 2>&1 < /dev/null &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PID_FILE"

    # Wait a moment and check if running
    sleep 2

    if curl -s "http://localhost:$DEFAULT_PORT/health" > /dev/null 2>&1; then
        log_success "Server is running!"
        echo ""
        echo -e "${GREEN}================================${NC}"
        echo -e "${GREEN}  MyClaudia Server is Ready!${NC}"
        echo -e "${GREEN}================================${NC}"
        echo ""
        echo -e "  Address: ${BLUE}localhost:$DEFAULT_PORT${NC}"
        echo -e "  PID: ${BLUE}$SERVER_PID${NC}"
        echo -e "  Logs: ${BLUE}$LOG_FILE${NC}"
        echo ""
        echo -e "  You can now connect from the Windows app."
        echo ""
    else
        log_error "Server failed to start. Check $LOG_FILE for details."
        rm -f "$PID_FILE"
        exit 1
    fi
}

# Main
main() {
    echo ""
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}  MyClaudia WSL Setup${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""

    check_wsl
    check_node
    check_pnpm
    setup_repo
    build_server
    start_server
}

main "$@"
