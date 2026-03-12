Build the Linux desktop packages.

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

## Steps

1. Verify the environment is Linux. If not, abort and explain that the command must run on a Linux machine or runner.

2. Run the build script from the repo root:
   ```bash
   cd $PROJECT_ROOT && eval "$(fnm env)" && bash scripts/build/linux.sh 2>&1
   ```

3. Report:
   - package paths for `.deb` and `.rpm`
   - file sizes if available
   - any missing system dependency error if the build failed
