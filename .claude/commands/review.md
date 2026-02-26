Review all uncommitted changes in the working tree.

Steps:
1. Run `git diff` to see unstaged changes and `git diff --cached` to see staged changes
2. Run `git status` to get an overview of modified/added/deleted files
3. For each changed file, review the diff and assess:
   - Correctness: logic errors, off-by-one, null/undefined risks
   - Security: injection, secrets exposure, unsafe input handling
   - Consistency: naming conventions, code style matching the surrounding code
   - Edge cases: error handling, boundary conditions
   - Unnecessary changes: debug code, commented-out code, unrelated modifications
4. Provide a concise summary:
   - List of issues found (if any), grouped by severity (critical / warning / nit)
   - For each issue, reference the file and line, explain the problem, and suggest a fix
   - If no issues found, confirm the changes look good
