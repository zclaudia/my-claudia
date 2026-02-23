#!/usr/bin/env bash
#
# MyClaudia Gateway — deploy on router
#
# Usage:
#   cd /root/data/my-claudia && git pull && ./scripts/deploy-gateway.sh
#   ./scripts/deploy-gateway.sh --project gw2 --env gateway/.env.2
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$PROJECT_ROOT/gateway"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"

# Defaults
PROJECT_NAME="claudia-gateway"
ENV_FILE="$COMPOSE_DIR/.env"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    -e|--env)     ENV_FILE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [-p|--project NAME] [-e|--env FILE]"
      echo "  -p, --project  Docker Compose project name (default: claudia-gateway)"
      echo "  -e, --env      Path to .env file (default: gateway/.env)"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

VERSION_FILE="$COMPOSE_DIR/.deploy-version-${PROJECT_NAME}"

# Colors
info() { echo -e "\033[0;34m>\033[0m $*"; }
ok()   { echo -e "\033[0;32m+\033[0m $*"; }
warn() { echo -e "\033[0;33m!\033[0m $*"; }
die()  { echo -e "\033[0;31mx\033[0m $*" >&2; exit 1; }

COMPOSE="docker compose -f $COMPOSE_FILE -p $PROJECT_NAME --env-file $ENV_FILE"

info "Project: $PROJECT_NAME | Env: $ENV_FILE"
echo ""

# Prerequisites
command -v docker >/dev/null 2>&1 || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose not found"

# Version tracking
NEW_VER="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
NEW_SUBJECT="$(git -C "$PROJECT_ROOT" log -1 --format='%s' 2>/dev/null || echo "")"
OLD_VER=""
[[ -f "$VERSION_FILE" ]] && OLD_VER="$(cat "$VERSION_FILE")"

if [[ -n "$OLD_VER" && "$OLD_VER" != "$NEW_VER" ]]; then
  info "Upgrading: ${OLD_VER} -> ${NEW_VER} (${NEW_SUBJECT})"
elif [[ -n "$OLD_VER" ]]; then
  info "Redeploying: ${NEW_VER} (no version change)"
else
  info "First deploy: ${NEW_VER} (${NEW_SUBJECT})"
fi
echo ""

# Check .env
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — create it with: echo 'GATEWAY_SECRET=your-secret' > $ENV_FILE"
grep -q '^GATEWAY_SECRET=' "$ENV_FILE" || die "GATEWAY_SECRET not found in $ENV_FILE"
ok ".env OK"

# Build
info "Building Docker image..."
$COMPOSE build
ok "Docker image built"

# Deploy
info "Restarting container..."
$COMPOSE down
$COMPOSE up -d
ok "Container started"

# Health check — find container name dynamically
CONTAINER="$($COMPOSE ps -q gateway 2>/dev/null | head -1)"
if [[ -z "$CONTAINER" ]]; then
  warn "Could not find container, skipping health check"
else
  info "Waiting for health check..."
  RETRIES=12
  for i in $(seq 1 $RETRIES); do
    sleep 5
    STATUS="$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "unknown")"
    if [[ "$STATUS" == "healthy" ]]; then
      ok "Gateway is healthy"
      break
    fi
    if [[ "$i" -eq "$RETRIES" ]]; then
      warn "Health check did not pass after ${RETRIES} attempts (status: ${STATUS})"
      $COMPOSE logs --tail=20
      exit 1
    fi
    info "Waiting... (attempt $i/$RETRIES, status: $STATUS)"
  done
fi

# Save version
echo "$NEW_VER" > "$VERSION_FILE"

# Summary
echo ""
$COMPOSE ps
echo ""
ok "Deploy complete ($NEW_VER)"
ok "Logs: $COMPOSE logs -f"
