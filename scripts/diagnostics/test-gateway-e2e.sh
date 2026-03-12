#!/bin/bash

# End-to-end test for Gateway functionality
# Tests: Gateway + Server registration + Client connection flow

set -e

GATEWAY_SECRET="test-secret-12345"
GATEWAY_PORT=3200
SERVER_PORT=3101

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "🧪 Gateway End-to-End Test"
echo "=========================="
echo ""

# Build all packages first
echo "📦 Building packages..."
cd "$PROJECT_ROOT"
pnpm --filter shared build
pnpm --filter gateway build
pnpm --filter server build

# Clean up any existing processes
cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  lsof -ti:$GATEWAY_PORT | xargs kill -9 2>/dev/null || true
  lsof -ti:$SERVER_PORT | xargs kill -9 2>/dev/null || true
}
trap cleanup EXIT

# Start Gateway
echo ""
echo "🌐 Starting Gateway on port $GATEWAY_PORT..."
GATEWAY_SECRET="$GATEWAY_SECRET" GATEWAY_PORT=$GATEWAY_PORT node "$PROJECT_ROOT/gateway/dist/index.js" > /tmp/gateway-e2e.log 2>&1 &
GATEWAY_PID=$!
sleep 2

# Check Gateway health
echo "   Checking Gateway health..."
HEALTH=$(curl -s http://localhost:$GATEWAY_PORT/health)
echo "   Health: $HEALTH"

if ! echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "❌ Gateway health check failed"
  cat /tmp/gateway-e2e.log
  exit 1
fi

# Start Server with Gateway connection
echo ""
echo "🖥️  Starting Server on port $SERVER_PORT (connected to Gateway)..."
GATEWAY_URL="http://localhost:$GATEWAY_PORT" \
GATEWAY_SECRET="$GATEWAY_SECRET" \
GATEWAY_NAME="Test Backend E2E" \
PORT=$SERVER_PORT \
node "$PROJECT_ROOT/server/dist/index.js" > /tmp/server-e2e.log 2>&1 &
SERVER_PID=$!
sleep 3

# Check Gateway health again (should show 1 backend)
echo "   Checking Gateway after Server registration..."
HEALTH=$(curl -s http://localhost:$GATEWAY_PORT/health)
echo "   Health: $HEALTH"

if ! echo "$HEALTH" | grep -q '"backends":1'; then
  echo "❌ Server registration failed"
  echo ""
  echo "Gateway log:"
  cat /tmp/gateway-e2e.log
  echo ""
  echo "Server log:"
  cat /tmp/server-e2e.log
  exit 1
fi

echo "   ✅ Server registered to Gateway successfully!"

# Test direct server connection still works
echo ""
echo "🔌 Testing direct Server connection..."
DIRECT_HEALTH=$(curl -s http://localhost:$SERVER_PORT/health)
echo "   Direct server health: $DIRECT_HEALTH"

if ! echo "$DIRECT_HEALTH" | grep -q '"status":"ok"'; then
  echo "❌ Direct server connection failed"
  exit 1
fi

echo "   ✅ Direct connection works!"

# Summary
echo ""
echo "=========================="
echo "✅ All tests passed!"
echo ""
echo "Gateway log:"
echo "---"
cat /tmp/gateway-e2e.log
echo ""
echo "Server log:"
echo "---"
cat /tmp/server-e2e.log
