# PlanDecisionCard — Unified Plan Approval UI

**Date:** 2026-05-20
**Status:** Draft (pending implementation)
**Scope:** `apps/desktop/` — Cursor `createPlan` + Claude `ExitPlanMode` plan approval UX

## Problem

Cursor's `createPlan` tool currently renders as an ordinary collapsible tool-call card. The plan is hidden behind a "Show full plan" toggle, and the only action surfaced is a single "Execute plan" button buried inside the expanded content. Compared to Claude's `ExitPlanMode` — which renders a prominent decision card with Allow / Deny / Deny+Comment buttons and a comment textarea — Cursor's experience is visually understated and lacks a rejection path.

The two flows differ structurally:

- **Claude `ExitPlanMode`**: blocks on a server-side permission gate. The client receives a `PermissionRequest`, renders `InlinePermissionRequest`, and the user's decision resolves the gate via a callback. Tool execution is genuinely paused.
- **Cursor `createPlan`**: cannot block. cursor-agent is an external CLI process that completes the tool synchronously and emits `tool_call:completed`. From cursor's perspective the plan is "done"; cursor then waits for the next user message because the session is still in plan mode.

This means a unified UX cannot be achieved through a unified backend gate — we need a shared visual component driven by two different decision-resolution paths.

## Goal

Cursor's `createPlan` and Claude's `ExitPlanMode` render through one shared `PlanDecisionCard` component, with identical visual treatment (auto-expanded plan, prominent buttons, comment textarea, compact resolved chip). The two providers reach the same component via different paths:

- **Claude path** — driven by the existing server-side permission system, unchanged on the wire.
- **Cursor path** — resolved entirely on the client, using natural conversation-level "blocking" (cursor is already waiting for the next user message after `createPlan` completes).

## Non-goals

- No server-side blocking of cursor-agent (architecturally impossible without a wrapping proxy; not worth building).
- No new persistence layer — client-side decision state is per-session, derived from existing data where possible.
- No i18n in v1 (default messages are English constants, matching the existing `EXECUTE_PLAN_PREFILL`).
- No support for AI review / risk analysis on plan decisions (Claude's plan path doesn't use this; out of scope).
- No timeout on the Cursor path (cursor has no timeout concept here).

## Architecture

```
                         ┌──────────────────────────┐
                         │   PlanDecisionCard       │
                         │   (presentational only)  │
                         │   props: planContent,    │
                         │          state,          │
                         │          resolution,     │
                         │          onAllow,        │
                         │          onDeny,         │
                         │          onDenyWith-     │
                         │            Comment       │
                         └──────────┬───────────────┘
                                    │
                ┌───────────────────┴─────────────────┐
                │                                     │
   ┌────────────▼─────────────┐         ┌─────────────▼──────────────┐
   │ Claude path              │         │ Cursor path                │
   │ (server-driven)          │         │ (client-driven)            │
   ├──────────────────────────┤         ├────────────────────────────┤
   │ InlinePermissionRequest  │         │ CursorPlanDecision (thin   │
   │   wraps PlanDecisionCard │         │ shell) inside MessageList  │
   │   for plan-proposal      │         │   reads chatStore +        │
   │   requests; passes       │         │   derives state            │
   │   onDecision callbacks   │         │   handlers fire            │
   │   to server permission   │         │   sendMessage + setMode +  │
   │   gate                   │         │   setPlanDecision          │
   │ State: permissionStore + │         │ State: chatStore           │
   │   local useState         │         │   .toolCalls[id]           │
   │                          │         │   .planDecision +          │
   │                          │         │   derived from messages    │
   └──────────────────────────┘         └────────────────────────────┘
```

**Invariants**:

- `PlanDecisionCard` is fully controlled — it does not own resolved/active state, callers pass it via `state` prop.
- Claude's permission protocol is unchanged on the wire — server still holds `ExitPlanMode`.
- Cursor decisions are client-only — server has no knowledge of them.
- Routing for which path renders is driven by session provider (`cursor` → client path, `claude` / others → server permission path). See §Cursor path / Routing for the rationale and future extensibility.

## Component: PlanDecisionCard

