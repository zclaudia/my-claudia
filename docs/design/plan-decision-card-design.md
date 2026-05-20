# Unified Plan Review — Cursor `createPlan` Joins Existing `PlanReviewRenderer`

**Date:** 2026-05-20 (revised after codebase investigation)
**Status:** Draft (pending implementation)
**Scope:** `apps/desktop/`, `shared/` — extend the existing plan-review interaction so Cursor's `createPlan` renders through the same `PlanReviewRenderer` UI already used by Claude `exit_plan_mode`.

> **Spec revision note:** an earlier draft of this document proposed a brand-new `PlanDecisionCard` component. Codebase investigation showed the project already has a substantial plan-review surface (`PlanReviewRenderer` in `InteractionItem.tsx`) driven by the `interaction_plan_review` message type. Building a parallel component would fragment the UX and duplicate ~200 lines of UI. The spec was rewritten to extend the existing infrastructure instead. The user decisions captured during brainstorming (auto-send on approve, default deny message, todos rendering) are preserved verbatim — only the *implementation surface* changed.

## Problem

Cursor's `createPlan` tool currently renders as an ordinary collapsible tool-call card with a single "Execute plan" button buried inside an expanded content view (`PlanProposalActions` in `tool-call/PlanContent.tsx`). There is no rejection path, no feedback path, no Save-as-Issue path, and no visual treatment to mark the card as a decision point.

