Kill any running dev processes, then restart in the appropriate mode.

Detect which mode to use:
- If the user says "tauri" or "desktop", use **Tauri dev mode**
- If the user says "standalone" or "server", use **Standalone mode**
- Default: **Tauri dev mode** (most common workflow)

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used. fnm auto-switches via .node-version.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

---

## Tauri Dev Mode (default)

Runs Vite + Tauri binary + embedded Node server as a single process tree.

### Step 1: Kill ALL stale processes

Run in a single command (only kill THIS project's dev processes, not production app or gateway):
```
pgrep -f "tauri.dev.conf.json" | xargs kill 2>/dev/null
pgrep -f "target/debug/my-claudia" | xargs kill 2>/dev/null
lsof -ti:1420 | xargs kill 2>/dev/null
lsof -ti:3100 | xargs kill 2>/dev/null
```

### Step 2: Verify ports are free

Loop up to 5 times (1 second apart) checking `lsof -ti:1420` AND `lsof -ti:3100`. Both must be free. If still occupied after 5 attempts, `kill -9` the PID and report a warning.

### Step 3: Rebuild shared + server

Always rebuild to pick up source changes (Vite auto-reloads frontend, but the embedded server uses pre-built dist files).

Run sequentially (server depends on shared types):
1. `cd $PROJECT_ROOT/shared && eval "$(fnm env)" && pnpm build`
2. `cd $PROJECT_ROOT/server && eval "$(fnm env)" && pnpm build`

### Step 4: Start Tauri dev

```
cd $PROJECT_ROOT/apps/desktop && eval "$(fnm env)" && pnpm exec tauri dev --config src-tauri/tauri.dev.conf.json 2>&1
```

Run this as a **background command** with a 10-minute timeout.

### Step 5: Wait and verify

1. Wait in a loop (up to 30 seconds, polling every 3 seconds) until `curl -s http://localhost:1420` returns a non-empty response
2. If Vite never responds, check the background task output for errors and report to user
3. Once Vite is confirmed running, report success. The embedded server uses a random port — check the app UI for its status.

---

## Standalone Mode

Runs server and frontend as separate processes (useful for web-only development).

### Step 1: Kill stale processes

```
lsof -ti:3100 | xargs kill -9 2>/dev/null
lsof -ti:1420 | xargs kill -9 2>/dev/null
pkill -f "server/dist/index.js" 2>/dev/null
```

### Step 2: Verify ports are free

Same loop check as Tauri mode, but for both ports 3100 and 1420.

### Step 3: Rebuild shared + server

Same as Tauri mode Step 3 (always rebuild).

Note: standalone mode uses `tsx watch` which auto-reloads on server source changes, but shared types still need a build if changed.

### Step 4: Start backend server

```
cd $PROJECT_ROOT/server && eval "$(fnm env)" && npx tsx watch src/index.ts
```

Run as a background command.

### Step 5: Start frontend dev server

```
cd $PROJECT_ROOT/apps/desktop && eval "$(fnm env)" && pnpm dev
```

Run as a background command.

### Step 6: Wait and verify

Loop (up to 20 seconds, polling every 3 seconds) until both respond:
- Backend: `curl -s http://localhost:3100/api/sessions | head -c 50`
- Frontend: `curl -s http://localhost:1420 | head -c 50`

Report the result.
