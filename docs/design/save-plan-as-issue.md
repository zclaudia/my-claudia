# Save Plan as Issue (待动工 Backlog)

**Status:** Draft
**Date:** 2026-05-20
**Owner:** @zhvala

## Context

When Claude Code presents a plan via the plan-review interaction, the my-claudia UI currently offers only two responses:

- **Approve** — start implementing immediately.
- **Deny** (with optional feedback) — reject and rework.

This forces a binary choice. Often a plan looks fine but the user is not ready to implement it *right now*. They may want to batch the work, do something else first, or simply keep the proposal as a follow-up. Today the only way to preserve such a plan is external (copy/paste, screenshot, separate doc) — friction that frequently causes good plans to be discarded.

This spec adds a third option: **save the plan as a Local Issue** so it survives the current session and can be picked up later.

## Goals

1. **Don't lose useful plans.** Persist plan markdown plus a user-confirmed title as a Local Issue.
2. **Filterable and recognizable.** Mark these issues with a reserved label `actionable` so the user can filter the issue list to "things ready to execute" and see an at-a-glance badge.
3. **Decouple from current session.** Saving stops the current plan review (auto-deny) so the agent can move on.
4. **Minimal blast radius.** No `LocalIssue` schema changes. No new domain. Reuse existing CRUD, UI, and stores.

## Non-Goals (deferred)

- **Resuming a saved plan** (button to start a new session bootstrapped from this plan) — separate future discussion.
- **Storing source-session / permissions metadata** on the issue — kept simple for v1.
- **Letting the user choose priority or extra labels** in the save dialog — fixed defaults in v1.
- **Enforcement of `actionable` as a system-only label** — users may freely add it to manually created issues; the label is shared semantics ("ready to execute"), not gated by source.

## Design

### Data model

Reuse `LocalIssue` as defined in `shared/src/features/local-issue.ts`. **No schema changes.**

| Field | Value when saved from a plan |
|---|---|
| `title` | User-edited; default derived from plan markdown (see *Title extraction* below) |
| `description` | Full plan markdown, as received in the `PlanReviewInteractionMessage` |
| `labels` | `['actionable']` |
| `status` | `'open'` |
| `priority` | `'medium'` (fixed in v1, not user-configurable) |

Add a single constant for the reserved label:

```ts
// shared/src/features/local-issue.ts
export const ACTIONABLE_LABEL = 'actionable';
```

### Title extraction

Helper added to `shared/src/features/local-issue.ts`:

```ts
extractDefaultTitleFromPlan(planMarkdown: string): string
```

Logic:
1. First `# ` or `## ` heading text → use it (trimmed)
2. Else first non-empty trimmed line, truncated to ~80 chars
3. Else fallback `"Plan from <ISO timestamp>"`

### Plan-review response type

The plan-review request type is `PlanReviewInteractionMessage` in `shared/src/interaction/forms.ts:95`. Responses currently flow through the generic `InteractionResponseMessage` (same file, line 102), whose `response` field is an untyped `Record<string, unknown>`.

Introduce a typed shape for plan-review responses (exported alongside `PlanReviewInteractionMessage`):

```ts
export type PlanReviewResponse =
  | { kind: 'approve' }
  | { kind: 'deny'; feedback?: string }
  | { kind: 'saveAsIssue'; title: string };
```

Existing client/server code that handles `approve`/`deny` continues to work because the wire shape is still `Record<string, unknown>`; the type is for new code paths and gradual tightening.

Server handling for `saveAsIssue`:
1. Create a `LocalIssue` using the data-model table above. Plan markdown comes from server-side state (the same string used to render the review), not the client payload — the client only sends `title`.
2. Resolve the plan-review interaction as **deny**, with a system-generated feedback string like `"Saved as issue #N for later."` so the agent sees a recognizable signal in its conversation history.
3. Emit a result event/response to the UI containing the created issue ID so the client can render the terminal state and link.

### UX flow

Component: `PlanReviewRenderer` inside `apps/desktop/src/features/chat/InteractionItem.tsx` (current renderer lives around lines 376–468).

Add a third button next to Approve / Deny — proposed label **"保存为待办"** (English: "Save as Issue"). Final wording is a minor decision left to implementation.

