Build the Windows desktop installers.

**IMPORTANT**: Always prefix Node.js commands with `eval "$(fnm env)"` to ensure the correct Node version is used when invoking Node-based tools.

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

## Steps

1. Verify the environment is Windows. If not, abort and explain that the command must run on a Windows machine or runner.

2. Run the build script from the repo root:
   ```powershell
   cd $PROJECT_ROOT; .\scripts\build\windows.ps1 2>&1
   ```

3. Report:
   - generated `.msi` and `.exe` installer paths
   - file sizes if available
   - any Visual Studio Build Tools / Rust / Tauri build failure if it failed
