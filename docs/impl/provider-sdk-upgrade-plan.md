# Provider SDK Upgrade Plan

Last updated: 2026-03-19

## Scope

This document covers the provider-facing SDKs currently declared in the repo:

- Root `package.json`
  - `@ai-sdk/openai` `^2.0.89`
  - `openai` `^4.87.1`
- `server/package.json`
  - `@anthropic-ai/claude-agent-sdk` `^0.2.72`
  - `@openai/codex-sdk` `^0.113.0`
  - `@opencode-ai/sdk` `^1.2.24`

The goal is to separate:

- packages that are actually on the runtime path
- packages that are test-only or currently unused
- packages that likely need a migration, not just a version bump

## Actual Usage Scan

### Runtime-critical

- `@anthropic-ai/claude-agent-sdk`
  - `server/src/providers/claude-sdk.ts`
  - Also checked by `server/src/utils/sdk-version-check.ts`
- `@openai/codex-sdk`
  - `server/src/providers/codex-sdk.ts`
  - Wrapped by `server/src/providers/codex-adapter.ts`
- `@opencode-ai/sdk`
  - `server/src/providers/opencode-sdk.ts`

### Test-only / non-runtime

- `openai`
  - Used in E2E helpers:
    - `e2e/helpers/browser-adapter.ts`
    - `e2e/helpers/clean-json-openai-client.ts`
  - Also appears in archived test files
- `@ai-sdk/openai`
  - Declared in root `package.json`
  - No active imports found in app/server/shared/gateway source

## Findings

### 1. `@ai-sdk/openai` is not currently used

No active imports were found in the main source tree. This means:

- it should not be treated as a provider runtime upgrade blocker
- it can be upgraded later with very low risk
- it is also a candidate for removal if it is truly dead dependency

### 2. `openai` is currently isolated to E2E helper code

Direct usage is limited to browser automation helper code, not app runtime. This makes it safer than the server-side provider SDKs, but there is one caveat:

- the known official `openai-node` release line has moved well beyond the current declared `4.x` range
- the API surface used here is `new OpenAI(...)` plus `chat.completions.create(...)`
- moving from `4.x` to current `6.x` should be treated as a breaking upgrade

### 3. `@anthropic-ai/claude-agent-sdk` is tightly coupled to provider behavior

`server/src/providers/claude-sdk.ts` depends on several behaviors that are sensitive to SDK changes:

- `query(...)` streaming contract
- `supportedCommands()` shape
- `stopTask()` availability
- session/init event shape
- permission callback behavior
- message transformation assumptions in `transformMessage(...)`

This is a real runtime upgrade, not a cosmetic dependency bump.

### 4. `@openai/codex-sdk` is medium-to-high risk

`server/src/providers/codex-sdk.ts` depends on:

- `new Codex(...)`
- `startThread(...)`
- `resumeThread(...)`
- `runStreamed(...)`
- thread event shapes mapped via `mapThreadEvent(...)`
- policy names like `approvalPolicy` / `sandboxMode`
- injected config for MCP bridge via `config.mcp_servers`

This path is sensitive to SDK event and config changes. It may also need package-level migration review if the upstream package naming or distribution model has shifted.

### 5. `@opencode-ai/sdk` is medium risk

`server/src/providers/opencode-sdk.ts` uses both the SDK client and an external CLI server:

- `createOpencodeClient(...)`
- SDK request/response types
- local `serve` subprocess lifecycle
- health endpoint polling
- MCP injection through SDK client methods

This package is less coupled than the Claude adapter, but still on the main runtime path.

## Upgrade Priority

Recommended execution order:

1. `@opencode-ai/sdk`
2. `@anthropic-ai/claude-agent-sdk`
3. `@openai/codex-sdk`
4. `openai`
5. `@ai-sdk/openai`

Reasoning:

- `@opencode-ai/sdk` has meaningful runtime impact, but the integration is relatively bounded.
- `@anthropic-ai/claude-agent-sdk` is central to a major provider path and has more event-shape risk.
- `@openai/codex-sdk` is also runtime-critical and may need migration analysis in addition to version bumping.
- `openai` is important but currently limited to E2E helper usage.
- `@ai-sdk/openai` is currently unused and can wait.

## Execution Plan

### Phase 0: Pre-upgrade verification

Before changing versions, capture the current baseline:

- run provider unit tests:
  - `server/src/providers/__tests__/claude-sdk.test.ts`
  - `server/src/providers/__tests__/codex-sdk.test.ts`
  - `server/src/providers/__tests__/opencode-sdk.test.ts`
- run SDK version check tests:
  - `server/src/utils/__tests__/sdk-version-check.test.ts`
- run E2E helpers tests if they exist for the OpenAI browser adapter path

Also refresh latest published versions from upstream at execution time. Do not rely on this document alone for exact target versions.

### Phase 1: Upgrade `@opencode-ai/sdk`

Files to inspect during upgrade:

- `server/src/providers/opencode-sdk.ts`
- `server/src/providers/__tests__/opencode-sdk.test.ts`

Validation focus:

- `createOpencodeClient(...)` initialization
- session lifecycle
- SSE/event type compatibility
- MCP add/list interactions
- local server startup and `/global/health` probe

Expected work:

- direct version bump
- small adapter fixes if request/response types changed

### Phase 2: Upgrade `@anthropic-ai/claude-agent-sdk`

Files to inspect during upgrade:

- `server/src/providers/claude-sdk.ts`
- `server/src/providers/__tests__/claude-sdk.test.ts`
- `server/src/utils/sdk-version-check.ts`

Validation focus:

- `query(...)` invocation options
- `supportedCommands()` return shape
- `stopTask()` behavior
- permission callback contract
- message/event transformation
- SDK/CLI compatibility warning logic

Expected work:

- version bump
- adapter changes in `transformMessage(...)`
- possible updates to compatibility warning logic

### Phase 3: Upgrade `@openai/codex-sdk`

Files to inspect during upgrade:

- `server/src/providers/codex-sdk.ts`
- `server/src/providers/codex-adapter.ts`
- `server/src/providers/__tests__/codex-sdk.test.ts`

Validation focus:

- `Codex` constructor options
- thread start/resume API
- streamed event iteration
- approval/sandbox policy names
- MCP bridge config injection
- abort handling

Expected work:

- version bump or package migration
- event mapping updates
- possible config key changes

### Phase 4: Upgrade `openai`

Files to inspect during upgrade:

- `e2e/helpers/browser-adapter.ts`
- `e2e/helpers/clean-json-openai-client.ts`
- `e2e/archived/test-direct-api.spec.ts`

Validation focus:

- `new OpenAI({ baseURL, apiKey })`
- `chat.completions.create(...)`
- response usage fields accessed by the Stagehand adapter

Expected work:

- likely breaking upgrade from `4.x` to current official line
- may require helper-level API adjustments

### Phase 5: Resolve `@ai-sdk/openai`

Options:

- if intentionally unused: remove it
- if planned for near-term use: upgrade it after the runtime provider work is complete

There is no value in prioritizing this package before the active runtime SDKs.

## Suggested PR Split

### PR 1

- version refresh audit
- upgrade `@opencode-ai/sdk`
- adapter/test fixes

### PR 2

- upgrade `@anthropic-ai/claude-agent-sdk`
- adapter/test fixes

### PR 3

- upgrade or migrate `@openai/codex-sdk`
- adapter/test fixes

### PR 4

- upgrade `openai` in E2E helpers
- decide whether to keep or remove `@ai-sdk/openai`

## Risks To Watch

- upstream SDKs changing streaming event shapes
- renamed approval/sandbox options
- changes in session resume semantics
- MCP API shape drift
- provider CLI / SDK version skew
- hidden dependency on older response usage field names

## Recommended Next Step

Start with a narrow implementation PR for `@opencode-ai/sdk`, then run provider tests before touching Claude or Codex.
