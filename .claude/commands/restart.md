Kill any running dev processes, then restart both the server and frontend.

Steps:
1. Run `lsof -ti:3100 | xargs kill -9 2>/dev/null` to kill any existing server on port 3100
2. Run `lsof -ti:1420 | xargs kill -9 2>/dev/null` to kill any existing frontend dev server on port 1420
3. Start the backend server in the background with `cd $PROJECT_ROOT/server && npx tsx watch src/index.ts`
4. Start the frontend dev server in the background with `cd $PROJECT_ROOT/apps/desktop && pnpm dev`
5. Wait a few seconds, then verify both are running:
   - Backend: `curl -s http://localhost:3100/api/sessions | head -c 50`
   - Frontend: `curl -s http://localhost:1420 | head -c 50`
6. Report the result to the user

Note: $PROJECT_ROOT is the git repository root directory (use `git rev-parse --show-toplevel` to find it).
