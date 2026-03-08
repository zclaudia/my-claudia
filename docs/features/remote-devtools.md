# Remote Browser DevTools (B1) — Technical Design

## 1. Background

When using the mobile app to drive development through Gateway, there's no way to see UI results or debug frontend issues. The browser must run on the dev machine (to access localhost APIs), and the phone acts as a remote DevTools client.

**Architecture overview:**

```
Mobile → Gateway → Server → Chrome (CDP port 9222) → Dev Server (localhost:3000)
                                                    → Backend API (localhost:3100)
```

### Design Principles

1. **Browser runs on dev machine** — all page loads and API calls happen locally
2. **Phone is remote debugger only** — no frontend code runs on mobile
3. **Reuse Chrome DevTools** — no custom DevTools UI
4. **Minimal architecture changes** — leverage existing Gateway proxy and WS channel

---

## 2. Design Decisions

### 2.1 CDP Tunnel: Hybrid Approach

We evaluated three approaches for tunneling Chrome DevTools Protocol through Gateway:

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| Transparent WS Proxy | New WS endpoint on Gateway, direct byte forwarding | Simple, low latency, standard DevTools compatible | New endpoint, extra connection management |
| Message Wrapping | Wrap CDP in existing WS control channel messages | No new endpoints | High complexity, breaks binary data, adds latency |
| **Hybrid (chosen)** | HTTP proxy for DevTools UI + new WS path for CDP data | Best of both, leverages existing HTTP proxy | Slightly more Gateway code |

**Decision: Hybrid approach**
- DevTools frontend HTML/JS: served via existing Gateway HTTP proxy (`/api/proxy/:backendId/*`)
- CDP WebSocket data: new transparent WS proxy path on Gateway (`/devtools/:backendId/*`)
- Browser lifecycle (spawn/close): via existing WS control channel

### 2.2 Browser Management: Auto-detect Runtime Mode

We evaluated three browser management approaches:

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| System Chrome only | Use installed Chrome directly | Lightweight, real browser | Requires Chrome installed, can't run headless easily |
| Puppeteer only | Bundled Chromium via Puppeteer | Always available, easy headless | 200MB+ download, not real Chrome |
| **Auto-detect (chosen)** | Detect display mode, choose strategy | Flexible, works everywhere | Slightly more detection logic |

**Decision: Auto-detect runtime mode**
- **Desktop mode** (DISPLAY/WAYLAND_DISPLAY set): system Chrome, visible window
- **Headless mode** (no display): system Chrome with `--headless=new`, fallback to Puppeteer bundled Chromium
- Configurable via settings override

---

## 3. Shared Types

New message types in `shared/src/index.ts`:

```typescript
// Client → Gateway → Server: spawn browser
export interface GatewaySpawnBrowserMessage {
  type: 'spawn_browser';
  url: string;
  headless?: boolean;
}

// Server → Gateway → Client: browser spawned
export interface GatewayBrowserSpawnedMessage {
  type: 'browser_spawned';
  browserId: string;
  targets: Array<{ targetId: string; title: string; url: string }>;
  devtoolsFrontendUrl: string; // path for HTTP proxy
}

// Client → Gateway → Server: close browser
export interface GatewayCloseBrowserMessage {
  type: 'close_browser';
  browserId: string;
}

// Server → Gateway → Client: browser closed
export interface GatewayBrowserClosedMessage {
  type: 'browser_closed';
  browserId: string;
}
```

These types should be added to the existing union types: `ClientToGatewayMessage`, `GatewayToBackendMessage`, etc.

---

## 4. Browser Manager

New file: `server/src/browser-manager.ts`

Core responsibilities:
- Detect runtime mode (desktop vs headless)
- Find system Chrome binary
- Launch Chrome with `--remote-debugging-port`
- Track browser instances and their targets
- Cleanup on shutdown

```typescript
export class BrowserManager {
  private browsers: Map<string, BrowserInstance>;

  // Auto-detect: check DISPLAY / WAYLAND_DISPLAY env vars
  detectDisplayMode(): 'desktop' | 'headless';

  // Find Chrome: ordered search for system binary
  findChromeBinary(): string | null;

  // Launch browser, return CDP endpoint info
  async spawn(url: string, options?: { headless?: boolean }): Promise<BrowserInstance>;

  // Close specific browser
  async close(browserId: string): void;

  // Get CDP targets from http://localhost:{port}/json
  async getTargets(browserId: string): Promise<CDPTarget[]>;

  // Cleanup all browsers on shutdown
  async shutdown(): void;
}

interface BrowserInstance {
  id: string;
  process: ChildProcess;
  cdpPort: number;
  cdpWsUrl: string; // ws://localhost:{port}/devtools/browser/{id}
  headless: boolean;
}
```

### Chrome Binary Detection Order (Linux)

1. `google-chrome-stable`
2. `google-chrome`
3. `chromium-browser`
4. `chromium`

### Port Allocation

Start from 9222, increment if port is already in use.

### Headless Fallback

When no system Chrome is found in headless mode, fall back to Puppeteer's bundled Chromium (`puppeteer.launch()`).

---

## 5. Server Integration

### 5.1 REST API Endpoints

Add to `server/src/server.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/browser/spawn` | Launch browser with target URL |
| `POST` | `/api/browser/close` | Close a browser instance |
| `GET`  | `/api/browser/list` | List active browsers and targets |
| `GET`  | `/api/browser/targets/:browserId` | Get targets for a specific browser |

### 5.2 Gateway Client Extension

Add to `server/src/gateway-client.ts`:

