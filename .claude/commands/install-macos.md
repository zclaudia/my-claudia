Build, install to /Applications, and relaunch MyClaudia.

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

### Step 1: Preflight check

Verify we're on macOS (`uname` = Darwin). If not, abort.

### Step 2: Run the install script

```
cd $PROJECT_ROOT && eval "$(fnm env)" && bash scripts/install-macos.sh 2>&1
```

This script handles: build → close running app → copy to /Applications → relaunch.

Run this as a **foreground command** with a **10-minute timeout**.

### Step 3: Report result

- On success: report the version and confirm app is running
- On failure: show the relevant error output