Claude's `exit_plan_mode` (via the MCP interaction bridge) already has a rich decision UI:
- `PlanReviewRenderer` (`InteractionItem.tsx:375`) shows plan markdown with expand/collapse, an optional feedback textarea, and three buttons: **Save as Issue / Deny / Approve Plan**.
- After a decision, the card collapses to a coloured one-row chip (Approved / Rejected / Saved as issue #N).
- Server side, the MCP `exit_plan_mode` tool dispatches a `PlanReviewInteractionMessage` and awaits the user's response via `interactionDispatcher.dispatchAndWait`; an approval lets the tool return, a denial throws with the user's feedback so the LLM revises.

Cursor cannot use the same flow because `cursor-agent` is an external CLI process — MyClaudia cannot intercept its `createPlan` tool execution to insert a server-side gate. But cursor naturally pauses after emitting a plan (it waits for the next user message in plan mode), so a *client-side synthesised* interaction provides equivalent UX without backend involvement.

## Goal

Cursor's `createPlan` and Claude's `exit_plan_mode` render through one `PlanReviewRenderer` UI. The component gains optional `todos` rendering (Cursor emits structured `todos` alongside the markdown plan that the current renderer ignores), and a client-resolved decision branch so Cursor decisions become local actions (mode switch + user message via `handleSendMessage`) instead of round-tripping through `interaction_response`.

## Non-goals

- No changes to server-side `exit_plan_mode` tool, `interactionDispatcher`, or the `interaction_response` wire protocol.
- No server-side blocking of cursor-agent.
- No new client-side store. State sits in the existing `interactionStore` + the renderer's local `useState`.
- No migration or removal of the `InlinePermissionRequest` plan-proposal branch (`isPlanProposalRequest` in `InlinePermissionRequest.tsx`). It is a fallback path for permission-driven plan tools that is not on Claude's or Cursor's primary route; touching it is out of scope.
- No removal of the existing `PlanProposalActions` "Execute plan" prefill yet — phased; see Implementation order.
- No i18n in v1; default copy is English constants.
- No new "Save as Issue" semantics for Cursor in v1 beyond what already exists (the existing client-side save path runs irrespective of provider once the interaction is rendered).

## Architecture

```
                       ┌──────────────────────────────────┐
                       │  PlanReviewRenderer              │
                       │  (existing, extended)            │
                       │  - renders plan markdown         │
                       │  - renders todos[] (NEW)         │
                       │  - feedback textarea             │
                       │  - Save as Issue / Deny /        │
                       │    Approve buttons               │
                       │  - resolved chip                 │
                       └──────────┬───────────────────────┘
                                  │ reads
                       ┌──────────▼───────────────┐
                       │  PlanReviewInteraction-  │
                       │  Message (in interaction │
                       │  Store)                  │
                       │  +todos?: PlanTodoItem[] │
                       │  +source: 'tool_call' |  │
                       │   'client_synth'         │
                       └──────────┬───────────────┘
            ┌─────────────────────┴──────────────────────┐
            │                                            │
   ┌────────▼──────────────────┐         ┌───────────────▼──────────────┐
   │ Claude path (unchanged)    │         │ Cursor path (new)            │
   │ - server interaction-tools │         │ - cursor-sdk emits            │
   │   builds PlanReviewMessage │         │   tool_call:completed for     │
   │ - server pushes message    │         │   createPlan with             │
   │ - PlanReviewRenderer       │         │   {plan, todos}               │
   │   on Approve/Deny sends    │         │ - client message handler      │
   │   interaction_response;    │         │   synthesises a Plan-         │
   │   server resolves          │         │   ReviewInteractionMessage    │
   │   dispatchAndWait promise  │         │   with source='client_synth'  │
   │                            │         │   into interactionStore       │
   │                            │         │ - PlanReviewRenderer notices  │
   │                            │         │   source==='client_synth' and │
   │                            │         │   instead of interaction_     │
   │                            │         │   response, runs local        │
   │                            │         │   setMode + handleSendMessage │
   └────────────────────────────┘         └───────────────────────────────┘
```

**Invariants**:

- `PlanReviewRenderer` is the single visual decision surface for plans across all providers.
- The interaction wire protocol (`interaction_response`) is unchanged. Cursor never emits one.
- `source: 'client_synth'` is the discriminator that routes the renderer's `Approve` / `Deny` handlers into local actions instead of `sendMessage(interaction_response, …)`.
- The existing `ToolCallItem.tsx:84-91` lookup that finds the `interaction_plan_review` for a running `plan_proposal` tool already handles both providers transparently — once Cursor synthesises the interaction, the rest of the rendering chain works without changes.

## User decisions preserved from brainstorming

These are restated here as the source of truth — implementation MUST honour them:

| Q | Decision | Where this is realised |
|---|----------|------------------------|
| Q1 | Behaviour parity (not just visual parity) | Cursor synthesises an interaction so user must make a decision before continuing |
| Q2 | Deny without feedback sends a default deny message | New `DEFAULT_DENY_MESSAGE` constant; sent on cursor-path Deny when feedback empty |
| Q3 | Shared component, not duplicate | Single `PlanReviewRenderer`, extended |
| Q4 | "Active vs resolved" derivation: clicked + later user msg + newer plan + mode change | Existing renderer already handles "clicked" via local `useState`; the other transitions are inherent (a new `createPlan` produces a new interaction; user typing a message in cursor flow naturally resolves the run; mode change is user-initiated) |
| Q5 | Allow auto-sends `"Proceed with the plan above."` + switches mode | Cursor handler in renderer; not via prefill |
| Q6 | Decision card hoisted near the tool-call | Existing `ToolCallItem` already replaces itself with the `InteractionItem` when a matching `interaction_plan_review` exists — visual placement identical to Claude |
| Q7 | Resolved → compact chip | Existing renderer already does this (Approved / Rejected / Saved-as-issue) |
| Q8 | Migrate Claude side to the shared component | Claude already uses it — no migration work, just verify nothing regresses with the new todos field and source discriminator |
| Q (todos) | Plan markdown + structured todos shown together (option B) | New `todos` field on `PlanReviewInteractionMessage`; renderer adds a Steps section below the markdown |

## Wire / store types

### Extend `PlanReviewInteractionMessage`

`shared/src/interaction/forms.ts`:

```ts
export type PlanReviewSource = 'tool_call' | 'client_synth';

export interface PlanTodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface PlanReviewInteractionMessage extends InteractionBase {
  type: 'interaction_plan_review';
  plan: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
  todos?: PlanTodoItem[];                                  // NEW
  source?: PlanReviewSource;                               // NEW (default: 'tool_call')
}
```

- `todos` is optional. Server-emitted Claude interactions will not populate it (the MCP `exit_plan_mode` schema does not include todos). Cursor's client-side synthesiser populates it from `tool_call.tool_call.createPlanToolCall.args.todos`.
- `source` defaults to `'tool_call'` (existing behaviour). Cursor synthesises with `source: 'client_synth'`.

### Existing `InteractionBase` already has `source: string` (`'tool_call'` etc.)

Look at `shared/src/interaction/forms.ts` `InteractionBase` for the existing field. If it already carries a `source` field, the new spec field is just a narrowed type for plan-review interactions — verify during implementation; do not reintroduce duplicate fields.

## Cursor synthesis

### Where the synthesis happens

`apps/desktop/src/services/message-handlers/tool-messages.ts` (or wherever Cursor's `tool_use` / `tool_result` messages are processed on the client) currently writes the completed tool call to chatStore. Add a side-effect: when the just-completed tool has `toolSemantic === 'plan_proposal'` AND `provider === 'cursor'` (look up via `useProjectStore`), synthesise an `interaction_plan_review` and insert it into `interactionStore` via the existing `interaction_plan_review` reducer in `apps/desktop/src/services/message-handlers/interaction-messages.ts`.

> If the existing reducer is restricted to messages received over the wire, expose a small helper (`insertSynthesizedInteraction(interaction)`) on `interactionStore` instead of round-tripping through the dispatch table. Either approach is fine — pick the one that mutates state in the same way the wire path does so all downstream selectors keep working.

### Synthesis logic

```ts
function synthesizePlanReviewFromCursor(args: {
  sessionId: string;
  toolUseId: string;
  toolInput: unknown;
}): PlanReviewInteractionMessage {
  const { planContent, todos } = extractPlanPayload(args.toolInput);
  return {
    type: 'interaction_plan_review',
    interactionId: args.toolUseId,          // reuse tool_use_id so ToolCallItem's lookup matches
    sessionId: args.sessionId,
    source: 'client_synth',
    createdAt: Date.now(),
    plan: planContent,
    todos,
  };
}
```

Reusing `interactionId === toolUseId` is intentional: `ToolCallItem.tsx:84-91` already searches the interactionStore for `interaction_plan_review` matching the running plan-proposal tool's session, and once found, renders the interaction in place of the tool-call card. Using the toolUseId as the interactionId guarantees a unique 1:1 mapping per tool call without inventing a separate id source.

### Why a new interaction in the store and not an inline prop

Going through the interactionStore is what makes the existing `ToolCallItem` replacement logic work without modification. Any other route (e.g. rendering a `PlanReviewRenderer` directly from the tool-call card) would need a second routing path in `ToolCallItem`, which fragments the codebase. Single source of truth: the interactionStore.

## Plan payload extraction helper

`apps/desktop/src/features/chat/planReviewPayload.ts` — new:

```ts
function extractPlanPayload(toolInput: unknown): {
  planContent: string;
  todos?: PlanTodoItem[];
} {
  const input = normalizeToolInput(toolInput) as Record<string, unknown> | undefined;

  let planContent = '';
  if (typeof input?.plan === 'string') {
    planContent = input.plan;
  } else if (input?.plan && typeof input.plan === 'object') {
    planContent = JSON.stringify(input.plan, null, 2);
  } else if (typeof input?.plan_file === 'string') {
    planContent = `# Plan\n\nPlan file: ${input.plan_file}\n\nThe plan content will be displayed after approval.`;
  } else if (input && Object.keys(input).length > 0) {
    planContent = `# Plan Details\n\n${JSON.stringify(input, null, 2)}`;
  } else {
    planContent = '# Plan\n\nPlan ready for review.';
  }

  const todosRaw = Array.isArray(input?.todos) ? input.todos : undefined;
  const todos = todosRaw ? todosRaw.flatMap(normalizePlanTodoItem) : undefined;
  return { planContent, todos: todos && todos.length > 0 ? todos : undefined };
}