Click flow:

1. Open a lightweight modal dialog with a **single Title input** (pre-filled with the extracted default, editable).
2. Buttons: `保存` / `取消`.
3. `取消` → close dialog only; plan review remains in its original pending state.
4. `保存` → send `saveAsIssue` response with `{ title }`. On success:
   - Plan review collapses into a terminal state showing **"denied — saved as issue #N"** with a link to the issue.
   - Toast: **"已保存到待办 #N"**.
5. `保存` failure (e.g., DB error) → toast error; plan review stays pending; agent **not** denied (user can retry or pick Approve/Deny).

A dedicated small component `SavePlanAsIssueDialog.tsx` is recommended for separation, but inlining inside `PlanReviewRenderer` is acceptable if simpler.

### UI affordances for `actionable` issues

In `apps/desktop/src/features/local-issues/`:

1. **List items**: leading icon (▶ or ⚡ — TBD) when `labels.includes('actionable')`.
2. **Filter chip**: add a "可动工" toggle in `LocalIssuesPanel.tsx` filter row. Toggling filters the list to issues whose `labels` contain `actionable`.
3. **Detail view**: same icon next to the title.

These affordances apply uniformly to any issue carrying the label, including manually labelled ones (consistent with the non-goal note about not gating the label).

## Files to touch

| File | Change |
|---|---|
| `shared/src/features/local-issue.ts` | Add `ACTIONABLE_LABEL` constant; add `extractDefaultTitleFromPlan()` helper. |
| `shared/src/interaction/forms.ts` | Export new `PlanReviewResponse` union with `approve` / `deny` / `saveAsIssue` variants. |
| `server/src/application/conversation/interactions/interaction-tools.ts` | Handle `saveAsIssue`: create `LocalIssue` via existing local-issues domain, then resolve interaction as deny. |
| `server/src/domains/local-issues/` | No changes expected; existing CRUD suffices. |
| `apps/desktop/src/features/chat/InteractionItem.tsx` (`PlanReviewRenderer`) | Add third button + save-dialog wiring. |
| `apps/desktop/src/features/chat/SavePlanAsIssueDialog.tsx` *(new, optional)* | Dialog component with the Title input. |
| `apps/desktop/src/features/local-issues/LocalIssuesPanel.tsx` | "可动工" filter chip; list-item badge. |
| `apps/desktop/src/features/local-issues/` (detail view) | Badge next to title. |

## Verification

### Manual smoke test (golden path)

1. `pnpm dev` to start gateway + server + desktop.
2. In a chat session, drive Claude into plan mode and wait for the plan-review interaction.
3. Click **"保存为待办"** — dialog opens with an extracted default title.
4. Edit the title, click `保存`.
5. Confirm:
   - Toast appears with the issue link.
   - Plan review collapses into the "denied — saved as issue #N" terminal state.
   - Local Issues panel shows the new issue.
   - The issue carries the `actionable` label and visible badge.
6. Toggle the **"可动工"** filter chip → only `actionable` issues appear.
7. Open the issue → `description` contains the full plan markdown.

### Edge cases

- Plan markdown with no headings → title default falls back to first non-empty line.
- Plan markdown blank/whitespace → title default falls back to timestamp form.
- Cancel dialog → plan review unaffected; Approve/Deny still available.
- Save fails (e.g., DB error) → toast error; plan review remains pending; agent not stopped.
- Repeated saves of the *same* plan are allowed (no dedup in v1); each click creates a fresh issue.

### Lint / type / tests

- `pnpm typecheck` clean.
- `pnpm lint` clean.
- Unit test the `extractDefaultTitleFromPlan` helper (heading / first-line / fallback cases).
- E2E coverage for the new save flow is **not** required in v1; manual smoke test is sufficient.

## Open items (do not block v1)

- Final wording for the third button (中文 / English).
- Final glyph for the `actionable` badge (▶ vs ⚡ vs other).
- Whether the dialog opens as a centered modal or a side sheet (default: centered modal).
- Long-term: convert `actionable` into a richer "ready-to-execute" surface, e.g., an "Open in new session" button on issue detail. Tracked as a follow-up discussion.
