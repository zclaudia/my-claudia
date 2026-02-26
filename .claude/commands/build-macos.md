Build the macOS desktop app (DMG + app bundle).

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

### Step 1: Preflight check

Verify we're on macOS (`uname` = Darwin). If not, abort.

### Step 2: Run the build script

```
cd $PROJECT_ROOT && eval "$(fnm env)" && bash scripts/build-macos.sh 2>&1
```

This script handles everything:
- Version bump (git-tag based: new commits → bump, dirty tree → dev suffix, no changes → reuse)
- Builds shared + server + server bundle
- Cleans stale DMG artifacts from previous builds
- Runs `tauri build` for macOS
- Renames output DMG with version and arch

Run this as a **foreground command** with a **10-minute timeout** (build takes a while).

### Step 3: Report result

- On success: report the version, DMG path, and file size
- On failure: show the relevant error output