Handle new message types from Gateway:
- `spawn_browser` → call `BrowserManager.spawn()`, return `browser_spawned` result
- `close_browser` → call `BrowserManager.close()`, return `browser_closed`

Add CDP WebSocket bridge:
- When Gateway sends `cdp_connect` with `browserId` + `targetId`
- Server opens WS to local Chrome at `ws://localhost:{port}/devtools/page/{targetId}`
- Server bridges the two WebSocket connections (Gateway ↔ Chrome)

---

## 6. Gateway CDP Proxy

### 6.1 WebSocket Proxy

New WebSocket endpoint: `/devtools/:backendId/:targetPath(*)`

```typescript
// Handle WebSocket upgrade on /devtools/ path
server.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(/^\/devtools\/([^/]+)\/(.+?)(\?.*)?$/);
  if (!match) return; // Not a devtools request, let existing handler process

  const [, backendId, targetPath] = match;
  const token = new URL(req.url, 'http://x').searchParams.get('token');

  // Verify gateway secret from token
  if (!verifyToken(token)) { socket.destroy(); return; }

  // Find backend connection
  const backend = backends.get(backendId);
  if (!backend) { socket.destroy(); return; }

  // Accept WebSocket upgrade
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    // Tell backend to connect to Chrome CDP and bridge
    sendToWs(backend.ws, {
      type: 'cdp_connect',
      connectionId: generateId(),
      targetPath // e.g., "devtools/page/ABC123"
    });

    // Bridge: clientWs ↔ backend WS (bidirectional forwarding)
  });
});
```

### 6.2 HTTP Proxy for DevTools Frontend

Leverage existing HTTP proxy for DevTools static assets:

- `GET /api/proxy/:backendId/json` → Chrome's target list
- `GET /api/proxy/:backendId/devtools/inspector.html` → DevTools UI HTML

---

## 7. Data Flow

### 7.1 Launching a Browser (via Mobile)

```
Mobile ──{spawn_browser, url}──→ Gateway ──forward──→ Server

Server: BrowserManager.spawn(url)
  → spawn chrome --remote-debugging-port=9223 url
  → GET http://localhost:9223/json → targets list

Server ──{browser_spawned, browserId, targets, devtoolsFrontendUrl}──→ Gateway ──→ Mobile
```

### 7.2 Opening DevTools (from Mobile)

```
Mobile browser navigates to:
  https://gateway:3200/api/proxy/backend123/devtools/inspector.html?ws=...
  → Gateway HTTP proxy → Server → Chrome DevTools HTML

DevTools frontend connects CDP WebSocket:
  wss://gateway:3200/devtools/backend123/devtools/page/TARGET_ID?token=xxx
  → Gateway WS proxy → Server → ws://localhost:9223/devtools/page/TARGET_ID

CDP commands flow bidirectionally through this tunnel.
```

### 7.3 User Workflow: Modify UI and Verify

```
1. User sends dev task from mobile
2. Claude modifies frontend code
3. Server starts dev server (if needed)
4. User taps "Launch Browser" → Server spawns Chrome → opens dev URL
5. Server returns DevTools URL to mobile
6. User opens DevTools in mobile browser
7. User inspects DOM, console, network
8. User continues sending dev tasks, Chrome auto-refreshes via HMR
```

---

## 8. Desktop Client UI

New component: `DevToolsPanel` or toolbar button.

Minimal MVP scope:
- "Launch Browser" button when a project is selected
- URL input field (defaults to project's dev server URL)
- Display DevTools access link (copyable, shareable with mobile)
- List active browser instances with close buttons

---

## 9. File Changes Summary

| # | File | Change |
|---|------|--------|
| 1 | `shared/src/index.ts` | New browser message types + union type updates |
| 2 | `server/src/browser-manager.ts` | **NEW** — Chrome launch/manage/detect |
| 3 | `server/src/server.ts` | Add browser REST API endpoints |
| 4 | `server/src/gateway-client.ts` | Handle browser messages, CDP WS bridge |
| 5 | `gateway/src/server.ts` | Add `/devtools/` WS proxy + upgrade handler |
| 6 | `apps/desktop/src/components/` | DevTools launch UI (minimal) |

---

## 10. Security

- CDP port (`9222+`) must NOT be exposed to the network — only accessible via `localhost`
- Gateway WS proxy requires valid token (gateway secret) on all `/devtools/` connections
- DevTools HTTP assets also go through Gateway auth
- Session token expiration for time-limited access

---

## 11. Verification Plan

1. **Unit tests**: BrowserManager — spawn Chrome, get targets, close, detect display mode
2. **Integration tests**: Gateway CDP proxy — connect DevTools frontend through proxy chain
3. **E2E tests**:
   - Desktop: click "Launch Browser" → Chrome opens → DevTools URL displayed
   - Mobile: open DevTools URL → can inspect page DOM / console / network
4. **Headless test**: Set `DISPLAY=""` → Chrome launches headless → DevTools still works via proxy

---

## 12. Scope

### MVP (Phase 1)

- BrowserManager with auto-detect (desktop/headless)
- Gateway CDP WebSocket proxy
- Basic REST API for browser lifecycle
- DevTools accessible via Gateway with auth

### Phase 2 (Later)

- Screencast (live page preview for headless mode)
- Mobile-optimized DevTools UI
- Auto-detect dev server URL from project config
- Screenshot API for Claude to analyze UI
- Multiple browser profiles/sessions
- Console/network API for Claude to read errors
- Claude auto-analyzes page errors and suggests fixes
