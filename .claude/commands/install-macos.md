Build, install to /Applications, and relaunch MyClaudia.

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

## Steps

1. Verify we're on macOS (`uname` = Darwin). If not, abort.

2. Run the install script:
   ```bash
   cd $PROJECT_ROOT && eval "$(fnm env)" && bash scripts/build/install-macos.sh 2>&1
   ```

3. Report:
   - version if available
   - whether the app was relaunched successfully
   - relevant error output if the install failed
