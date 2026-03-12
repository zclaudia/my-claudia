Kill stale dev processes, then start the app in the appropriate development mode.

Mode selection from `$ARGUMENTS`:
- contains `tauri` or `desktop` -> use **Tauri dev mode**
- contains `standalone` or `server` -> use **Standalone mode**
- otherwise default to **Tauri dev mode**

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

## Tauri dev mode

1. Stop stale local dev processes for this project:
   ```bash
   pgrep -f "tauri.dev.conf.json" | xargs kill 2>/dev/null
   pgrep -f "target/debug/my-claudia" | xargs kill 2>/dev/null
   lsof -ti:1420 | xargs kill 2>/dev/null
   lsof -ti:3100 | xargs kill 2>/dev/null
   ```

2. Verify ports `1420` and `3100` are free. Retry up to 5 times with 1 second delay. If still occupied, use `kill -9` on the blocking PID and report a warning.

3. Rebuild shared and server before launch:
   ```bash
   cd $PROJECT_ROOT/shared && eval "$(fnm env)" && pnpm build
   cd $PROJECT_ROOT/server && eval "$(fnm env)" && pnpm build
   ```

4. Start Tauri dev in the background:
   ```bash
   cd $PROJECT_ROOT/apps/desktop && eval "$(fnm env)" && pnpm exec tauri dev --config src-tauri/tauri.dev.conf.json 2>&1
   ```

5. Wait up to 30 seconds until `http://localhost:1420` responds. If it never becomes ready, inspect the background output and report the failure.

## Standalone mode

1. Stop stale local processes:
   ```bash
   lsof -ti:3100 | xargs kill -9 2>/dev/null
   lsof -ti:1420 | xargs kill -9 2>/dev/null
   pkill -f "server/dist/index.js" 2>/dev/null
   ```

2. Verify ports `3100` and `1420` are free. Retry up to 5 times with 1 second delay.

3. Rebuild shared and server:
   ```bash
   cd $PROJECT_ROOT/shared && eval "$(fnm env)" && pnpm build
   cd $PROJECT_ROOT/server && eval "$(fnm env)" && pnpm build
   ```

4. Start backend in the background:
   ```bash
   cd $PROJECT_ROOT/server && eval "$(fnm env)" && npx tsx watch src/index.ts
   ```

5. Start frontend in the background:
   ```bash
   cd $PROJECT_ROOT/apps/desktop && eval "$(fnm env)" && pnpm dev
   ```

6. Wait up to 20 seconds until both are ready:
   - backend: `http://localhost:3100/api/sessions`
   - frontend: `http://localhost:1420`

Report:
- chosen mode
- readiness result
- any background task IDs
- any blocking error output if startup failed