`apps/desktop/src/features/chat/PlanDecisionCard.tsx` — new file. Presentational (no global store access), but allowed to hold UI-only `useState` for textarea text and the long-plan expand toggle.

### Props

```ts
type PlanDecisionState = 'active' | 'resolved' | 'superseded';

interface PlanResolution {
  decision: 'allow' | 'deny';
  comment?: string;
}

interface PlanDecisionCardProps {
  planContent: string;                                    // markdown
  toolName?: string;                                      // header label
  state: PlanDecisionState;
  resolution?: PlanResolution;                            // required when state === 'resolved'
  onAllow: () => void;
  onDeny: () => void;
  onDenyWithComment: (comment: string) => void;
  origin?: 'permission' | 'client';                       // optional badge
}
```

### Visual states

1. **active** — main form. `border-l-4 border-warning`, plan content auto-expanded (reusing `PlanContent` markdown rendering and its `PLAN_PREVIEW_LINES` collapse), comment textarea (`placeholder="Why should we revise this plan?"`), and three buttons in order:
   - `[Deny]` — secondary
   - `[Deny + Comment]` — secondary, disabled when textarea empty
   - `[Allow]` — primary

2. **resolved** — single-row chip. Decision icon (`√` or `×`) + `toolName` + `Approved` / `Denied: <comment first 60 chars…>`. Background `bg-secondary/30`, smaller font.

3. **superseded** — same shape as resolved, but text `Plan superseded` with no decision icon. Used when the user moved past the plan without an explicit button click.

### Internal state

- Comment textarea text is held in component-local `useState` (UI-only ephemeral state). Cleared on Allow click to prevent stale comment carryover.
- Long plan collapse state (`isFullyExpanded`) reuses the existing pattern from `tool-call/PlanContent.tsx`.

### Keyboard

- Active + textarea focused: `Cmd/Ctrl+Enter` triggers Deny+Comment (when non-empty).
- Allow / Deny have no global hotkeys to avoid misfires.

### Excluded features

- No "Remember" checkbox (no semantics for plan).
- No timeout progress bar.
- No AI review / workflow progress hint.
- No credential input.

## chatStore changes

`apps/desktop/src/stores/chatStore.ts`:

```ts
// Extend ToolCallState
interface ToolCallState {
  // ...existing fields
  planDecision?: {
    decision: 'allow' | 'deny';
    comment?: string;
    resolvedAt: number;  // epoch ms
  };
}

// New action
setPlanDecision(
  sessionId: string,
  toolUseId: string,
  decision: { decision: 'allow' | 'deny'; comment?: string; resolvedAt: number },
): void;
```

`planDecision` is client-only and **not** persisted to server SQLite. Session reload derives the "moved past" state from the message timeline (see below).

## Cursor path

### Routing

In `MessageList` / `ChatMessagePane` render loop, after a tool-use message:

```tsx
const provider = useSessionProvider(sessionId);  // 'cursor' | 'claude' | 'codex' | ...
const usesClientResolvedPlan = provider === 'cursor';

{msg.type === 'tool_use'
  && msg.toolSemantic === 'plan_proposal'
  && msg.status === 'completed'
  && usesClientResolvedPlan
  && <CursorPlanDecision sessionId={sessionId} toolUseId={msg.toolUseId} />}
```

The provider check is the most reliable signal: Cursor's `createPlan` never goes through a permission gate, while Claude's `ExitPlanMode` always does. We cannot use `PermissionRequest` matching because:
1. `PermissionRequest` does not carry `toolUseId` in the current protocol (only `requestId`, `sessionId`, `toolName`).
2. PermissionRequests are cleared after resolution, so we can't tell historically whether a now-`completed` tool went through one.

Providers that introduce a future client-resolved plan tool can be added to the `usesClientResolvedPlan` allowlist alongside `cursor`. Claude (`ExitPlanMode`) continues to render through `InlinePermissionRequest` for as long as the plan PermissionRequest is active; once resolved, neither card renders for that tool (the `tool-call` card alone remains in the message stream, showing the plan content for reference).

### `CursorPlanDecision` shell

Thin wrapper component that wires up the hooks:

