Kill any running gateway process, then start gateway in dev mode.

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used. fnm auto-switches via .node-version.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

---

### Step 1: Kill stale gateway process

Run in a single command:
```
pkill -f "gateway/src/index.ts" 2>/dev/null
lsof -ti:3200 | xargs kill -9 2>/dev/null
```

### Step 2: Verify port 3200 is free

Loop up to 5 times (1 second apart) checking `lsof -ti:3200`. If still occupied after 5 attempts, `kill -9` the PID and report a warning.

### Step 3: Ensure shared build is up to date

Check `$PROJECT_ROOT/shared/dist/index.js` exists; if not, run `cd $PROJECT_ROOT/shared && eval "$(fnm env)" && pnpm build`.

### Step 4: Start gateway dev

```
cd $PROJECT_ROOT/gateway && eval "$(fnm env)" && pnpm dev 2>&1
```

Run this as a **background command** with a 10-minute timeout.

### Step 5: Wait and verify

1. Wait in a loop (up to 20 seconds, polling every 3 seconds) until `curl -s http://localhost:3200/health` returns a non-empty response
2. If gateway never responds, check the background task output for errors and report to user
3. Once confirmed running, report the health response (shows backend/client counts)
