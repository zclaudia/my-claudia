# Unified Plan Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cursor's `createPlan` reuse the existing `PlanReviewRenderer` UI (the one already used for Claude `exit_plan_mode`), with structured todos rendered alongside the markdown plan, and decisions resolved client-side via `handleSendMessage` + mode switch instead of server `interaction_response`.

**Architecture:** Extend `PlanReviewInteractionMessage` with optional `todos` and a `source` discriminator (`'tool_call'` for the existing server-driven path, `'client_synth'` for Cursor). When the client receives a Cursor `tool_use` with `semantic === 'plan_proposal'`, synthesise an `interaction_plan_review` message keyed by `interactionId === toolUseId` and insert it into `interactionStore`. The existing `ToolCallItem` lookup by `s.interactions[toolCall.id]` already routes this to `InteractionItem` → `PlanReviewRenderer` with zero changes to the tool-call card. Inside the renderer, branch on `interaction.source`: `'client_synth'` triggers local actions (mode switch + send user message via a new `ChatActionsContext`), `'tool_call'` continues to send `interaction_response` over the wire.

**Tech Stack:** React + Zustand stores, Vitest + React Testing Library, TypeScript shared types in `shared/`, Tauri v2 desktop app.

**Reference spec:** [`docs/design/plan-decision-card-design.md`](./plan-decision-card-design.md)

---

## File Structure

**Created:**
- `apps/desktop/src/features/chat/planReviewPayload.ts` — pure helpers: `extractPlanPayload(toolInput) → { planContent, todos? }`; `normalizePlanTodoItem`; `normalizePlanTodoStatus`. Used by both the Cursor synthesiser and `ToolExpandedContent`'s plan branch.
- `apps/desktop/src/features/chat/planReviewPayload.test.ts` — unit tests for the helpers.
- `apps/desktop/src/features/chat/ChatActionsContext.tsx` — React context exposing `{ handleSendMessage, setMode }` from `ChatInterface` to descendant interaction renderers; consumed only by `PlanReviewRenderer` when `source === 'client_synth'`.
- `apps/desktop/src/features/chat/__tests__/cursorPlanSynthesis.test.tsx` — integration test for the run-messages synthesiser.

**Modified:**
- `shared/src/interaction/forms.ts` — add `PlanTodoItem`, `PlanReviewSource`; extend `PlanReviewInteractionMessage` with `todos?: PlanTodoItem[]` and tighten `source` typing to `PlanReviewSource`.
- `apps/desktop/src/hooks/chat/useSendMessage.ts` — add optional third parameter `overrideMode?: string` to `handleSendMessage`; thread into `runStartMsg.mode`.
- `apps/desktop/src/features/chat/ChatInterface.tsx` — wrap return tree with `<ChatActionsProvider value={{ handleSendMessage, setMode }}>`.
- `apps/desktop/src/features/chat/InteractionItem.tsx` — `PlanReviewRenderer` renders the new `todos` section and branches `handleApprove`/`handleDeny`/`handleSaveAsIssue` on `interaction.source`. New local `useState` for `showAllTodos`.
- `apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx` — extend with todos cases, client_synth cases, and a regression guard for the server-driven path.
- `apps/desktop/src/services/message-handlers/run-messages.ts` — on `tool_use` with `semantic === 'plan_proposal'`, synthesise an `interaction_plan_review` if the session's provider is Cursor.
- `apps/desktop/src/features/chat/tool-call/PlanContent.tsx` — delete `PlanProposalActions`, `EXECUTE_PLAN_PREFILL`; keep `PlanContent` markdown renderer and `PLAN_PREVIEW_LINES` (still used by `ToolExpandedContent`).
- `apps/desktop/src/features/chat/tool-call/ToolExpandedContent.tsx` — replace inline plan-extraction block (in `isPlanProposalTool(...)` branch) with `extractPlanPayload(toolInput)`; remove `<PlanProposalActions>` import + usage.

**Not touched:**
- `apps/desktop/src/features/chat/InlinePermissionRequest.tsx` — its plan-proposal branch is a fallback path, out of scope.
- `server/src/application/conversation/interactions/interaction-tools.ts` — Claude path unchanged.
- `server/src/infrastructure/providers/cursor-sdk.ts` — already emits `toolSemantic: 'plan_proposal'`.

---

## Task 1: Extend shared interaction types

**Files:**
- Modify: `shared/src/interaction/forms.ts:94-99`

- [ ] **Step 1: Add the new types**

Open `shared/src/interaction/forms.ts` and replace the existing `PlanReviewInteractionMessage` interface (currently at lines 94-99) with this version:

```ts
export type PlanReviewSource = 'tool_call' | 'client_synth';

export interface PlanTodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

/** Plan review interaction (from exit_plan_mode tool, or client-synth for Cursor createPlan) */
export interface PlanReviewInteractionMessage extends InteractionBase {
  type: 'interaction_plan_review';
  plan: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
  todos?: PlanTodoItem[];
  source?: PlanReviewSource;
}
```

- [ ] **Step 2: Re-export from the shared index if needed**

Check that `PlanTodoItem` and `PlanReviewSource` are exported through `shared/src/index.ts`. If `shared/src/index.ts` re-exports the interaction module wholesale (e.g. `export * from './interaction/forms.ts'`), no change needed. If it picks named exports, add `PlanTodoItem, PlanReviewSource` to the list.

Run:

```bash
grep -n "interaction/forms" shared/src/index.ts
```

If the result is `export * from ...`, skip the next sub-step.
Otherwise, edit `shared/src/index.ts` to add the new names.

- [ ] **Step 3: Build shared and verify TypeScript compiles**

Run:

```bash
pnpm --filter @my-claudia/shared build
```

Expected: clean build. If anything fails, fix the types (likely a stale `source: string` somewhere) before continuing.

- [ ] **Step 4: Run shared + desktop typecheck**

Run:

```bash
pnpm --filter @my-claudia/shared typecheck && pnpm --filter desktop typecheck
```

Expected: PASS with no new errors. Pre-existing errors unrelated to this work are not a regression.

- [ ] **Step 5: Commit**

```bash
git add shared/src/interaction/forms.ts shared/src/index.ts
git commit -m "shared: extend PlanReviewInteractionMessage with todos and source"
```

---

## Task 2: Plan payload helper

**Files:**
- Create: `apps/desktop/src/features/chat/planReviewPayload.ts`
- Test: `apps/desktop/src/features/chat/planReviewPayload.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/desktop/src/features/chat/planReviewPayload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractPlanPayload,
  normalizePlanTodoItem,
  normalizePlanTodoStatus,
} from './planReviewPayload';

describe('normalizePlanTodoStatus', () => {
  it('maps cursor TODO_STATUS_* enum to canonical form', () => {
    expect(normalizePlanTodoStatus('TODO_STATUS_PENDING')).toBe('pending');
    expect(normalizePlanTodoStatus('TODO_STATUS_IN_PROGRESS')).toBe('in_progress');
    expect(normalizePlanTodoStatus('TODO_STATUS_COMPLETED')).toBe('completed');
    expect(normalizePlanTodoStatus('TODO_STATUS_CANCELLED')).toBe('cancelled');
  });

  it('accepts lowercase short forms', () => {
    expect(normalizePlanTodoStatus('completed')).toBe('completed');
    expect(normalizePlanTodoStatus('in_progress')).toBe('in_progress');
  });

  it('treats both spellings of cancelled', () => {
    expect(normalizePlanTodoStatus('CANCELED')).toBe('cancelled');
    expect(normalizePlanTodoStatus('CANCELLED')).toBe('cancelled');
  });

  it('falls back to pending for unknown / non-string', () => {
    expect(normalizePlanTodoStatus('SOMETHING_ELSE')).toBe('pending');
    expect(normalizePlanTodoStatus(undefined)).toBe('pending');
    expect(normalizePlanTodoStatus(42)).toBe('pending');
  });
});

describe('normalizePlanTodoItem', () => {
  it('skips items without a content string', () => {
    expect(normalizePlanTodoItem({ status: 'TODO_STATUS_PENDING' })).toEqual([]);
    expect(normalizePlanTodoItem(null)).toEqual([]);
    expect(normalizePlanTodoItem('foo')).toEqual([]);
  });

  it('defaults missing status to pending', () => {
    expect(normalizePlanTodoItem({ content: 'do the thing' })).toEqual([
      { content: 'do the thing', status: 'pending' },
    ]);
  });

  it('preserves content and normalizes status', () => {
    expect(normalizePlanTodoItem({ content: 'X', status: 'TODO_STATUS_IN_PROGRESS' })).toEqual([
      { content: 'X', status: 'in_progress' },
    ]);
  });
});

describe('extractPlanPayload', () => {
  it('extracts plan from a string field', () => {
    const out = extractPlanPayload({ plan: '# Title\n\nbody' });
    expect(out.planContent).toBe('# Title\n\nbody');
    expect(out.todos).toBeUndefined();
  });

  it('extracts plan + todos and normalizes statuses', () => {
    const out = extractPlanPayload({
      plan: '# Cursor plan',
      todos: [
        { id: 'a', content: 'step one', status: 'TODO_STATUS_PENDING' },
        { id: 'b', content: 'step two', status: 'TODO_STATUS_IN_PROGRESS' },
        { id: 'c', content: '', status: 'TODO_STATUS_PENDING' },          // empty → dropped
      ],
    });
    expect(out.planContent).toBe('# Cursor plan');
    expect(out.todos).toEqual([
      { content: 'step one', status: 'pending' },
      { content: 'step two', status: 'in_progress' },
    ]);
  });

  it('JSON.stringifies a non-string plan', () => {
    const out = extractPlanPayload({ plan: { foo: 1 } });
    expect(out.planContent).toBe('{\n  "foo": 1\n}');
  });

  it('produces a fallback message when only plan_file is present', () => {
    const out = extractPlanPayload({ plan_file: '/tmp/plan.md' });
    expect(out.planContent).toContain('Plan file: /tmp/plan.md');
  });

  it('falls back to dumping unknown shape', () => {
    const out = extractPlanPayload({ unrelated: 'x' });
    expect(out.planContent).toContain('Plan Details');
    expect(out.planContent).toContain('"unrelated"');
  });

  it('produces a default message for empty input', () => {
    expect(extractPlanPayload({}).planContent).toBe('# Plan\n\nPlan ready for review.');
    expect(extractPlanPayload(undefined).planContent).toBe('# Plan\n\nPlan ready for review.');
  });

  it('returns todos undefined when the array is empty', () => {
    const out = extractPlanPayload({ plan: 'X', todos: [] });
    expect(out.todos).toBeUndefined();
  });

  it('parses stringified JSON inputs', () => {
    const out = extractPlanPayload(JSON.stringify({ plan: 'inline', todos: [{ content: 'a' }] }));
    expect(out.planContent).toBe('inline');
    expect(out.todos).toEqual([{ content: 'a', status: 'pending' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter desktop test -- planReviewPayload
```

Expected: FAIL with `Cannot find module './planReviewPayload'`.

- [ ] **Step 3: Create the helper module**

Create `apps/desktop/src/features/chat/planReviewPayload.ts`:

```ts
import type { PlanTodoItem } from '@my-claudia/shared';

function normalizeToolInput(input: unknown): unknown {
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch { return input; }
  }
  return input;
}

export function normalizePlanTodoStatus(raw: unknown): PlanTodoItem['status'] {
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

export function normalizePlanTodoItem(raw: unknown): PlanTodoItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const content = typeof r.content === 'string' ? r.content : '';
  if (!content) return [];
  return [{ content, status: normalizePlanTodoStatus(r.status) }];
}

export function extractPlanPayload(toolInput: unknown): {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter desktop test -- planReviewPayload
```

Expected: PASS, all 13 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/chat/planReviewPayload.ts apps/desktop/src/features/chat/planReviewPayload.test.ts
git commit -m "feat(chat): add planReviewPayload helper"
```

---

## Task 3: `handleSendMessage` accepts `overrideMode`

**Files:**
- Modify: `apps/desktop/src/hooks/chat/useSendMessage.ts:135-226`

No dedicated `useSendMessage.test.ts` exists today (confirmed via the spec investigation). The override's behaviour is covered indirectly by Task 6's `PlanReviewRenderer` client-synth test, which asserts that `handleSendMessage` is called with `(text, undefined, 'default')` on Approve. Proceed directly to modifying the hook.

- [ ] **Step 1: Modify `handleSendMessage` signature and body**

Open `apps/desktop/src/hooks/chat/useSendMessage.ts:135`. Change the `useCallback` signature:

```ts
const handleSendMessage = useCallback(async (
  content: string,
  attachments?: Attachment[],
  overrideMode?: string,
) => {
  // ...existing body...
```

In the body, change the `runStartMsg` construction (currently at line 212-221) to:

```ts
const runStartMsg: RunStartMessage = {
  type: 'run_start',
  clientRequestId: clientMessageId,
  sessionId,
  input: fullContent,
  mode: (overrideMode ?? mode) || undefined,
  model: modelOverride || undefined,
  permissionOverride: permissionOverride || undefined,
  workingDirectory: currentSession?.workingDirectory || undefined,
};
```

The `useCallback` deps array (currently at line 226) stays unchanged — `overrideMode` is a parameter, not a closure capture, so it is NOT a dep.

- [ ] **Step 2: Run the desktop typecheck**

```bash
pnpm --filter desktop typecheck
```

Expected: PASS. If the queued-message re-send path in the same file uses the captured handler, it continues to omit `overrideMode` and behaves as before.

- [ ] **Step 3: Run the existing chat hook tests**

```bash
pnpm --filter desktop test -- hooks/chat
```

Expected: PASS — the new parameter is purely additive.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/hooks/chat/useSendMessage.ts
git commit -m "feat(chat): handleSendMessage accepts optional overrideMode"
```

---

## Task 4: `ChatActionsContext`

**Files:**
- Create: `apps/desktop/src/features/chat/ChatActionsContext.tsx`
- Modify: `apps/desktop/src/features/chat/ChatInterface.tsx`

- [ ] **Step 1: Create the context module**

Create `apps/desktop/src/features/chat/ChatActionsContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { Attachment } from './MessageInput';

export interface ChatActionsContextValue {
  handleSendMessage: (
    content: string,
    attachments?: Attachment[],
    overrideMode?: string,
  ) => Promise<void>;
  setMode: (sessionId: string, mode: string) => void;
}

const ChatActionsContext = createContext<ChatActionsContextValue | null>(null);

export function ChatActionsProvider({
  value,
  children,
}: {
  value: ChatActionsContextValue;
  children: ReactNode;
}) {
  return <ChatActionsContext.Provider value={value}>{children}</ChatActionsContext.Provider>;
}

/** Returns `null` when no provider is in scope (e.g. in tests that don't need it). */
export function useChatActionsOptional(): ChatActionsContextValue | null {
  return useContext(ChatActionsContext);
}
```

`Attachment` is the local type exported from `MessageInput.tsx:10` (the same type that `handleSendMessage`'s `attachments` parameter accepts elsewhere in the codebase).

- [ ] **Step 2: Wrap the ChatInterface tree with the provider**

Open `apps/desktop/src/features/chat/ChatInterface.tsx`. Near the top, add:

```tsx
import { useMemo } from 'react';                       // if not already imported
import { ChatActionsProvider, type ChatActionsContextValue } from './ChatActionsContext';
```

Find where `handleSendMessage` is destructured (around line 106). Just below that destructure, add a memoized context value:

```tsx
const chatActionsValue = useMemo<ChatActionsContextValue>(() => ({
  handleSendMessage,
  setMode: useChatStore.getState().setMode,
}), [handleSendMessage]);
```

`setMode` is read directly from the store — Zustand action references are stable, so the memo only changes when `handleSendMessage`'s identity changes.

Wrap the outermost JSX tree (the `<div>` or fragment that contains the whole chat surface) with the provider:

```tsx
<ChatActionsProvider value={chatActionsValue}>
  {/* existing tree */}
</ChatActionsProvider>
```

> Do **not** use `useChatStore((s) => s.setMode)` inside the value object — that subscribes the whole ChatInterface to store changes for no reason. Read once from `getState()`.

- [ ] **Step 3: Run desktop typecheck**

```bash
pnpm --filter desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Smoke-test ChatInterface render**

If there are existing tests for `ChatInterface`, run them:

```bash
pnpm --filter desktop test -- ChatInterface
```

Expected: PASS. If a test fails because it doesn't provide the new context but tries to consume it, that's a sign we forgot to gate the consumer; we'll add the gate in Task 6.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/chat/ChatActionsContext.tsx apps/desktop/src/features/chat/ChatInterface.tsx
git commit -m "feat(chat): provide ChatActionsContext from ChatInterface"
```

---

## Task 5: Render todos in `PlanReviewRenderer`

**Files:**
- Modify: `apps/desktop/src/features/chat/InteractionItem.tsx:375-563`
- Test: `apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx`:

```ts
describe('PlanReviewRenderer — todos rendering', () => {
  it('does not render the Steps section when todos is absent', () => {
    render(<InteractionItem interaction={interaction} />);
    expect(screen.queryByText(/Steps/i)).not.toBeInTheDocument();
  });

  it('renders a Steps section with one row per todo when present', () => {
    const withTodos = {
      ...interaction,
      todos: [
        { content: 'first step', status: 'pending' as const },
        { content: 'second step', status: 'in_progress' as const },
        { content: 'third step', status: 'completed' as const },
      ],
    };
    render(<InteractionItem interaction={withTodos} />);
    expect(screen.getByText(/Steps/)).toBeInTheDocument();
    expect(screen.getByText('first step')).toBeInTheDocument();
    expect(screen.getByText('second step')).toBeInTheDocument();
    expect(screen.getByText('third step')).toBeInTheDocument();
  });

  it('shows a "Show all N steps" toggle when more than 8 todos are present', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      content: `step ${i + 1}`,
      status: 'pending' as const,
    }));
    render(<InteractionItem interaction={{ ...interaction, todos: many }} />);

    // First 8 visible, 9-12 hidden
    expect(screen.getByText('step 1')).toBeInTheDocument();
    expect(screen.getByText('step 8')).toBeInTheDocument();
    expect(screen.queryByText('step 9')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Show all 12 steps/i));

    expect(screen.getByText('step 12')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter desktop test -- PlanReviewRenderer
```

Expected: the three new tests FAIL with `Unable to find an element with the text: /Steps/` or similar.

- [ ] **Step 3: Implement the Steps section**

Open `apps/desktop/src/features/chat/InteractionItem.tsx`. Inside `PlanReviewRenderer` (currently at line 375), find the `useState` block (lines 384-388) and add:

```tsx
const [showAllTodos, setShowAllTodos] = useState(false);
```

Find the existing `textarea` (around line 513-519). Insert the following block **immediately before** it:

```tsx
{interaction.todos && interaction.todos.length > 0 && (
  <div className="flex flex-col gap-1 mt-1">
    <span className="text-[11px] font-medium text-muted-foreground">Steps</span>
    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
      {(showAllTodos ? interaction.todos : interaction.todos.slice(0, 8)).map((todo, idx) => (
        <div key={idx} className="flex items-start gap-2 text-xs">
          <span className="flex-shrink-0 mt-0.5">
            {todo.status === 'completed' ? (
              <CheckCircle2 size={12} className="text-success" />
            ) : todo.status === 'in_progress' ? (
              <Loader2 size={12} className="animate-spin text-primary" />
            ) : todo.status === 'cancelled' ? (
              <Square size={12} className="text-muted-foreground/60" />
            ) : (
              <Square size={12} className="text-muted-foreground" />
            )}
          </span>
          <span
            className={
              todo.status === 'completed' ? 'text-muted-foreground line-through' :
              todo.status === 'cancelled' ? 'text-muted-foreground/70 line-through' :
              'text-foreground'
            }
          >
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
        {showAllTodos ? 'Show fewer steps' : `Show all ${interaction.todos.length} steps`}
      </button>
    )}
  </div>
)}
```

`CheckCircle2`, `Loader2`, `Square` are already imported at the top of the file (line 2).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter desktop test -- PlanReviewRenderer
```

Expected: PASS — all existing tests still green plus the three new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/chat/InteractionItem.tsx apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx
git commit -m "feat(chat): render todos in PlanReviewRenderer"
```

---

## Task 6: `PlanReviewRenderer` client-synth branch

**Files:**
- Modify: `apps/desktop/src/features/chat/InteractionItem.tsx:375-563`
- Test: `apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx`. Add a shared mock for `ChatActionsContext` and three test cases:

```ts
import { ChatActionsProvider } from '../ChatActionsContext';

const handleSendMessage = vi.fn();
const setMode = vi.fn();

function renderWithActions(ui: React.ReactNode) {
  return render(
    <ChatActionsProvider value={{ handleSendMessage, setMode }}>
      {ui}
    </ChatActionsProvider>,
  );
}

const synthInteraction: PlanReviewInteractionMessage = {
  ...interaction,
  source: 'client_synth',
};

beforeEach(() => {
  handleSendMessage.mockReset();
  handleSendMessage.mockResolvedValue(undefined);
  setMode.mockReset();
});

describe('PlanReviewRenderer — client_synth', () => {
  it('on Approve: sets mode to default and sends "Proceed with the plan above."', async () => {
    renderWithActions(<InteractionItem interaction={synthInteraction} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => {
      expect(setMode).toHaveBeenCalledWith('session-1', 'default');
      expect(handleSendMessage).toHaveBeenCalledWith(
        'Proceed with the plan above.',
        undefined,
        'default',
      );
    });
    // does NOT send interaction_response
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('on Deny with empty feedback: sends the default deny message and keeps mode', async () => {
    renderWithActions(<InteractionItem interaction={synthInteraction} />);
    fireEvent.click(screen.getByRole('button', { name: /^deny$/i }));
    await waitFor(() => {
      expect(handleSendMessage).toHaveBeenCalledWith('Please revise the plan.');
    });
    expect(setMode).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('on Deny with feedback: sends the feedback text', async () => {
    renderWithActions(<InteractionItem interaction={synthInteraction} />);
    const textarea = screen.getByPlaceholderText(/comment/i);
    fireEvent.change(textarea, { target: { value: 'add the test step please' } });
    fireEvent.click(screen.getByRole('button', { name: /^deny$/i }));
    await waitFor(() => {
      expect(handleSendMessage).toHaveBeenCalledWith('add the test step please');
    });
  });

  it('on Save as Issue: saves locally and sends "Saved as issue #N for later."', async () => {
    createIssue.mockResolvedValue({
      id: 'iss-7',
      projectId: mockProjectId,
      title: 'Refactor auth',
      description: synthInteraction.plan,
      status: 'open',
      priority: 'medium',
      labels: ['actionable'],
      createdAt: 0,
      updatedAt: 0,
    });
    renderWithActions(<InteractionItem interaction={synthInteraction} />);
    fireEvent.click(screen.getByRole('button', { name: /save as issue/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(handleSendMessage).toHaveBeenCalledWith('Saved as issue #iss-7 for later.');
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('on Approve when handleSendMessage rejects: reverts mode and decision state', async () => {
    handleSendMessage.mockRejectedValueOnce(new Error('network down'));
    renderWithActions(<InteractionItem interaction={synthInteraction} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => {
      // mode was switched to 'default' then back to 'plan'
      expect(setMode).toHaveBeenNthCalledWith(1, 'session-1', 'default');
      expect(setMode).toHaveBeenNthCalledWith(2, 'session-1', 'plan');
    });
    // decision card reverts — Approve button visible again
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });
});

describe('PlanReviewRenderer — tool_call regression', () => {
  it('on Approve: still sends interaction_response (not handleSendMessage)', () => {
    renderWithActions(<InteractionItem interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'interaction_response',
      interactionId: 'i-1',
      sessionId: 'session-1',
      response: { approved: true, feedback: undefined },
    });
    expect(handleSendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter desktop test -- PlanReviewRenderer
```

Expected: the new client_synth tests FAIL because the handlers don't branch yet; the regression test should PASS.

- [ ] **Step 3: Branch the handlers**

Open `apps/desktop/src/features/chat/InteractionItem.tsx`. At the top of the file, add the import:

```tsx
import { useChatActionsOptional } from './ChatActionsContext';
```

Inside `PlanReviewRenderer` (line 375), add **above** the existing `handleApprove`:

```tsx
const ALLOW_MESSAGE = 'Proceed with the plan above.';
const DEFAULT_DENY_MESSAGE = 'Please revise the plan.';

const chatActions = useChatActionsOptional();
const isClientSynth = interaction.source === 'client_synth';
```

Then replace the three handlers (`handleApprove`, `handleDeny`, `handleSaveAsIssue` — currently lines 390-444) with the branched versions:

```tsx
const handleApprove = useCallback(async () => {
  if (isClientSynth && chatActions && interaction.sessionId) {
    const trimmed = feedback.trim();
    const text = trimmed ? `${ALLOW_MESSAGE}\n\n${trimmed}` : ALLOW_MESSAGE;
    chatActions.setMode(interaction.sessionId, 'default');
    setDecision({ kind: 'approved' });
    try {
      await chatActions.handleSendMessage(text, undefined, 'default');
    } catch (err) {
      setDecision(null);
      chatActions.setMode(interaction.sessionId, 'plan');
      console.error('[PlanReviewRenderer] Approve send failed', err);
    }
    return;
  }
  sendMessage({
    type: 'interaction_response',
    interactionId: interaction.interactionId,
    sessionId: interaction.sessionId,
    response: { approved: true, feedback: feedback.trim() || undefined },
  });
  setDecision({ kind: 'approved' });
}, [isClientSynth, chatActions, interaction, feedback, sendMessage]);

const handleDeny = useCallback(async () => {
  if (isClientSynth && chatActions && interaction.sessionId) {
    const text = feedback.trim() || DEFAULT_DENY_MESSAGE;
    setDecision({ kind: 'rejected' });
    try {
      await chatActions.handleSendMessage(text);
    } catch (err) {
      setDecision(null);
      console.error('[PlanReviewRenderer] Deny send failed', err);
    }
    return;
  }
  sendMessage({
    type: 'interaction_response',
    interactionId: interaction.interactionId,
    sessionId: interaction.sessionId,
    response: { approved: false, feedback: feedback.trim() || undefined },
  });
  setDecision({ kind: 'rejected' });
}, [isClientSynth, chatActions, interaction, feedback, sendMessage]);

const handleSaveAsIssue = useCallback(
  async (title: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const projectId = useProjectStore
        .getState()
        .sessions.find((s) => s.id === interaction.sessionId)?.projectId;
      if (!projectId) {
        throw new Error('Could not resolve project for this session');
      }
      const issue = await createIssue(projectId, {
        title,
        description: interaction.plan,
        labels: [ACTIONABLE_LABEL],
      });
      const savedMessage = `Saved as issue #${issue.id} for later.`;
      if (isClientSynth && chatActions) {
        await chatActions.handleSendMessage(savedMessage);
      } else {
        sendMessage({
          type: 'interaction_response',
          interactionId: interaction.interactionId,
          sessionId: interaction.sessionId,
          response: { approved: false, feedback: savedMessage },
        });
      }
      setDecision({ kind: 'saved', issueId: issue.id });
      setDialogOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  },
  [isClientSynth, chatActions, createIssue, sendMessage, interaction.sessionId, interaction.interactionId, interaction.plan],
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter desktop test -- PlanReviewRenderer
```

Expected: PASS — both client_synth and tool_call regression cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/chat/InteractionItem.tsx apps/desktop/src/features/chat/__tests__/PlanReviewRenderer.test.tsx
git commit -m "feat(chat): branch PlanReviewRenderer handlers on interaction.source"
```

---

## Task 7: Cursor plan synthesiser

**Files:**
- Modify: `apps/desktop/src/services/message-handlers/run-messages.ts:148-159`
- Test: `apps/desktop/src/features/chat/__tests__/cursorPlanSynthesis.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `apps/desktop/src/features/chat/__tests__/cursorPlanSynthesis.test.tsx`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from '../../../stores/chatStore';
import { useInteractionStore } from '../../../stores/interactionStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useServerStore } from '../../../stores/serverStore';
import { handleRunMessage } from '../../../services/message-handlers/run-messages';
import type { MessageDispatchContext } from '../../../services/message-handlers/types';

function setupCursorSession() {
  useChatStore.setState({
    activeRuns: { 'run-1': 'session-1' },
    runHealth: {},
    activeToolCalls: {},
    toolCallsHistory: {},
    runContentBlocks: {},
  } as Partial<ReturnType<typeof useChatStore.getState>> as any);

  useProjectStore.setState({
    sessions: [{
      id: 'session-1',
      projectId: 'p-1',
      providerId: 'prov-cursor',
      type: 'regular',
      createdAt: 0,
      updatedAt: 0,
    }],
    providers: [{
      id: 'prov-cursor',
      name: 'Cursor',
      type: 'cursor',
      createdAt: 0,
      updatedAt: 0,
    }],
  } as any);

  useInteractionStore.setState({ interactions: {} } as any);
}

function setupClaudeSession() {
  useChatStore.setState({
    activeRuns: { 'run-1': 'session-1' },
    runHealth: {},
    activeToolCalls: {},
    toolCallsHistory: {},
    runContentBlocks: {},
  } as any);

  useProjectStore.setState({
    sessions: [{
      id: 'session-1',
      projectId: 'p-1',
      providerId: 'prov-claude',
      type: 'regular',
      createdAt: 0,
      updatedAt: 0,
    }],
    providers: [{
      id: 'prov-claude',
      name: 'Claude',
      type: 'claude',
      createdAt: 0,
      updatedAt: 0,
    }],
  } as any);

  useInteractionStore.setState({ interactions: {} } as any);
}

const mockCtx: MessageDispatchContext = {
  serverId: 'srv-1',
  backendId: null,
  serverRunsRef: new Map([['srv-1', new Set(['run-1'])]]),
  resolveBackendName: () => 'local',
  logTag: 'test',
  isStaleRunEvent: () => false,
  isRunEventGap: () => false,
  recoverRunGap: vi.fn(),
  recordTerminalRun: vi.fn(),
  clearRunActivity: vi.fn(),
  clearRunSeq: vi.fn(),
  clearTerminalRunSeq: vi.fn(),
};

describe('Cursor plan synthesiser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useServerStore.setState({ activeServerId: 'srv-1' } as any);
  });

  it('synthesises an interaction_plan_review on cursor tool_use with plan_proposal semantic', () => {
    setupCursorSession();

    handleRunMessage({
      type: 'tool_use',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      toolUseId: 'tool-abc',
      toolName: 'createPlan',
      semantic: 'plan_proposal',
      toolInput: {
        plan: '# Cursor plan',
        todos: [
          { id: 't1', content: 'step one', status: 'TODO_STATUS_PENDING' },
          { id: 't2', content: 'step two', status: 'TODO_STATUS_IN_PROGRESS' },
        ],
      },
    } as any, mockCtx);

    const interaction = useInteractionStore.getState().interactions['tool-abc'];
    expect(interaction).toBeDefined();
    expect(interaction.type).toBe('interaction_plan_review');
    expect((interaction as any).source).toBe('client_synth');
    expect((interaction as any).plan).toBe('# Cursor plan');
    expect((interaction as any).todos).toEqual([
      { content: 'step one', status: 'pending' },
      { content: 'step two', status: 'in_progress' },
    ]);
  });

  it('does not synthesise for Claude provider sessions', () => {
    setupClaudeSession();

    handleRunMessage({
      type: 'tool_use',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      toolUseId: 'tool-xyz',
      toolName: 'ExitPlanMode',
      semantic: 'plan_proposal',
      toolInput: { plan: '# Claude plan' },
    } as any, mockCtx);

    expect(useInteractionStore.getState().interactions['tool-xyz']).toBeUndefined();
  });

  it('does not synthesise for non-plan_proposal tools even on cursor sessions', () => {
    setupCursorSession();

    handleRunMessage({
      type: 'tool_use',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      toolUseId: 'tool-edit',
      toolName: 'Edit',
      semantic: undefined,
      toolInput: { file_path: '/x', old_string: 'a', new_string: 'b' },
    } as any, mockCtx);

    expect(useInteractionStore.getState().interactions['tool-edit']).toBeUndefined();
  });
});
```

> Note: the `handleRunMessage` export name might differ — check `run-messages.ts` for the actual export. Adapt the import accordingly. If the handler is wrapped (e.g. returned from a factory), call it through that wrapper.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter desktop test -- cursorPlanSynthesis
```

Expected: the first test FAILS (no interaction inserted); the other two PASS by accident (nothing happens for the wrong-provider / wrong-semantic cases, and they assert nothing happens).

- [ ] **Step 3: Implement the synthesiser**

Open `apps/desktop/src/services/message-handlers/run-messages.ts`. At the top, add the imports:

```ts
import { useInteractionStore } from '../../stores/interactionStore';   // may already be imported
import { extractPlanPayload } from '../../features/chat/planReviewPayload';
import type { PlanReviewInteractionMessage } from '@my-claudia/shared';
```

(`useInteractionStore` is already imported at line 4 — verify and don't duplicate.)

Inside the `case 'tool_use':` block (line 148), after `addToolCall` and `addToolUseBlock` are called (line 154), add:

```ts
if (msg.semantic === 'plan_proposal') {
  maybeSynthesizeCursorPlanReview(toolSession, msg.toolUseId, msg.toolInput);
}
```

At the bottom of the file (outside the switch but inside the module), add the helper:

```ts
function maybeSynthesizeCursorPlanReview(
  sessionId: string,
  toolUseId: string,
  toolInput: unknown,
): void {
  // Look up the session's provider type. Only synthesize for Cursor.
  const projectState = useProjectStore.getState();
  const session = projectState.sessions.find((s) => s.id === sessionId);
  if (!session?.providerId) return;
  const provider = projectState.providers.find((p) => p.id === session.providerId);
  if (provider?.type !== 'cursor') return;

  // Do not overwrite an existing interaction for this tool (idempotency).
  if (useInteractionStore.getState().interactions[toolUseId]) return;

  const { planContent, todos } = extractPlanPayload(toolInput);
  const interaction: PlanReviewInteractionMessage = {
    type: 'interaction_plan_review',
    interactionId: toolUseId,
    sessionId,
    source: 'client_synth',
    createdAt: Date.now(),
    plan: planContent,
    todos,
  };
  useInteractionStore.getState().upsertInteraction(interaction);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter desktop test -- cursorPlanSynthesis
```

Expected: all three tests PASS.

- [ ] **Step 5: Run the broader test suite for regressions**

```bash
pnpm --filter desktop test -- run-messages PlanReviewRenderer ToolCallItem
```

Expected: PASS. If any pre-existing tool_use test breaks (e.g. asserting only `addToolCall` was called), inspect — synthesis shouldn't trigger for non-cursor sessions in those tests, but watch for setups missing a providers field.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/services/message-handlers/run-messages.ts apps/desktop/src/features/chat/__tests__/cursorPlanSynthesis.test.tsx
git commit -m "feat(chat): synthesise interaction_plan_review for cursor createPlan"
```

---

## Task 8: Cleanup — delete `PlanProposalActions` and switch tool-call plan branch to `extractPlanPayload`

**Files:**
- Modify: `apps/desktop/src/features/chat/tool-call/PlanContent.tsx:73-110`
- Modify: `apps/desktop/src/features/chat/tool-call/ToolExpandedContent.tsx:197-241`
- Modify: `apps/desktop/src/features/chat/__tests__/ToolCallItem.test.tsx` (if any test imports the deleted symbols)

- [ ] **Step 1: Confirm `setPendingPrefill` has no other plan-specific consumers**

```bash
grep -rn 'setPendingPrefill\|pendingPrefills\|clearPendingPrefill\|EXECUTE_PLAN_PREFILL' apps/desktop/src
```

Inspect output. Expected references:
- `PlanContent.tsx` lines (about to be deleted)
- `ChatInputArea.tsx` — generic consumer, KEEP (other features may inject prefills)
- `chatStore.ts` — store action, KEEP (other features may use it)
- `__tests__/ToolCallItem.test.tsx` — test of the old button, will be deleted

If any other production consumer exists (other than `ChatInputArea` reading the store and `chatStore` defining it), document it and decide whether to keep the action. Default: keep the store action, only remove the plan-specific call site.

- [ ] **Step 2: Delete `PlanProposalActions` and `EXECUTE_PLAN_PREFILL`**

Open `apps/desktop/src/features/chat/tool-call/PlanContent.tsx`. Delete:
- The `EXECUTE_PLAN_PREFILL` constant (line 73)
- The entire `PlanProposalActions` function (lines 79-108)
- `PlanProposalActions` and `EXECUTE_PLAN_PREFILL` from the export at line 110

Resulting export:

```ts
export { PlanContent, PLAN_PREVIEW_LINES };
```

Also remove the now-unused imports at the top of the file:
- `Play` from `lucide-react`
- `useChatStore`, `ToolCallState` (if only used by `PlanProposalActions`)
- `useSelectionStore`

Run:

```bash
pnpm --filter desktop typecheck
```

This will surface every place that imported the deleted symbols.

- [ ] **Step 3: Replace `<PlanProposalActions>` and inline plan extraction in `ToolExpandedContent`**

Open `apps/desktop/src/features/chat/tool-call/ToolExpandedContent.tsx:197`. The current `isPlanProposalTool(...)` branch (lines 197-241) contains the inline plan extraction (lines 199-219) and a `<PlanProposalActions status={status} />` call (line 226).

Replace the whole block with:

```tsx
if (isPlanProposalTool(toolName, semantic)) {
  const { planContent } = extractPlanPayload(toolInput);
  return (
    <div className="px-3 pb-3 border-t border-border/50">
      <div className="mt-2">
        <PlanContent content={planContent} />
      </div>
      {status !== 'running' && result !== undefined && (
        <div className="mt-2">
          <pre
            data-testid="tool-result"
            className={`text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${
              isError ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-foreground'
            }`}
          >
            {formatToolResult(result)}
          </pre>
        </div>
      )}
    </div>
  );
}
```

At the top of the file, change the imports:

```tsx
import { PlanContent } from './PlanContent';   // drop PlanProposalActions
import { extractPlanPayload } from '../planReviewPayload';
```

- [ ] **Step 4: Update or delete the "Execute plan" tests**

Search for tests that reference the old behaviour:

```bash
grep -rn 'EXECUTE_PLAN_PREFILL\|Execute plan\|setPendingPrefill.*plan\|PlanProposalActions' apps/desktop/src
```

For each hit:
- Inside a test file → delete the test (the button no longer exists). The Cursor plan flow is covered by `cursorPlanSynthesis.test.tsx` and `PlanReviewRenderer.test.tsx`.
- Inside production code → there should be none after step 2-3. If any remain, finish the deletion.

`apps/desktop/src/features/chat/__tests__/ToolCallItem.test.tsx:1032-1053` contains tests for the "Execute plan" button. Delete those test blocks.

- [ ] **Step 5: Run the desktop test suite**

```bash
pnpm --filter desktop test -- ToolCallItem ToolExpandedContent PlanReviewRenderer cursorPlanSynthesis planReviewPayload
```

Expected: PASS. If a ToolCallItem test fails because it expected the old "Execute plan" prefill, delete that test (it's the same one removed in step 4 — re-check).

- [ ] **Step 6: Run a broader typecheck and unit smoke**

```bash
pnpm --filter desktop typecheck && pnpm --filter desktop test
```

Expected: PASS for the whole suite (modulo any pre-existing unrelated failures).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/features/chat/tool-call/PlanContent.tsx \
        apps/desktop/src/features/chat/tool-call/ToolExpandedContent.tsx \
        apps/desktop/src/features/chat/__tests__/ToolCallItem.test.tsx
git commit -m "refactor(chat): drop PlanProposalActions in favor of synthesised interaction"
```

---

## Task 9: Manual end-to-end verification

**Files:** none — runs the app

- [ ] **Step 1: Start the desktop dev environment**

```bash
pnpm dev
```

(or `pnpm desktop:dev` + `pnpm server:dev` if the combined command does not exist in this branch).

- [ ] **Step 2: Cursor — Approve path**

In the app:

1. Create or select a session whose provider type is `cursor`.
2. Switch the mode dropdown to `plan`.
3. Send a message such as `"Plan the steps to add a logout button to the settings page."`.
4. Wait for `createPlan` to appear.

Verify:
- The tool-call card is **replaced** by a `PlanReviewRenderer` card (the rounded card with ClipboardCheck icon).
- The plan markdown is visible.
- If `todos` was emitted, the Steps section appears below the markdown with a status icon per row.
- Click **Approve Plan**.
- The conversation continues with a new user message `"Proceed with the plan above."`.
- The mode selector flips to `default`.

- [ ] **Step 3: Cursor — Deny with feedback path**

Repeat steps 1-3 above. When the card appears:
- Type `"add an OAuth refresh test before the logout button work"` into the feedback textarea.
- Click **Deny**.

Verify:
- The card collapses to a "Plan Rejected" chip.
- A new user message appears with the exact feedback text.
- The mode selector stays on `plan`.

- [ ] **Step 4: Cursor — Save as Issue path**

Repeat steps 1-3. When the card appears:
- Click **Save as Issue**.
- Accept the default title in the dialog.
- Click **Save**.

Verify:
- The card collapses to "Saved as issue #N".
- A new user message appears: `"Saved as issue #N for later."`.
- The local issues store now contains an issue with the plan as its description.

- [ ] **Step 5: Claude regression — Approve path**

In the app:

1. Select a session whose provider type is `claude`.
2. Switch mode to `plan`.
3. Trigger `ExitPlanMode` (ask Claude to plan something).
4. When the card appears, click **Approve**.

Verify:
- Behaviour is unchanged from before this change: the tool resolves on the server side, the assistant continues.
- No `handleSendMessage` was called (visible in DevTools network: no new `run_start` message is sent on Approve — server handles it).

- [ ] **Step 6: Document and commit verification notes (optional)**

If anything unexpected happens, file a follow-up. No commit on success.

---

## Self-Review

Run this checklist against the spec ([`docs/design/plan-decision-card-design.md`](./plan-decision-card-design.md)).

- ✅ **§Wire / store types** — Task 1.
- ✅ **§Cursor synthesis** — Task 7.
- ✅ **§Plan payload extraction helper** — Task 2.
- ✅ **§PlanReviewRenderer extension — todos** — Task 5.
- ✅ **§PlanReviewRenderer extension — handler branching** — Task 6.
- ✅ **§Removal of PlanProposalActions** — Task 8.
- ✅ **§Testing strategy — unit, component, integration** — Tasks 2/5/6/7 cover all enumerated tests.
- ✅ **§Edge cases E1-E10** — covered implicitly by the handler logic + the synthesiser short-circuits; explicit E5 (send failure) has its own test in Task 6.
- ✅ **§Implementation order steps 1-9** — Tasks 1-9 align 1:1 with spec steps.

Placeholder/red-flag scan:
- No "TBD" or "implement later" in code blocks.
- Every code block shows full content the engineer needs to copy.
- Every test includes the exact `pnpm` command and expected outcome.

Type consistency check:
- `PlanTodoItem.status` values: `'pending' | 'in_progress' | 'completed' | 'cancelled'` — consistent across Task 1 (shared type), Task 2 (helper return), Task 5 (renderer status check), Task 7 (test data).
- `extractPlanPayload` return shape `{ planContent: string; todos?: PlanTodoItem[] }` — consistent across Task 2 (definition), Task 7 (synthesiser consumer), Task 8 (tool-call branch consumer).
- `handleSendMessage` signature `(content, attachments?, overrideMode?)` — consistent across Task 3 (definition), Task 4 (context type), Task 6 (renderer call site).
- `ChatActionsContextValue.setMode` signature `(sessionId, mode)` — consistent across Task 4 and Task 6.
- `interaction.source` values `'tool_call' | 'client_synth'` — consistent across Task 1, Task 6, Task 7.