function normalizePlanTodoItem(raw: unknown): PlanTodoItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const content = typeof r.content === 'string' ? r.content : '';
  if (!content) return [];
  return [{ content, status: normalizePlanTodoStatus(r.status) }];
}

function normalizePlanTodoStatus(raw: unknown): PlanTodoItem['status'] {
  if (typeof raw !== 'string') return 'pending';
  const s = raw.toUpperCase().replace(/^TODO_STATUS_/, '');
  switch (s) {
    case 'COMPLETED': return 'completed';
    case 'IN_PROGRESS': return 'in_progress';
    case 'CANCELLED':
    case 'CANCELED': return 'cancelled';
    case 'PENDING':
    default: return 'pending';
  }
}
```

The same helper deprecates the inline plan-extraction block currently in `ToolExpandedContent.tsx` (the `isPlanProposalTool(toolName, semantic)` branch); update that branch to call `extractPlanPayload` so future Cursor-only `todos` rendering and the synthesiser share one implementation.

## `PlanReviewRenderer` extension

`apps/desktop/src/features/chat/InteractionItem.tsx`:

### Render the todos section (new)

Below the existing plan markdown viewport and above the existing feedback textarea, add a `Steps` section that renders when `interaction.todos?.length > 0`:

```tsx
{interaction.todos && interaction.todos.length > 0 && (
  <div className="flex flex-col gap-1 mt-1">
    <span className="text-[11px] font-medium text-muted-foreground">Steps</span>
    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
      {(showAllTodos ? interaction.todos : interaction.todos.slice(0, 8)).map((todo, idx) => (
        <div key={idx} className="flex items-start gap-2 text-xs">
          <span className="flex-shrink-0 mt-0.5">
            {todo.status === 'completed'
              ? <CheckCircle2 size={12} className="text-success" />
              : todo.status === 'in_progress'
                ? <Loader2 size={12} className="animate-spin text-primary" />
                : todo.status === 'cancelled'
                  ? <XCircle size={12} className="text-muted-foreground/60" />
                  : <Square size={12} className="text-muted-foreground" />}
          </span>
          <span className={
            todo.status === 'completed' ? 'text-muted-foreground line-through' :
            todo.status === 'cancelled' ? 'text-muted-foreground/70 line-through' :
            'text-foreground'
          }>
            {todo.content}
          </span>
        </div>
      ))}
    </div>
    {interaction.todos.length > 8 && (
      <button
        onClick={() => setShowAllTodos((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-foreground text-left transition-colors"
      >
        {showAllTodos
          ? 'Show fewer steps'
          : `Show all ${interaction.todos.length} steps`}
      </button>
    )}
  </div>
)}
```

`showAllTodos` is a new local `useState<boolean>(false)` next to the existing `expanded` state.

### Branch the Approve / Deny / Save-as-Issue handlers on `source`

The existing handlers send `interaction_response` via WebSocket. Add a branch on `interaction.source === 'client_synth'` that performs local actions instead. This requires plumbing `handleSendMessage` and `setMode` into the renderer.

Currently `PlanReviewRenderer` has zero awareness of `handleSendMessage`. Options:

1. **Prop-drill from `ChatInterface` → `ChatMessagePane` → `MessageList` (or `InteractionItem` wherever it's rendered) → `PlanReviewRenderer`.** Clean but touches several files.

2. **Read from a small context.** Create `ChatActionsContext` in `ChatInterface.tsx` exposing `{ handleSendMessage, setMode }`, consumed by `PlanReviewRenderer` only when `source === 'client_synth'`. No prop-drill; opt-in API.

Pick option 2 — fewer surfaces touched, clearer intent (the context only exists for "actions a chat-embedded interaction may need to perform locally").

```tsx
// apps/desktop/src/features/chat/ChatActionsContext.tsx
export interface ChatActionsContextValue {
  handleSendMessage: (content: string, attachments?: Attachment[], overrideMode?: string) => Promise<void>;
  setMode: (sessionId: string, mode: string) => void;
}
const ChatActionsContext = createContext<ChatActionsContextValue | null>(null);
export const ChatActionsProvider = ChatActionsContext.Provider;
export function useChatActions(): ChatActionsContextValue {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) throw new Error('useChatActions called outside ChatActionsProvider');
  return ctx;
}
```

`ChatInterface.tsx` wraps its return tree with `<ChatActionsProvider value={{ handleSendMessage, setMode }}>`. `PlanReviewRenderer` only calls `useChatActions()` when needed.

### `handleSendMessage` mode override

`handleSendMessage` currently captures `mode` via React closure, so calling `setMode(default)` then `handleSendMessage(...)` in the same tick races with the stale closure. Add an explicit override parameter so the renderer can pass `'default'` directly without depending on closure timing:

```ts
// apps/desktop/src/hooks/chat/useSendMessage.ts
const handleSendMessage = useCallback(async (
  content: string,
  attachments?: Attachment[],
  overrideMode?: string,    // NEW
) => {
  // ...existing prelude...
  const effectiveMode = overrideMode ?? mode;
  const runStartMsg: RunStartMessage = {
    type: 'run_start',
    clientRequestId: clientMessageId,
    sessionId,
    input: fullContent,
    mode: effectiveMode || undefined,
    // ...
  };
  // ...
}, [/* existing deps; do NOT add overrideMode (parameter, not closure) */]);
```

This is a backwards-compatible additive parameter — existing call sites unchanged.

### Handler routing

In `PlanReviewRenderer`:

```tsx
const isClientSynth = interaction.source === 'client_synth';
const actions = isClientSynth ? useChatActions() : null;

const ALLOW_MESSAGE = 'Proceed with the plan above.';
const DEFAULT_DENY_MESSAGE = 'Please revise the plan.';

const handleApprove = useCallback(async () => {
  if (isClientSynth && actions) {
    const text = feedback.trim() ? `${ALLOW_MESSAGE}\n\n${feedback.trim()}` : ALLOW_MESSAGE;
    setDecision({ kind: 'approved' });
    actions.setMode(interaction.sessionId!, 'default');
    try {
      await actions.handleSendMessage(text, undefined, 'default');
    } catch (err) {
      // toast surfacing via existing useToastStore
      setDecision(null);
      actions.setMode(interaction.sessionId!, 'plan');
      throw err;
    }
    return;
  }
  // existing interaction_response path
  sendMessage({ type: 'interaction_response', /* … */ });
  setDecision({ kind: 'approved' });
}, [/* … */]);

const handleDeny = useCallback(async () => {
  if (isClientSynth && actions) {
    const text = feedback.trim() || DEFAULT_DENY_MESSAGE;
    setDecision({ kind: 'rejected' });
    try {
      await actions.handleSendMessage(text);   // mode stays 'plan'
    } catch (err) {
      setDecision(null);
      throw err;
    }
    return;
  }
  // existing interaction_response path
  sendMessage({ type: 'interaction_response', /* … */ });
  setDecision({ kind: 'rejected' });
}, [/* … */]);
```

`handleSaveAsIssue` works the same in both branches: it always saves to `useLocalIssueStore`, then for `client_synth` sends a "Saved as issue #N for later." user message via `handleSendMessage`; for the existing path it sends `interaction_response` as before.

> **Reads MUST NOT depend on hook order — pull `useChatActions()` conditionally only at the top level once.** Move the `isClientSynth` check above all hook usage and store the result before invoking `useChatActions()`. Actually the cleanest pattern is to *unconditionally* call `useContext(ChatActionsContext)` (allow null) and branch on the result + `isClientSynth`. Either way: respect Rules of Hooks.

Corrected pattern:

```tsx
const chatActionsCtx = useContext(ChatActionsContext); // may be null
const isClientSynth = interaction.source === 'client_synth';
// later: if (isClientSynth && chatActionsCtx) { ... }
```

## "Active vs resolved" state — already handled

The existing renderer keeps `decision` in `useState`. After the user clicks, the resolved chip shows and the button row disappears. Re-renders are stable because the parent (`ToolCallItem` / `InteractionItem`) keeps showing the same interaction id; the local state persists for the lifetime of that DOM tree.

For history view / session reload: completed `interaction_plan_review` messages are not re-played by the server (Claude path; the dispatch resolves and the interaction is removed). For Cursor's client-synth path, the synthesised interaction lives only in the in-memory `interactionStore` and is dropped on reload. **Historical Cursor plans, after reload, will not show a decision card — only the tool-call card with the plan content.** This matches Claude's behaviour and is acceptable: the user has long since moved on.

> If we later want resolved decisions to persist across reload, we'd add a `resolved` flag on the interaction message and persist it server-side. Out of scope for v1.

## Removal of `PlanProposalActions`

The "Execute plan" button (`tool-call/PlanContent.tsx::PlanProposalActions`) duplicates the Approve path of the new flow. Once the synthesiser is live, it becomes unreachable (the tool-call card is replaced by the `InteractionItem` once the interaction exists). To avoid dead UI we will:

1. Delete `PlanProposalActions` and its export.
2. Delete the `EXECUTE_PLAN_PREFILL` constant.
3. Verify `setPendingPrefill` has no other plan-specific callers; if it has unrelated callers (e.g. some other feature), leave the store action intact.

This is the only piece of Cursor's existing plan UI that we're actively removing.

## Edge cases

| # | Scenario | Behaviour |
|---|----------|-----------|
| E1 | cursor not started with `--mode=plan` but emits `createPlan` anyway | Synthesiser still fires (mode-check is the user's responsibility, not the synthesiser's). The "Approve" button switches to default; "Deny" keeps current mode. Edge but acceptable. |
| E2 | User switches mode via ModeSelector while card active | The card stays — user can still click. Approve respects the override (`'default'`). |
| E3 | User types a message in the input while card active | Existing `useSendMessage` queues or sends; the interaction stays unresolved in the store. Acceptable — the next assistant turn will likely emit a new plan or proceed; either way the stale interaction becomes visually irrelevant. |
| E4 | Multiple `createPlan` in one run | Each emits a new synthesised interaction with a fresh `interactionId = toolUseId`. The latest tool-call card is replaced by the newest interaction; older ones stay rendered with their resolved state (or remain unresolved if the user didn't click). |
| E5 | `handleSendMessage` fails (network down) | The handler catches, restores `decision = null` and (for Approve) rolls back mode. Existing `useToastStore` surfaces the error. |
| E6 | Session reload / history | Synthesised interactions are not replayed → no decision card on history. Tool-call card still shows the plan. |
| E7 | Empty `plan` / non-string plan | Helper produces a fallback markdown string; renderer still works. |
| E8 | Mobile / Android | Existing renderer already handles narrow widths (buttons wrap, textarea full-width). Todos section adds `max-h-48 overflow-y-auto` so it doesn't blow up vertical space. |
| E9 | Cursor's `todos` array contains dependency cycles or self-references | Out of scope — we render `content` + `status` only; dependencies are not visualised in v1. |
| E10 | Provider lookup fails (session has no `providerId`) | Synthesiser short-circuits (no synthesis) → existing tool-call card with "Execute plan" wouldn't show either (we'd have removed it). Net effect: tool-call card shows the plan as plain markdown, no decision UI. Acceptable for sessions in this degraded state. |

## Testing strategy

### Unit tests

- `planReviewPayload.test.ts` — new
  - `extractPlanPayload`: plan string → planContent only, todos undefined
  - `extractPlanPayload`: plan + todos → both populated
  - `extractPlanPayload`: plan_file fallback
  - `extractPlanPayload`: object plan → JSON.stringify
  - `normalizePlanTodoStatus`: `TODO_STATUS_PENDING` → `pending`, `TODO_STATUS_IN_PROGRESS` → `in_progress`, `TODO_STATUS_COMPLETED` → `completed`, `TODO_STATUS_CANCELLED` → `cancelled`, lowercase `completed` → `completed`, unknown → `pending`
  - `normalizePlanTodoItem`: skips empty `content`; defaults missing `status` to `pending`

### Component tests

- `PlanReviewRenderer.test.tsx` (extend existing):
  - Renders todos section when `interaction.todos` populated; status icons match expected
  - Hides todos section when `interaction.todos` empty or undefined
  - Long todos (>8): "Show all N steps" toggle
  - `source: 'client_synth'`: clicking Approve calls `handleSendMessage` with `'Proceed with the plan above.'` and `overrideMode: 'default'`; calls `setMode(sessionId, 'default')`
  - `source: 'client_synth'`: clicking Deny with empty feedback sends `'Please revise the plan.'`
  - `source: 'client_synth'`: clicking Deny with feedback sends the feedback text
  - `source: 'client_synth'`: `handleSendMessage` throws → decision state reverts; mode rolls back on Approve
  - `source: 'client_synth'`: clicking Save as Issue saves to local issue store + sends `'Saved as issue #N for later.'` user message
  - `source: 'tool_call'` (default): existing tests still pass (no regression to Claude path)

- `ToolCallItem.test.tsx` (extend): Cursor `createPlan` with synthesised interaction → renders InteractionItem (the existing lookup logic catches it because `interactionId === toolUseId`)

### Integration tests

- New test file `apps/desktop/src/features/chat/__tests__/cursorPlanSynthesis.test.tsx`:
  - Given: chatStore state with a completed Cursor `createPlan` tool call
  - And: project store has session with provider type `'cursor'`
  - When: the message handler processes the tool_result
  - Then: interactionStore contains a new `interaction_plan_review` with `source: 'client_synth'`, `todos` matching the input
  - And: `PlanReviewRenderer` (via `InteractionItem`) renders the decision card

### Regression coverage matrix

| Path | Approve | Deny (empty) | Deny (feedback) | Save as Issue | Todos rendering |
|------|---------|--------------|------------------|----------------|------------------|
| Cursor (client_synth) | ✓ | ✓ default deny | ✓ | ✓ | ✓ |
| Claude (tool_call) | ✓ (no regression) | ✓ (no regression) | ✓ (no regression) | ✓ (no regression) | N/A |

## Files touched

**New**:
- `apps/desktop/src/features/chat/planReviewPayload.ts` — `extractPlanPayload`, `normalizePlanTodoItem`, `normalizePlanTodoStatus`
- `apps/desktop/src/features/chat/planReviewPayload.test.ts`
- `apps/desktop/src/features/chat/ChatActionsContext.tsx` — context providing `handleSendMessage` + `setMode`
- `apps/desktop/src/features/chat/__tests__/cursorPlanSynthesis.test.tsx`

**Modified**:
- `shared/src/interaction/forms.ts` — add `PlanTodoItem`, `PlanReviewSource`; extend `PlanReviewInteractionMessage` with `todos?` and narrow `source` typing
- `apps/desktop/src/features/chat/InteractionItem.tsx::PlanReviewRenderer` — todos rendering; branch handlers on `interaction.source`; consume `ChatActionsContext`
- `apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx` — extend with todos + client_synth cases
- `apps/desktop/src/hooks/chat/useSendMessage.ts` — add `overrideMode?: string` parameter to `handleSendMessage`; thread into `runStartMsg.mode`
- `apps/desktop/src/features/chat/ChatInterface.tsx` — wrap tree in `<ChatActionsProvider value={{ handleSendMessage, setMode }}>`
- `apps/desktop/src/services/message-handlers/tool-messages.ts` (or wherever tool_result is processed) — on Cursor `plan_proposal` completion, synthesise interaction
- `apps/desktop/src/services/message-handlers/interaction-messages.ts` — expose / accept a synthesised-interaction insertion path (or call existing handler with the synthesised message — pick whichever matches the existing pattern)
- `apps/desktop/src/features/chat/tool-call/PlanContent.tsx` — delete `PlanProposalActions` + `EXECUTE_PLAN_PREFILL`; keep `PlanContent` markdown rendering for potential reuse in `PlanReviewRenderer`'s plan markdown viewport (or inline if simpler)
- `apps/desktop/src/features/chat/tool-call/ToolExpandedContent.tsx` — replace inline plan-extraction block with `extractPlanPayload(toolInput)` call

**Not touched**:
- `apps/desktop/src/features/chat/InlinePermissionRequest.tsx` — its plan-proposal branch is a fallback path, not on the primary flow. Out of scope.
- `server/src/application/conversation/interactions/interaction-tools.ts` — Claude path is unchanged.
- `server/src/infrastructure/providers/cursor-sdk.ts` — `toolSemantic: 'plan_proposal'` is already emitted; client takes it from there.

## Implementation order

1. **Step 1 — Shared type extensions**: `PlanTodoItem`, `PlanReviewSource`, `PlanReviewInteractionMessage.todos / .source` in `shared/`. Run shared build, ensure no consumers break.
2. **Step 2 — Payload helper**: `planReviewPayload.ts` + tests. Pure function, no integration yet.
3. **Step 3 — `handleSendMessage` mode override**: additive param. Existing call sites continue to work.
4. **Step 4 — `ChatActionsContext`**: provider in `ChatInterface`, hook export. No consumers yet.
5. **Step 5 — `PlanReviewRenderer` todos rendering**: extend component to render new `todos` field. Run existing tests — no regression. New test case for todos.
6. **Step 6 — `PlanReviewRenderer` client_synth branch**: branch handlers on `interaction.source`. Add tests using a mock context.
7. **Step 7 — Cursor synthesiser**: insertion point in the tool-message handler. Integration test verifying the interaction lands in the store.
8. **Step 8 — Cleanup**: delete `PlanProposalActions`, `EXECUTE_PLAN_PREFILL`, related calls; switch `ToolExpandedContent` plan branch to `extractPlanPayload`.
9. **Step 9 — Manual verification**: drive a Cursor plan-mode session locally; click each button; confirm Claude path still works.

Steps 1-4 are independent and can land in any order or in parallel. Step 5 depends on 1. Step 6 depends on 1, 3, 4. Step 7 depends on 1, 2 and the existing interaction insertion path. Step 8 depends on 7 (don't strip the prefill until the new path is live). Step 9 is the end-to-end check.

## Open questions deferred to implementation

- Exact location of the Cursor tool-result message handler (`services/message-handlers/`). The synthesiser must hook at the point where the tool transitions from `running` to `completed` — verify whether that lives in `tool-messages.ts`, `runtime-events.ts`, or somewhere else during implementation.
- Whether `setPendingPrefill` has consumers other than the deleted "Execute plan" button. Grep before removing the store action.
- Whether `PlanContent` (the markdown renderer in `tool-call/PlanContent.tsx`) should be lifted to share with `PlanReviewRenderer`'s plan body; today `PlanReviewRenderer` uses `whitespace-pre-wrap` raw markdown. Consider as a small polish in step 8.

None of these block the design.
