Trigger the unified GitHub Actions release pipeline for all supported platforms.

Usage: /release-all

$PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).

## Steps

1. Verify prerequisites before triggering anything:
   - `gh auth status`
   - `git rev-parse --show-toplevel`
   - `git status --short`

2. If the working tree is dirty, stop and tell the user exactly which files are modified. Do not trigger the workflow unless the user explicitly confirms.

3. Trigger the workflow from the repo root:
   ```bash
   cd $PROJECT_ROOT && gh workflow run release-all-platforms.yml
   ```

4. After triggering, fetch the latest run details:
   ```bash
   cd $PROJECT_ROOT && gh run list --workflow release-all-platforms.yml --limit 1
   ```

5. Report back:
   - whether the workflow was triggered successfully
   - the workflow run ID if available
   - the URL to inspect the run in GitHub

6. Do not wait for the full build unless the user explicitly asks you to watch the run.