```tsx
function CursorPlanDecision({ sessionId, toolUseId }: Props) {
  const { state, resolution, planContent, toolName } = usePlanDecisionState(sessionId, toolUseId);
  const handlers = usePlanDecisionHandlers(sessionId, toolUseId);
  return (
    <PlanDecisionCard
      planContent={planContent}
      toolName={toolName}
      state={state}
      resolution={resolution}
      origin="client"
      {...handlers}
    />
  );
}
```

### `usePlanDecisionState`

Selector hook deriving `state` from chatStore:

```ts
function usePlanDecisionState(sessionId: string, toolUseId: string): {
  state: PlanDecisionState;
  resolution?: PlanResolution;
  planContent: string;
  toolName: string;
} {
  return useChatStore((s) => {
    const tc = s.toolCalls[sessionId]?.[toolUseId];
    const planContent = extractPlanContent(tc?.toolInput);
    const toolName = tc?.toolName ?? 'createPlan';

    // 1. explicit resolution
    if (tc?.planDecision) {
      return {
        state: 'resolved',
        resolution: { decision: tc.planDecision.decision, comment: tc.planDecision.comment },
        planContent,
        toolName,
      };
    }

    // 2. mode left plan
    const mode = s.modeOverrides[sessionId] || s.runtimeModes[sessionId];
    if (mode !== 'plan') return { state: 'superseded', planContent, toolName };

    // 3. later user message
    const messages = s.messages[sessionId] ?? [];
    const idx = messages.findIndex((m) => m.toolUseId === toolUseId);
    if (idx === -1) return { state: 'superseded', planContent, toolName };
    const tail = messages.slice(idx + 1);
    if (tail.some((m) => m.role === 'user')) {
      return { state: 'superseded', planContent, toolName };
    }

    // 4. newer plan_proposal
    if (tail.some((m) => m.type === 'tool_use' && m.toolSemantic === 'plan_proposal')) {
      return { state: 'superseded', planContent, toolName };
    }

    return { state: 'active', planContent, toolName };
  }, shallow);
}
```

> The exact field names (`messages`, `role`, `type`, `toolUseId`) must be reconciled with the actual chatStore shape during implementation; the structure above is illustrative.

### `usePlanDecisionHandlers`

```ts
const ALLOW_MESSAGE = 'Proceed with the plan above.';
const DEFAULT_DENY_MESSAGE = 'Please revise the plan.';

function usePlanDecisionHandlers(sessionId: string, toolUseId: string) {
  const setMode = useChatStore((s) => s.setMode);
  const setPlanDecision = useChatStore((s) => s.setPlanDecision);
  const sendMessage = useChatStore((s) => s.sendMessage);

  return {
    onAllow: async () => {
      const prevMode = useChatStore.getState().modeOverrides[sessionId];
      setMode(sessionId, 'default');
      try {
        await sendMessage(sessionId, ALLOW_MESSAGE);
        setPlanDecision(sessionId, toolUseId, {
          decision: 'allow',
          resolvedAt: Date.now(),
        });
      } catch (err) {
        setMode(sessionId, prevMode ?? 'plan');
        // surface via toast (existing toast utility)
        throw err;
      }
    },
    onDeny: async () => {
      await sendMessage(sessionId, DEFAULT_DENY_MESSAGE);
      setPlanDecision(sessionId, toolUseId, {
        decision: 'deny',
        resolvedAt: Date.now(),
      });
    },
    onDenyWithComment: async (comment: string) => {
      await sendMessage(sessionId, comment);
      setPlanDecision(sessionId, toolUseId, {
        decision: 'deny',
        comment,
        resolvedAt: Date.now(),
      });
    },
  };
}
```

Sequencing rules:
- For `onAllow`: set mode synchronously first, then send the message, then mark the decision only on a successful send. If `sendMessage` rejects, roll back the mode and re-throw so the UI layer (caller of the hook) can surface a toast.
- For `onDeny` / `onDenyWithComment`: send the message first, then mark the decision only on success. Mode is unchanged so there is nothing to roll back; on failure, propagate the error and leave the card `active`.
- Caller is responsible for surfacing errors via the existing toast utility — the hook does not toast directly to keep it framework-free for testing.

### Default messages

