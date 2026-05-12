# Provider Mode Normalization Plan

## Background

MyClaudia currently passes a single `mode` string from the desktop UI through the server runtime into each provider adapter. That string is overloaded:

- Claude treats it as a permission mode: `default`, `plan`, `acceptEdits`, `bypassPermissions`.
- Cursor treats `default` as Agent mode, while its native CLI also has explicit `plan` and `ask` modes.
- OpenCode treats mode as an agent name, for example `sisyphus`, `prometheus`, or `build`.
- Kimi treats mode as CLI behavior, currently including `default`, `plan`, and `ask`.
- Codex maps mode to sandbox and approval behavior.

This creates fragile logic when shared runtime code compares raw strings such as `mode !== 'default'` or `mode === 'plan'`. A concrete bug was Cursor sessions starting as new provider chats every run because the runtime treated any non-`default` mode as requiring a new provider session, even though `cursor-agent --resume <chatId> --mode=ask|plan` is valid and should preserve context.

## Goals

- Stop shared runtime code from using raw provider/UI mode strings for behavioral decisions.
- Make provider-specific mode semantics explicit in provider manifests or a single resolver.
- Preserve existing safety behavior for Claude unless deliberately changed.
- Make Cursor follow-up turns reuse the same provider chat in Agent, Ask, and Plan modes.
- Prevent frontend mode state from leaking across provider capability changes.

## Non-Goals

- Do not redesign the full provider capability protocol.
- Do not rename existing user-facing mode IDs in one large migration.
- Do not remove backward compatibility for `permissionMode`.
- Do not change provider CLI behavior without tests or targeted verification.

## Current Risk Points

### `run-bootstrap.ts`

Current shared logic checks whether a mode is non-default:

```ts
requestedMode && requestedMode !== 'default' && session.sdk_session_id
```

This is unsafe because `default` is not a universal provider concept. For OpenCode, the default may be an agent name like `sisyphus`. For Cursor, Agent mode is represented in UI as `default`, while Cursor's own tool transition may use `agent` and then normalize it back to `default`.

### `run-context.ts`

Current logic checks plan mode using:

```ts
modeValue === 'plan'
```

This works only when the caller uses the legacy `plan` string. If the runtime later receives PCP-style `plan_only` or a provider-specific plan alias, this path will not trigger.

### `run-events.ts`

Current AI-initiated plan-mode detection checks:

```ts
modeValue !== 'plan'
```

This has the same raw-string issue. It should ask whether the run was already in canonical plan mode, not compare a transport string.

### `useProviderCapabilities.ts`

The frontend only initializes a session mode when the current mode is empty:

```ts
if (caps.defaultModeId && !useChatStore.getState().getMode(sessionId)) {
  useChatStore.getState().setMode(sessionId, caps.defaultModeId);
}
```

If the provider changes and the old mode is not valid for the new provider, the UI may display a fallback option while the next `run_start` still sends the stale mode.

## Proposed Design

Introduce a single provider-aware mode resolver. The runtime should resolve the requested mode once per run and pass structured results downstream.

```ts
export interface ResolvedRunMode {
  requestedMode: string;
  nativeMode: string;
  defaultNativeMode: string;
  canonicalMode?: 'supervised' | 'auto_edit' | 'autonomous' | 'plan_only';
  isDefaultMode: boolean;
  isPlanMode: boolean;
  modeSwitchSessionPolicy: 'reset' | 'preserve';
}
```

Suggested helper:

```ts
resolveRunMode({
  manifest,
  requestedMode,
  fallbackMode: 'default',
}): ResolvedRunMode
```

Responsibilities:

- Normalize legacy modes through `normalizePermissionMode()`.
- Map canonical modes to provider-native modes through `mapPermissionMode()`.
- Compute provider-native default mode.
- Decide whether the current mode is default-equivalent.
- Decide whether the current mode is plan-equivalent.
- Read provider session behavior from `manifest.modeSwitchSessionPolicy`.

## Manifest Extensions

The already-added policy should remain provider-owned:

```ts
modeSwitchSessionPolicy?: 'reset' | 'preserve';
```

Default behavior should be `reset` to preserve the original Claude-safe behavior.

Initial recommended provider policies:

