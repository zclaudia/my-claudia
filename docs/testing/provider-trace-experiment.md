# Provider Trace Experiment Guide

## Goal

Run real sessions against the local dev backend, capture provider message streams for `opencode`, `kimi`, `claude`, and `codex`, and decide whether the provider implementations or the server-side normalization layer have protocol bugs.

This guide is intended to be executable by another AI agent or engineer without extra context.

## Relevant Code

- Trace utility: `server/src/utils/provider-trace.ts`
- Server-side normalization trace: `server/src/server.ts`
- OpenCode raw provider trace: `server/src/providers/opencode-sdk.ts`
- Kimi raw provider trace: `server/src/providers/kimi-sdk.ts`
- Session trace script: `server/scripts/trace-provider-session.ts`
- Script entrypoint: `server/package.json` -> `trace:provider`

At the moment:

- `opencode` and `kimi` have dedicated `provider_raw` trace points
- `claude` and `codex` are still observable through `server_provider` and `server_norm`

## Expected Outputs

Each test run should produce:

- A WebSocket message stream file: `*.jsonl`
- A summary file: `*.summary.json`
- Server-side provider trace files under `/tmp/my-claudia-provider-traces/<date>/`

## Preconditions

Before running the experiment, confirm:

- Dependencies are installed
- The machine can listen on `127.0.0.1`
- `opencode` CLI is installed and usable
- `kimi` CLI is installed and usable
- `claude` CLI is installed and usable if Claude is included in the matrix
- `codex` CLI or SDK path is installed and usable if Codex is included in the matrix
- The local database already contains:
  - at least one project
  - provider configuration for every provider under test

If the default app data directory is readonly or should not be mutated, use a copied writable directory under `/tmp`.

## Step 1: Prepare a Writable Data Directory

If needed, copy the existing app data directory:

```bash
TRACE_DATA_DIR="/tmp/my-claudia-trace-data-$(date +%s)"
mkdir -p "$TRACE_DATA_DIR"
cp -R "$HOME/Library/Application Support/com.myClaudia.desktop"/. "$TRACE_DATA_DIR"/
echo "$TRACE_DATA_DIR"
```

If the default app data directory is already writable and safe to use, this step can be skipped.

## Step 2: Start the Backend with Trace Enabled

From the repository root:

```bash
cd /Users/zhvala/SourceCode/my-claudia

MY_CLAUDIA_DATA_DIR="$TRACE_DATA_DIR" \
MY_CLAUDIA_PROVIDER_TRACE=1 \
MY_CLAUDIA_PROVIDER_TRACE_DIR=/tmp/my-claudia-provider-traces \
pnpm --filter @my-claudia/server run dev
```

If `tsx watch` is problematic in the environment, compile first and then run Node directly:

```bash
cd /Users/zhvala/SourceCode/my-claudia
pnpm --filter @my-claudia/server run build

MY_CLAUDIA_DATA_DIR="$TRACE_DATA_DIR" \
MY_CLAUDIA_PROVIDER_TRACE=1 \
MY_CLAUDIA_PROVIDER_TRACE_DIR=/tmp/my-claudia-provider-traces \
node server/dist/index.js
```

## Step 3: Verify the Backend is Up

In a second terminal:

```bash
curl -s http://127.0.0.1:3001/api/server/info
```

Expected result:

- JSON response is returned
- No startup error is visible in the server terminal
- If the server chose a different port, use that actual port in all later commands

## Step 4: Get a Project ID

If the project ID is unknown:

```bash
curl -s http://127.0.0.1:3001/api/projects | jq
```

Optional provider inspection:

```bash
curl -s http://127.0.0.1:3001/api/providers | jq
```

Record:

- a valid `projectId`
- whether `opencode` exists
- whether `kimi` exists
- whether `claude` exists
- whether `codex` exists

## Step 5: Prepare Test Prompts

Run the same prompt set against all providers under test.

### Prompt A: Plain Text

```text
Reply with exactly three short bullet points describing this repository.
```

### Prompt B: Single Tool

```text
List the files in the current directory and summarize what looks important.
```

### Prompt C: Multi Tool

```text
Read package.json and server/package.json, then compare their scripts and summarize the differences.
```

### Prompt D: Error Path

```text
Read /path/that/does/not/exist and explain what happened.
```

### Optional Prompt E: Long Output

```text
Write a detailed summary of the repository structure in at least 12 short paragraphs.
```

### Prompt F: System Info or Status

```text
/status
```

This is especially useful for `claude` and `codex`, where provider-specific init and status behavior is often exposed through system metadata.

### Recommended Provider Matrix

Run at least:

- `opencode`: Prompts A, B, C, D
- `kimi`: Prompts A, B, C, D
- `claude`: Prompts A, B, C, D, F
- `codex`: Prompts A, B, C, D, F

## Step 6: Run OpenCode Trace Sessions

Example:

```bash
pnpm --filter @my-claudia/server run trace:provider -- \
  --api http://127.0.0.1:3001 \
  --projectId <PROJECT_ID> \
  --providerType opencode \
  --cwd /absolute/path/to/worktree \
  --prompt "List the files in the current directory and summarize what looks important." \
  --out /tmp/opencode-single-tool.jsonl
```

Run one file per scenario, for example:

- `/tmp/opencode-plain.jsonl`
- `/tmp/opencode-single-tool.jsonl`
- `/tmp/opencode-multi-tool.jsonl`
- `/tmp/opencode-error.jsonl`

## Step 7: Run Kimi Trace Sessions

Example:

```bash
pnpm --filter @my-claudia/server run trace:provider -- \
  --api http://127.0.0.1:3001 \
  --projectId <PROJECT_ID> \
  --providerType kimi \
  --cwd /absolute/path/to/worktree \
  --prompt "List the files in the current directory and summarize what looks important." \
  --out /tmp/kimi-single-tool.jsonl
```

Run the same prompt matrix as used for OpenCode.

## Step 8: Run Claude Trace Sessions

Example:

```bash
pnpm --filter @my-claudia/server run trace:provider -- \
  --api http://127.0.0.1:3001 \
  --projectId <PROJECT_ID> \
  --providerType claude \
  --cwd /absolute/path/to/worktree \
  --prompt "/status" \
  --out /tmp/claude-status.jsonl
```

Recommended outputs:

- `/tmp/claude-plain.jsonl`
- `/tmp/claude-single-tool.jsonl`
- `/tmp/claude-multi-tool.jsonl`
- `/tmp/claude-error.jsonl`
- `/tmp/claude-status.jsonl`

## Step 9: Run Codex Trace Sessions

Example:

```bash
pnpm --filter @my-claudia/server run trace:provider -- \
  --api http://127.0.0.1:3001 \
  --projectId <PROJECT_ID> \
  --providerType codex \
  --cwd /absolute/path/to/worktree \
  --prompt "/status" \
  --out /tmp/codex-status.jsonl
```

Recommended outputs:

- `/tmp/codex-plain.jsonl`
- `/tmp/codex-single-tool.jsonl`
- `/tmp/codex-multi-tool.jsonl`
- `/tmp/codex-error.jsonl`
- `/tmp/codex-status.jsonl`

## Step 10: Collect Artifacts

Collect all of the following:

- Script outputs:
  - `*.jsonl`
  - `*.summary.json`
- Server-side trace directory:
  - `/tmp/my-claudia-provider-traces/<date>/*.jsonl`

These files should contain events from:

- `provider_raw`
- `server_provider`
- `server_norm`
- `script_ws`

## Step 11: Analyze the Message Streams

For each run, verify the following.

### 1. Lifecycle Order

Expected general shape:

- `run_started`
- optional `system_info`
- zero or more `delta`
- zero or more `tool_use`
- zero or more `tool_result`
- final `run_completed` or `run_failed`

Invalid outcomes:

- both `run_completed` and `run_failed`
- no terminal event

### 2. Identifier Stability

Check:

- `runId` stays stable for the whole run
- `sessionId` stays stable for the whole run
- `tool_result.toolUseId` matches a previous `tool_use.toolUseId`

### 3. Tool Pairing

Check:

- every `tool_use` eventually gets a `tool_result`
- no orphan `tool_result`
- missing `tool_result` is only acceptable when a run was interrupted or failed in a clearly explained way

### 4. System Info

Check:

- whether `system_info` appears
- whether fields like `model`, `cwd`, `agents` look reasonable
- whether provider trace and server trace agree about initialization metadata

### 5. Content Streaming

Check:

- `delta` chunks concatenate into coherent visible output
- no obvious repeated chunks
- no silent gaps
- no runs that only produce tool events and no user-visible completion text unless a fallback is intentionally emitted

### 6. Error Path

Check:

- provider errors become stable `run_failed` events
- error text is visible and interpretable
- no provider-side error that disappears before reaching `server_norm` or `script_ws`

## Acceptance Criteria

The provider implementation is considered healthy if all of the following are true:

- every run ends with exactly one terminal event
- `runId` and `sessionId` remain stable
- all tool results are correctly paired
- `delta` ordering is coherent
- `provider_raw`, `server_provider`, and `server_norm` show the same logical event flow
- `opencode`, `kimi`, `claude`, and `codex` may differ in detail, but all satisfy the same lifecycle contract

The implementation is considered suspicious or failing if any of the following happen:

- no terminal event is emitted
- `runId` or `sessionId` drifts during one run
- `tool_result` appears without a prior `tool_use`
- `system_info` is missing or malformed in a way that breaks expectations
- `provider_raw` shows events that never appear in `server_norm`
- `server_norm` emits events that never arrive in `script_ws`
- tool-only runs end with no visible assistant text and no deliberate fallback

## Required Final Report

Produce a report with these sections.

### 1. OpenCode Results

Include:

- pass/fail per scenario
- observed issues
- trace file paths
- whether the issue appears to originate in `provider_raw`, `server_provider`, or `server_norm`

### 2. Kimi Results

Include the same structure as OpenCode.

### 3. Claude Results

Include the same structure as OpenCode.

### 4. Codex Results

Include the same structure as OpenCode.

### 5. Cross-Provider Comparison

Include:

- lifecycle differences
- acceptable differences vs protocol-breaking differences
- any frontend-relevant compatibility risks

### 6. Fix Recommendations

Include:

- recommendations ordered by severity
- concrete target files when possible

## Notes

- The script currently assumes a local direct WebSocket connection and sends a plain `auth` message.
- The script writes the exact WebSocket stream it receives, not reconstructed UI state.
- If the server does not run on `3001`, replace the port in all commands.