Centralized in `apps/desktop/src/features/chat/planDecisionCopy.ts`:

```ts
export const ALLOW_MESSAGE = 'Proceed with the plan above.';
export const DEFAULT_DENY_MESSAGE = 'Please revise the plan.';
```

## Claude path migration

`apps/desktop/src/features/chat/InlinePermissionRequest.tsx`:

- Detect plan-proposal via existing `isPlanProposalRequest` (input shape check).
- When true, render `<PlanDecisionCard>` instead of the current detail view + buttons.
- Maintain local `useState<PlanResolution | null>` to track client-side "just-clicked" state so the card flips to `resolved` immediately on click (before the server resolution arrives).
- Map button clicks to existing `onDecision` callback signature:
  - `onAllow` → `onDecision(requestId, true, false)`
  - `onDeny` → `onDecision(requestId, false, false)`
  - `onDenyWithComment(c)` → `onDecision(requestId, false, false, undefined, c)`

### Removed in the plan branch

The following features render in the non-plan permission branch only; they are not rendered when the plan branch routes to `PlanDecisionCard`:

- Timeout progress bar
- "Remember" checkbox
- AI review / workflow progress hint
- Credential input
- `feedbackDrafts` in `permissionStore` (the draft persistence across re-renders) — to be deleted if no other consumers exist. Implementation must grep for all references first.

These were already unused or unreachable in Claude's `ExitPlanMode` flow (plan timeout is set to 0, plan doesn't go through AI review, etc.), so removing them simplifies the component without behavior change.

### Server contract: unchanged

`onDecision(requestId, allow, remember, credential, feedback)` callback signature stays the same. `remember` is always `false` for plan decisions, `credential` is always `undefined`. Server-side permission gate, timeout handling, and resolution semantics are unchanged.

## State derivation summary

| Path | active | resolved | superseded (mode change) | superseded (newer user msg) | superseded (newer plan) |
|------|--------|----------|---------------------------|------------------------------|--------------------------|
| Cursor | derived from chatStore | `planDecision` field | mode !== 'plan' | message timeline | message timeline |
| Claude | `PermissionRequest` exists, no local resolution | local `useState` after click | N/A | N/A | N/A |

## Edge cases

| # | Scenario | Behavior |
|---|----------|----------|
| E1 | cursor not started with `--mode=plan`, but LLM still emits `createPlan` | `mode !== 'plan'` → `superseded` → card hidden, plan only visible in tool-call expanded view |
| E2 | User manually switches mode via ModeSelector while card active | `superseded` chip, no auto-send (user is in control) |
| E3 | User types a message manually instead of clicking buttons | Card → `superseded` based on later user message |
| E4 | Multiple `createPlan` in one run | Older ones `superseded`, only newest `active` |
| E5 | `sendMessage` fails after click | Roll back `setMode`, don't write `planDecision`, surface toast, card stays `active` |
| E6 | Session reload / history view | All plans get `superseded` (each followed by user messages); chips render correctly |
| E7 | Stale `planDecision` without matching user message | `planDecision` takes priority → renders `resolved` chip |
| E8 | Plan content empty or non-string | `PlanContent` handles gracefully, buttons still functional |
| E9 | Claude server-side timeout resolution | `InlinePermissionRequest` receives server resolution, updates local state, card flips to `resolved` |
| E10 | Mobile / Android | Three buttons wrap to multiple rows on narrow screens; textarea full-width; no keyboard shortcuts (touch-only) |

## Testing strategy

### Unit tests

- `PlanDecisionCard.test.tsx` — new
  - Active state: renders plan, three buttons, textarea
  - Allow / Deny click → calls callbacks
  - Deny+Comment: disabled when textarea empty; passes comment string on click
  - Resolved state: chip only, no buttons
  - Superseded state: "Plan superseded" chip
  - Long plan: collapse + "Show full plan" expand
  - Keyboard: `Cmd+Enter` in textarea → Deny+Comment when non-empty

- `usePlanDecisionState.test.ts` — new
  - Each branch of the derivation logic against snapshot chatStore states