| Provider | Policy | Reason |
| --- | --- | --- |
| Claude | `reset` | Existing behavior protects permission-mode changes on resumed Claude sessions. |
| Cursor | `preserve` | `cursor-agent` supports `--resume` with `--mode=plan/ask`; preserving chat context is required. |
| Codex | `preserve` candidate | Codex adapters already pass mode/config on resumed threads; verify before enabling. |
| OpenCode | `preserve` candidate | Mode is an agent selector, not a permission mode; verify agent switching on existing session. |
| Kimi | `reset` until verified | Kimi is work-dir scoped and currently has special cwd policy; avoid changing session semantics blindly. |

If a provider needs more control later, replace the enum with a provider callback or richer manifest rule:

```ts
modeSwitchSessionPolicy?: 'reset' | 'preserve' | 'reset_on_permission_change';
```

## Runtime Changes

### Run Bootstrap

Replace raw mode comparison:

```ts
requestedMode !== 'default'
```

with:

```ts
!resolvedMode.isDefaultMode
```

Then apply session policy:

```ts
const modeRequiresNewSession =
  session.sdk_session_id
  && !resolvedMode.isDefaultMode
  && resolvedMode.modeSwitchSessionPolicy === 'reset';
```

### Run Context

Compute `nativeMode` from the resolved mode instead of recomputing:

```ts
runOptions.mode = resolvedMode.nativeMode;
```

Replace plan prompt logic:

```ts
modeValue === 'plan'
```

with:

```ts
resolvedMode.isPlanMode
```

### Run Events

Replace AI-entered-plan detection:

```ts
if (modeValue !== 'plan') {
  activeRun.aiInitiatedPlanMode = true;
}
```

with:

```ts
if (!resolvedMode.isPlanMode) {
  activeRun.aiInitiatedPlanMode = true;
}
```

If passing the full `ResolvedRunMode` through every event handler is too large for the first patch, pass only `isPlanMode` alongside `modeValue`.

## Frontend Changes

When provider capabilities load, reset invalid stale modes:

```ts
const currentMode = useChatStore.getState().getMode(sessionId);
const modeIsValid = caps.modes.some((mode) => mode.id === currentMode);

if (caps.defaultModeId && (!currentMode || !modeIsValid)) {
  useChatStore.getState().setMode(sessionId, caps.defaultModeId);
}
```

This prevents a session from carrying `plan`, `default`, or an OpenCode agent name into a provider where that mode is not valid.

## Migration Steps

1. Add `resolveRunMode()` and focused unit tests.
2. Update `run-bootstrap.ts` to use `ResolvedRunMode` for session reset decisions.
3. Update `run-context.ts` to use `ResolvedRunMode.nativeMode` and `isPlanMode`.
4. Update `run-events.ts` to use `isPlanMode` for AI-initiated plan detection.
5. Update `useProviderCapabilities.ts` to clear invalid stale mode values.
6. Add provider-specific tests for Cursor, Claude, and at least one provider with a non-`default` default mode.
7. Optionally verify Codex/OpenCode manually before switching them to `preserve`.

## Test Plan

### Unit Tests

- Cursor `ask` mode with existing `sdk_session_id` preserves provider session.
- Cursor `plan` mode with existing `sdk_session_id` preserves provider session.
- Claude `plan` mode with existing `sdk_session_id` resets provider session.
- A provider whose default mode is not `default` is treated as default-equivalent after normalization.
- `plan` and `plan_only` are both treated as plan-equivalent where supported.
- Frontend resets an invalid stale mode when provider capabilities change.

### Integration Checks

- Start a Cursor session, ask it to remember a value, then ask a follow-up in Ask mode. It should answer from the same provider chat.
- Repeat in Plan mode.
- Switch back to Agent mode and confirm the same provider chat is still resumed.
- Run Claude in default and plan mode to confirm the previous reset behavior remains intact.

## Rollout Notes

- Keep logging the raw requested mode and resolved native mode during rollout:

```ts
console.log(`[Mode] requested=${requestedMode} native=${nativeMode} default=${isDefaultMode} policy=${modeSwitchSessionPolicy}`);
```

- Do not silently rewrite user-facing mode labels. Keep UI labels provider-specific.
- Treat `agent === default` only inside Cursor normalization if needed. Do not make it a global alias, because OpenCode uses real agent names.

## Open Questions

- Should Codex preserve provider sessions across `plan/default/bypassPermissions` transitions by default?
- Does OpenCode allow switching agents on an existing session without surprising context behavior?
- Should PCP expose a first-class `defaultModeAlias` or keep this in each provider's capability response?
