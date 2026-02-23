#!/usr/bin/env bash
#
# MyClaudia Gateway — deploy on router
#
# Usage:
#   cd /root/data/my-claudia && git pull && ./scripts/deploy-gateway.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$PROJECT_ROOT/gateway"
ENV_FILE="$COMPOSE_DIR/.env"
VERSION_FILE="$COMPOSE_DIR/.deploy-version"

# Colors
info() { echo -e "\033[0;34m>\033[0m $*"; }
ok()   { echo -e "\033[0;32m+\033[0m $*"; }
warn() { echo -e "\033[0;33m!\033[0m $*"; }
die()  { echo -e "\033[0;31mx\033[0m $*" >&2; exit 1; }

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
docker compose -f "$COMPOSE_DIR/docker-compose.yml" build
ok "Docker image built"

# Deploy
info "Restarting container..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" down
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d
ok "Container started"

# Health check
info "Waiting for health check..."
RETRIES=12
for i in $(seq 1 $RETRIES); do
  sleep 5
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' my-claudia-gateway 2>/dev/null || echo "unknown")"
  if [[ "$STATUS" == "healthy" ]]; then
    ok "Gateway is healthy"
    break
  fi
  if [[ "$i" -eq "$RETRIES" ]]; then
    warn "Health check did not pass after ${RETRIES} attempts (status: ${STATUS})"
    docker compose -f "$COMPOSE_DIR/docker-compose.yml" logs --tail=20
    exit 1
  fi
  info "Waiting... (attempt $i/$RETRIES, status: $STATUS)"
done

# Save version
echo "$NEW_VER" > "$VERSION_FILE"

# Summary
echo ""
docker compose -f "$COMPOSE_DIR/docker-compose.yml" ps
echo ""
ok "Deploy complete ($NEW_VER)"
ok "Logs: docker compose -f $COMPOSE_DIR/docker-compose.yml logs -f"