- `usePlanDecisionHandlers.test.ts` — new
  - Allow: setMode + sendMessage + setPlanDecision sequence
  - Deny / DenyWithComment: sendMessage + setPlanDecision (mode unchanged)
  - sendMessage failure: rollback, no planDecision write

### Integration tests

- `ToolCallItem.test.tsx` (extended) — Cursor flow
  - Mock chatStore with completed `createPlan` → card renders
  - Click Allow → mode change + sendMessage observed
  - Add newer `createPlan` to store → older card flips to `superseded`

- `InlinePermissionRequest.test.tsx` (extended) — Claude flow
  - Plan-proposal PermissionRequest → renders `PlanDecisionCard`, not legacy detail view
  - Allow / Deny / Deny+Comment → `onDecision` called with correct args
  - Negative assertions: no Remember checkbox, no timeout bar, no AI review hint, no credential input

### Optional E2E

If `cursor-agent` is available in the test environment, drive a real plan-mode session and verify the card appears and Allow proceeds the run. Not required for merge.

## Implementation order

1. **Step 1 — `PlanDecisionCard`**: pure component + unit tests. No business wiring.
2. **Step 2 — chatStore**: add `planDecision` field, `setPlanDecision` action, unit tests.
3. **Step 3 — Hooks**: `usePlanDecisionState`, `usePlanDecisionHandlers`, unit tests.
4. **Step 4 — Cursor wiring**: insert `<CursorPlanDecision>` in MessageList, delete `PlanProposalActions`.
5. **Step 5 — Claude migration**: route `InlinePermissionRequest` plan branch to `PlanDecisionCard`; delete dropped features (after grep-confirming `feedbackDrafts` has no other consumers).
6. **Step 6 — Integration tests & manual verification**: both providers.
7. **Step 7 — Cleanup**: remove `EXECUTE_PLAN_PREFILL`, dead `setPendingPrefill` calls if exclusive to plan, update inline docs.

Steps 1-3 are independent and can land in parallel. Steps 4-5 depend on 1-3. Steps 6-7 are closing work. Each step is independently committable and revertable.

## Files touched

**New**:
- `apps/desktop/src/features/chat/PlanDecisionCard.tsx`
- `apps/desktop/src/features/chat/PlanDecisionCard.test.tsx`
- `apps/desktop/src/features/chat/CursorPlanDecision.tsx` (thin shell, may inline into MessageList if trivial)
- `apps/desktop/src/features/chat/planDecisionCopy.ts`
- `apps/desktop/src/hooks/usePlanDecisionState.ts` (or under `features/chat/`)
- `apps/desktop/src/hooks/usePlanDecisionState.test.ts`
- `apps/desktop/src/hooks/usePlanDecisionHandlers.ts`
- `apps/desktop/src/hooks/usePlanDecisionHandlers.test.ts`

**Modified**:
- `apps/desktop/src/stores/chatStore.ts` — `ToolCallState.planDecision`, `setPlanDecision` action
- `apps/desktop/src/features/chat/InlinePermissionRequest.tsx` — plan branch routes to `PlanDecisionCard`, drops Remember/timeout/AI-review under plan
- `apps/desktop/src/features/chat/tool-call/PlanContent.tsx` — remove `PlanProposalActions` + `EXECUTE_PLAN_PREFILL`; keep `PlanContent` markdown rendering for shared use
- `apps/desktop/src/features/chat/MessageList.tsx` (or `ChatMessagePane.tsx`) — insertion point for `<CursorPlanDecision>`
- `apps/desktop/src/stores/permissionStore.ts` — remove `feedbackDrafts` if grep confirms no remaining consumers

**Tests modified**:
- `apps/desktop/src/features/chat/__tests__/ToolCallItem.test.tsx`
- `apps/desktop/src/features/chat/__tests__/InlinePermissionRequest.test.tsx`
- `apps/desktop/src/stores/chatStore.test.ts`

## Open questions deferred to implementation

- Exact chatStore field names (`messages`, `role`, etc.) — reconcile with current shape.
- Whether `setPendingPrefill` has non-plan callers; if yes, keep the action and only remove the plan-specific call site.
- Whether `CursorPlanDecision` is worth a separate file or inlining into MessageList — decided by file size and reuse.

None of these block the design; they are tactical implementation details.
