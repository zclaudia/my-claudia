Kill any running dev processes, then restart in the appropriate mode.

Detect which mode to use:
- If the user says "tauri" or "desktop", use **Tauri dev mode**
- If the user says "standalone" or "server", use **Standalone mode**
- Default: **Tauri dev mode** (most common workflow)

## Tauri Dev Mode (default)

Runs Vite + Tauri binary + embedded Node server as a single process tree.

Steps:
1. Kill stale processes:
   - `lsof -ti:1420 | xargs kill -9 2>/dev/null` (stale Vite dev server)
   - `pkill -f "tauri dev" 2>/dev/null` (stale Tauri dev process)
   - `pkill -f "cargo run.*tauri" 2>/dev/null` (stale cargo/Tauri binary)
   - `pkill -f "server/dist/index.js" 2>/dev/null` (stale embedded server)
2. Wait 2 seconds for ports to free up
3. Start Tauri dev in the background: `cd $PROJECT_ROOT/apps/desktop && pnpm exec tauri dev`
4. Wait ~15 seconds for Vite + Cargo build + Tauri to start
5. Verify Vite is running: `curl -s http://localhost:1420 | head -c 50`
6. Report the result (note: embedded server uses a random port, check the app UI for status)

## Standalone Mode

Runs server and frontend as separate processes (useful for web-only development).

Steps:
1. Kill stale processes:
   - `lsof -ti:3100 | xargs kill -9 2>/dev/null` (server on port 3100)
   - `lsof -ti:1420 | xargs kill -9 2>/dev/null` (Vite dev server)
2. Start the backend server in the background: `cd $PROJECT_ROOT/server && npx tsx watch src/index.ts`
3. Start the frontend dev server in the background: `cd $PROJECT_ROOT/apps/desktop && pnpm dev`
4. Wait a few seconds, then verify both are running:
   - Backend: `curl -s http://localhost:3100/api/sessions | head -c 50`
   - Frontend: `curl -s http://localhost:1420 | head -c 50`
5. Report the result

Note: $PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).
