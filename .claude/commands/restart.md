Kill any running server process on port 3100, then restart the dev server.

Steps:
1. Run `lsof -ti:3100 | xargs kill -9 2>/dev/null` to kill any existing process on port 3100
2. Start the server in the background with `cd /Users/haozhang/SourceCode/zhvala/my-claudia/server && tsx watch src/index.ts`
3. Wait a few seconds, then verify the server is running by checking `curl -s http://localhost:3100/api/health` or similar
4. Report the result to the user
