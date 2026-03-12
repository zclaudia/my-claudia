Kill any stale gateway dev process, then start the gateway in dev mode.

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

## Steps

1. Stop stale gateway processes:
   ```bash
   pkill -f "gateway/src/index.ts" 2>/dev/null
   lsof -ti:3200 | xargs kill -9 2>/dev/null
   ```

2. Verify port `3200` is free. Retry up to 5 times with 1 second delay. If it is still occupied, force-kill the blocking PID and report a warning.

3. Ensure shared output exists. If `$PROJECT_ROOT/shared/dist/index.js` is missing, build shared first:
   ```bash
   cd $PROJECT_ROOT/shared && eval "$(fnm env)" && pnpm build
   ```

4. Start gateway dev in the background:
   ```bash
   cd $PROJECT_ROOT/gateway && eval "$(fnm env)" && pnpm dev 2>&1
   ```

5. Wait up to 20 seconds until `http://localhost:3200/health` responds. If it never becomes ready, inspect the background output and report the failure.

Report:
- whether the gateway became healthy
- the health response if available
- any background task ID
- any startup error output if it failed
