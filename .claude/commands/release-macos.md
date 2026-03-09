Build and publish the macOS desktop app to GitHub Releases (draft).

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

### Step 1: Preflight check

Verify we're on macOS (`uname` = Darwin). If not, abort.

### Step 2: Run the release script

```
cd $PROJECT_ROOT && eval "$(fnm env)" && bash scripts/release-macos.sh 2>&1
```

This wraps `build-macos.sh` with `RELEASE=1`, which:
- Builds the app (version bump, shared + server + bundle, tauri build, DMG)
- Signs the app and generates update artifacts (.tar.gz + .sig + latest.json)
- Creates a **draft** GitHub Release on the configured `RELEASE_REMOTE` and uploads artifacts

Run this as a **foreground command** with a **10-minute timeout** (build takes a while).

### Step 3: Report result

- On success: report the version, DMG path, file size, and GitHub Release URL
- On failure: show the relevant error output
