# MyClaudia

Cross-platform UI for Claude Code CLI (desktop + mobile).

## Project Structure

```
my-claudia/
├── shared/          # Shared types & protocols (no deps, build first)
├── server/          # Backend server (Express + WebSocket + Claude SDK)
├── gateway/         # Gateway relay service (Express + WebSocket + SQLite)
├── apps/desktop/    # Tauri v2 desktop + mobile app (React + Vite)
├── scripts/         # Deploy & build scripts
└── e2e/             # End-to-end tests (Vitest)
```

- pnpm workspace with `workspace:*` dependencies
- Build order: **shared** first, then server/gateway/desktop in parallel

## Key Ports & Environment Variables

| Service | Default Port | Port Env | Notes |
|---------|-------------|----------|-------|
| Server | 3100 | `PORT` (supports `0` for random) | `SERVER_HOST` defaults to `0.0.0.0` |
| Gateway | 3200 | `GATEWAY_PORT` | |
| Vite dev | 1420 | - | hardcoded, `strictPort: true` |

| Env Var | Used By | Purpose |
|---------|---------|---------|
| `MY_CLAUDIA_DATA_DIR` | server | Override data directory (default: `~/.my-claudia/`) |
| `GATEWAY_URL` | server | WebSocket URL to connect to gateway |
| `GATEWAY_SECRET` | server, gateway | Shared secret for gateway auth |
| `GATEWAY_NAME` | server | Backend display name on gateway |

## Server (`server/`)

- Entry: `server/src/index.ts`
- Express HTTP + WebSocket on same port
- Calls Claude CLI via `@anthropic-ai/claude-agent-sdk` — no ANTHROPIC_API_KEY needed, CLI manages its own auth (`claude login`)
- SQLite database: `~/.my-claudia/data.db` (or `$MY_CLAUDIA_DATA_DIR/data.db`)
- File storage: `~/.my-claudia/files/`
- Gateway client (`server/src/gateway-client.ts`): connects to gateway, registers as backend, infinite reconnect with exponential backoff (5s base, 60s cap)
- `PORT=0` support: outputs `SERVER_READY:<port>` to stdout for parent process discovery

## Gateway (`gateway/`)

- Entry: `gateway/src/index.ts` → `gateway/src/server.ts`
- Relay/proxy between backends and clients over WebSocket
- Backends register with gateway secret + device ID
- Clients authenticate, discover backends, send/receive messages through gateway
- HTTP proxy: REST requests proxied over WebSocket (for NAT traversal)
- SQLite storage: device-to-backend ID mappings (persistent 8-char hex IDs)
- Health endpoint: `GET /health`

### Docker Deployment

- Dockerfile: `gateway/Dockerfile` (multi-stage, node:20-slim, no build tools needed — better-sqlite3 uses prebuilt binaries)
- docker-compose: `gateway/docker-compose.yml` (build context is repo root `..`)
- `.dockerignore` at repo root excludes everything except shared/ and gateway/
- `GATEWAY_PORT` variable used in port mapping, container env, and healthcheck
- No hardcoded `container_name` — multiple instances possible via `-p PROJECT_NAME`
- Deploy script: `scripts/deploy-gateway.sh [-p PROJECT] [-e ENV_FILE]`

## Desktop App (`apps/desktop/`)

- Tauri v2 + React + Vite, identifier: `com.myClaudia.desktop`
- State management: Zustand stores in `src/stores/`
- Embedded server (`src/hooks/useEmbeddedServer.ts`):
  - Desktop only (not Android) — spawns Node.js server via Tauri shell plugin
  - Random port via `PORT=0`, parses `SERVER_READY:<port>` from stdout
  - Data dir: `appDataDir()`, dev mode appends `-dev/` for isolation
- Connection: `src/hooks/useMultiServerSocket.ts` manages WebSocket connections
- Server store: `src/stores/serverStore.ts` — local server ID is `'local'`

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/deploy-gateway.sh` | Deploy gateway Docker container (supports multi-instance) |
| `scripts/deploy-server.sh` | Deploy server on remote host (systemd) |
| `scripts/setup-server.sh` | Initial server setup + systemd service install |
| `scripts/build-{android,linux,macos}.sh` | Platform-specific builds |
| `scripts/version-bump.sh` | Version management |

## Dev Commands

```bash
pnpm dev                    # Run all packages in dev mode
pnpm server:dev             # Server only (port 3100)
pnpm server:dev:isolated    # Server with random port + isolated data dir
pnpm gateway:dev            # Gateway only (port 3200)
pnpm desktop:dev            # Desktop app only (Vite port 1420)
pnpm test                   # Run all tests
pnpm test:e2e               # End-to-end tests
```
