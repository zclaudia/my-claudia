Build and publish the macOS desktop app to GitHub Releases (draft).

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

## Steps

1. Verify we're on macOS (`uname` = Darwin). If not, abort.

2. Run the release script:
   ```bash
   cd $PROJECT_ROOT && eval "$(fnm env)" && bash scripts/release/macos.sh 2>&1
   ```

3. Report:
   - version
   - DMG path
   - file size
   - GitHub Release URL if available
   - relevant error output if the release failed
