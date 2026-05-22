# OpenSpec × Supervisor — Phase G6: Polish & Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten three deferred items from G5b so the OpenSpec UI is actually usable end-to-end:
1. **Issue list-by-project endpoint** — without this the issue list lands empty for new users (Critical).
2. **Markdown preview + validation feedback** — replace raw textarea editing with split-view preview; surface archive validation errors in the UI as actionable hints.
3. **Legacy badges + anonymous management** — flag pre-OpenSpec Classic Change / Meta Workflow records as `[Legacy]`; add a settings panel to bulk-close anonymous issues.

**Architecture:** Pure additions on top of G1-G5b. One new REST endpoint + one new IssueLifecycle method. One reusable `MarkdownPreview` component (wraps `react-markdown` already in deps). Validation errors flow up via existing `ArchiveResult.validationErrors` — just need UI rendering. Legacy badge + anonymous management are small UI additions.

**Tech Stack:** TypeScript strict, React, vitest + RTL, `react-markdown` (already on `apps/desktop/package.json` line 49), `remark-gfm` for tables/strikethrough.

**Spec reference:**
- `docs/design/openspec-integration-v2.zh-CN.md` §10 (UI surfaces — preview was implied but unspecified), §11 G6 acceptance (prompt + validation polish), §13.1 (anonymous management).
- G5b plan's "Deliberately does not cover" table.

**Phase predecessors:**
- All G1-G5b tags (latest `openspec/phase-g5b-complete`, commit `df889fc7`)

---

## File Structure

```
server/src/domains/issue-orchestration/
├── issue-lifecycle.ts                                                MODIFY (+ listByProject)
├── routes.ts                                                         MODIFY (+ GET /issues)
└── __tests__/routes.test.ts                                          MODIFY (+ list test)

apps/desktop/src/features/openspec/
├── api.ts                                                            MODIFY (+ listIssues helper)
├── view-state.ts                                                     MODIFY (+ previewMode flag)
├── store.ts                                                          MODIFY (+ patchView toggle)
├── components/
│   ├── IssueListScreen.tsx                                           MODIFY (autoload via listIssues)
│   ├── MarkdownPreview.tsx                                           NEW (reusable react-markdown wrapper)
│   ├── SubIssueDetailScreen.tsx                                      MODIFY (split-view toggle + preview)
│   ├── ArchiveConfirmDialog.tsx                                      MODIFY (show validation errors)
│   ├── AnonymousManagementPanel.tsx                                  NEW
│   └── OpenSpecPanel.tsx                                             MODIFY (route 'anonymous-management' screen)
└── __tests__/
    ├── MarkdownPreview.test.tsx                                      NEW
    ├── AnonymousManagementPanel.test.tsx                             NEW
    ├── IssueListScreen.test.tsx                                      MODIFY (autoload test)
    └── ArchiveConfirmDialog.test.tsx                                 NEW (validation error display)

apps/desktop/src/features/supervision/components/
├── ChangeWorkspacePanel.tsx (or wherever Classic ProjectChange details render)  MODIFY (add Legacy badge)
└── meta-workflow/components/MetaWorkflowPanel.tsx                    MODIFY (Legacy banner when run has no spec_change_id)
```

6 tasks total.

```
Task 1 — GET /api/issues endpoint + IssueListScreen autoload          ← independent (Critical)
Task 2 — MarkdownPreview component + split-view in SpecChange tabs    ← independent
Task 3 — Validation errors surfaced in ArchiveConfirmDialog           ← independent
Task 4 — Legacy badges on Classic / Meta panels                       ← independent
Task 5 — Anonymous management panel                                   ← needs T1
Task 6 — Smoke + tag                                                  ← final
```

---

## Task 1: `GET /api/issues?projectId=...` endpoint + autoload

**Files:**
- Modify: `server/src/domains/issue-orchestration/issue-lifecycle.ts` (+ `listByProject`)
- Modify: `server/src/domains/issue-orchestration/routes.ts` (+ GET /issues)
- Modify: `server/src/domains/issue-orchestration/__tests__/routes.test.ts` (+ list test)
- Modify: `apps/desktop/src/features/openspec/api.ts` (+ `listIssues`)
- Modify: `apps/desktop/src/features/openspec/components/IssueListScreen.tsx` (call on mount)
- Modify: `apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx` (autoload test)

**Goal:** Issue list page loads everything for a project on mount instead of relying on user-driven cache builds.

- [ ] **Step 1: Add `listByProject` to IssueLifecycle**

In `server/src/domains/issue-orchestration/issue-lifecycle.ts`, near the existing `listSubIssues` method, add:

```typescript
/** List all issues (features + sub-issues, anonymous included) for a project, newest first. */
listByProject(projectId: string): LocalIssue[] {
  const rows = this.deps.db.prepare(
    `SELECT * FROM local_issues WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC`,
  ).all(projectId);
  return rows.map((r) => this.issueRepo.mapRow(r));
}
```

- [ ] **Step 2: Add route**

In `server/src/domains/issue-orchestration/routes.ts`, add a new GET handler **before** the existing `router.get('/:id', ...)` (otherwise the param matches "" and consumes the route):

```typescript
router.get('/', (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
  res.json({ issues: deps.lifecycle.listByProject(projectId) });
});
```

> **Important**: Express resolves `/` against the mount prefix, so this becomes `GET /api/issues`. The `/:id` route must remain AFTER this line to prevent it shadowing — current `routes.ts` puts `/:id` later, so just slot the new handler near the top of the router setup.

- [ ] **Step 3: Test the route**

Add to `routes.test.ts`:

```typescript
it('GET /api/issues lists all issues for a project, newest first', async () => {
  const a = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'A' });
  // small delay to ensure created_at ordering is distinct
  await new Promise((resolve) => setTimeout(resolve, 5));
  const b = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'B' });
  const res = await request(app).get('/api/issues?projectId=proj-1');
  expect(res.status).toBe(200);
  expect(res.body.issues.map((i: { id: string }) => i.id)).toEqual([b.body.issue.id, a.body.issue.id]);
});

it('GET /api/issues without projectId returns 400', async () => {
  const res = await request(app).get('/api/issues');
  expect(res.status).toBe(400);
});
```

- [ ] **Step 4: Add `listIssues` client helper**

In `apps/desktop/src/features/openspec/api.ts`, near the other issue helpers, add:

```typescript
export async function listIssues(projectId: string): Promise<LocalIssue[]> {
  const body = await apiCall<{ issues: LocalIssue[] }>(`/api/issues?projectId=${encodeURIComponent(projectId)}`);
  return body.issues;
}
```

- [ ] **Step 5: Wire autoload in IssueListScreen**

Replace the placeholder `useEffect(() => { void listSubIssues; }, [])` (added in G5b T7) with a real fetch:

```typescript
import { listIssues } from '../api.js';

// inside the component:
const setIssues = useOpenSpecStore((s) => s.setIssues);

useEffect(() => {
  let cancelled = false;
  listIssues(projectId)
    .then((rows) => { if (!cancelled) setIssues(projectId, rows); })
    .catch((e) => console.error('[openspec] listIssues failed', e));
  return () => { cancelled = true; };
}, [projectId, setIssues]);
```

Remove the now-unused `listSubIssues` import.

- [ ] **Step 6: Add autoload test**

In `IssueListScreen.test.tsx`, add at the bottom:

```typescript
it('calls listIssues on mount and populates store', async () => {
  const spy = vi.spyOn(api, 'listIssues').mockResolvedValue([
    mkIssue({ id: 'autoload-1', title: 'Loaded From Server' }),
  ] as never);
  render(<IssueListScreen projectId="p1" />);
  await waitFor(() => expect(spy).toHaveBeenCalledWith('p1'));
  await waitFor(() => expect(screen.getByText('Loaded From Server')).toBeInTheDocument());
});
```

- [ ] **Step 7: Verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/issue-orchestration/__tests__/routes.test.ts
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/IssueListScreen.test.tsx
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add server/src/domains/issue-orchestration/issue-lifecycle.ts \
        server/src/domains/issue-orchestration/routes.ts \
        server/src/domains/issue-orchestration/__tests__/routes.test.ts \
        apps/desktop/src/features/openspec/api.ts \
        apps/desktop/src/features/openspec/components/IssueListScreen.tsx \
        apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx
git commit -m "feat(openspec): GET /api/issues list-by-project + autoload in IssueListScreen"
```

---

## Task 2: `MarkdownPreview` component + split-view in SpecChange tabs

**Files:**
- Create: `apps/desktop/src/features/openspec/components/MarkdownPreview.tsx`
- Create: `apps/desktop/src/features/openspec/__tests__/MarkdownPreview.test.tsx`
- Modify: `apps/desktop/src/features/openspec/view-state.ts` (+ `previewMode` flag)
- Modify: `apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx` (add Edit/Preview/Split toggle to artifact tabs)

**Goal:** Markdown content gets a preview pane; user can choose Edit-only, Preview-only, or Split.

- [ ] **Step 1: Create `MarkdownPreview.tsx`**

```typescript
// apps/desktop/src/features/openspec/components/MarkdownPreview.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
  className?: string;
}

/**
 * Wraps react-markdown with theme-token styling. Used in SpecChange artifact
 * tabs. Renders Requirement / Scenario blocks (which are h3 / h4 in OpenSpec
 * format) with distinct styling.
 */
export function MarkdownPreview({ content, className = '' }: Props): React.ReactElement {
  return (
    <div className={`prose prose-sm max-w-none text-foreground ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-semibold mb-3 mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2 border-b border-border pb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h3>,
          h4: ({ children }) => <h4 className="text-xs font-medium mt-2 mb-1 text-muted-foreground uppercase tracking-wide">{children}</h4>,
          p: ({ children }) => <p className="text-sm mb-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="text-sm list-disc pl-5 space-y-0.5 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="text-sm list-decimal pl-5 space-y-0.5 mb-2">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ children, className: cls }) => {
            const isBlock = (cls ?? '').includes('language-');
            return isBlock
              ? <code className="block bg-muted px-2 py-1 rounded text-xs font-mono overflow-x-auto">{children}</code>
              : <code className="px-1 py-0.5 bg-muted rounded text-xs font-mono">{children}</code>;
          },
          pre: ({ children }) => <pre className="bg-muted p-2 rounded text-xs font-mono overflow-x-auto mb-2">{children}</pre>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          a: ({ href, children }) => <a href={href} className="text-primary hover:underline" target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: Create tests**

```typescript
// apps/desktop/src/features/openspec/__tests__/MarkdownPreview.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownPreview } from '../components/MarkdownPreview.js';

describe('MarkdownPreview', () => {
  it('renders headings with custom classes', () => {
    render(<MarkdownPreview content={`# H1\n## H2\n### Requirement: Login\n#### Scenario: x`} />);
    expect(screen.getByText('H1')).toBeInTheDocument();
    expect(screen.getByText(/Requirement: Login/)).toBeInTheDocument();
    expect(screen.getByText(/Scenario: x/)).toBeInTheDocument();
  });

  it('renders lists', () => {
    render(<MarkdownPreview content={`- Item 1\n- Item 2`} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('renders inline code', () => {
    render(<MarkdownPreview content="See \`apiCall\` helper." />);
    expect(screen.getByText('apiCall')).toBeInTheDocument();
  });

  it('empty content renders without crashing', () => {
    render(<MarkdownPreview content="" />);
    // No assertion — just ensure render didn't throw.
    expect(true).toBe(true);
  });

  it('renders **bold** as strong', () => {
    render(<MarkdownPreview content="this is **important** text" />);
    expect(screen.getByText('important').tagName).toBe('STRONG');
  });
});
```

- [ ] **Step 3: Extend view-state with `previewMode`**

```typescript
// apps/desktop/src/features/openspec/view-state.ts

// inside OpenSpecViewState:
/** Editor/preview mode for artifact tabs. */
previewMode: 'edit' | 'preview' | 'split';

// inside INITIAL_VIEW_STATE:
previewMode: 'edit',
```

- [ ] **Step 4: Add toggle + preview to `SpecChangeArtifactTabs`**

In `SubIssueDetailScreen.tsx`, locate the `SpecChangeArtifactTabs` body. Add:

```tsx
import { MarkdownPreview } from './MarkdownPreview.js';

// near the top of SpecChangeArtifactTabs body:
const previewMode = useOpenSpecStore((s) => s.viewByProject[projectId]?.previewMode ?? 'edit');

// Replace the existing render of the textarea + Save/Reload buttons section.
// Add a small toggle above the editor:

<div className="px-3 py-2 border-b border-border flex items-center gap-1">
  {(['edit', 'split', 'preview'] as const).map((m) => (
    <button
      key={m}
      className={`px-2 py-0.5 text-xs rounded-md ${previewMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'}`}
      onClick={() => patchView(projectId, { previewMode: m })}
    >
      {m}
    </button>
  ))}
</div>

// Replace the textarea-only block with:
<div className="p-3 space-y-2">
  {loading ? (
    <div className="text-sm text-muted-foreground">Loading…</div>
  ) : (
    <>
      <div className={`grid gap-3 ${previewMode === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {previewMode !== 'preview' && (
          <textarea
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono min-h-[240px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        )}
        {previewMode !== 'edit' && (
          <div className="border border-border rounded-md px-3 py-2 min-h-[240px] overflow-auto bg-muted/30">
            <MarkdownPreview content={content || '_empty_'} />
          </div>
        )}
      </div>
      {/* Save/Reload row unchanged from G5b */}
    </>
  )}
</div>
```

- [ ] **Step 5: Add test for preview toggle**

Append to `SubIssueDetailScreen.test.tsx`:

```typescript
it('toggle between edit / split / preview modes', async () => {
  // Set up issue + spec_change + mocked artifact read
  useOpenSpecStore.setState({
    issuesByProject: { p1: [mkIssue({ id: 's' })] },
    specChangesById: { sc1: { id: 'sc1', slug: 'x', status: 'drafting', deltaSpecPaths: [] } as never },
    viewByProject: { p1: { ...INITIAL_VIEW_STATE, previewMode: 'edit' } },
  } as never);
  vi.spyOn(api, 'getSpecChange').mockResolvedValue({ id: 'sc1', slug: 'x', status: 'drafting', deltaSpecPaths: [] } as never);
  vi.spyOn(api, 'listExecutors').mockResolvedValue([]);
  vi.spyOn(api, 'readProposal').mockResolvedValue('# Hello');

  render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
  await screen.findByText('Save');

  fireEvent.click(screen.getByRole('button', { name: 'split' }));
  expect(useOpenSpecStore.getState().viewByProject.p1.previewMode).toBe('split');

  fireEvent.click(screen.getByRole('button', { name: 'preview' }));
  expect(useOpenSpecStore.getState().viewByProject.p1.previewMode).toBe('preview');
  // In preview mode the editor textarea should not render
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
```

> The test must import `INITIAL_VIEW_STATE` from `../view-state.js`.

- [ ] **Step 6: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/MarkdownPreview.test.tsx src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 5 new + (existing 8) = 13 SubIssueDetail tests + 5 MarkdownPreview tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/features/openspec/components/MarkdownPreview.tsx \
        apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx \
        apps/desktop/src/features/openspec/view-state.ts \
        apps/desktop/src/features/openspec/__tests__/MarkdownPreview.test.tsx \
        apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
git commit -m "feat(openspec-ui): MarkdownPreview + edit/split/preview toggle in artifact tabs"
```

---

## Task 3: Validation errors surfaced in `ArchiveConfirmDialog`

**Files:**
- Modify: `apps/desktop/src/features/openspec/api.ts` (broaden `closeAndArchive` return type)
- Modify: `apps/desktop/src/features/openspec/components/ArchiveConfirmDialog.tsx` (render validation errors)
- Create: `apps/desktop/src/features/openspec/__tests__/ArchiveConfirmDialog.test.tsx`

**Goal:** When archive fails because of validation errors (e.g. ADDED requirement missing scenarios), the dialog shows them per-capability so the user knows what to fix.

- [ ] **Step 1: Tighten `closeAndArchive` return type**

In `apps/desktop/src/features/openspec/api.ts`:

```typescript
export interface ArchiveOutcome {
  ok: boolean;
  capabilities?: { capability: string; added: string[]; modified: string[]; removed: string[] }[];
  validationErrors?: { capability: string; issues: string[] }[];
  archivedDir?: string;
}

export async function closeAndArchive(id: string): Promise<{ issue: LocalIssue; archive?: ArchiveOutcome }> {
  return apiCall(`/api/issues/${id}/close-and-archive`, { method: 'POST', body: JSON.stringify({}) });
}
```

Update the existing helper to match the project's `apiCall` signature (positional path + options).

- [ ] **Step 2: Update `ArchiveConfirmDialog`**

Replace the existing `setResult(res.archive ?? { ok: true })` block. New behaviour:

```typescript
const [errors, setErrors] = useState<{ capability: string; issues: string[] }[]>([]);

// In onConfirm:
try {
  const res = await api.closeAndArchive(subIssueId);
  upsertIssue(res.issue);
  if (res.archive && res.archive.ok === false && res.archive.validationErrors?.length) {
    setErrors(res.archive.validationErrors);
    setResult(null);   // keep dialog open so user can read errors
  } else {
    setErrors([]);
    setResult(res.archive ?? { ok: true });
  }
} catch (e) {
  setError((e as Error).message);
}
```

Render section:

```tsx
{errors.length > 0 && (
  <div className="border border-red-500/30 bg-red-500/10 rounded-md p-3 text-sm">
    <div className="font-medium text-red-600 mb-2">Validation failed — fix these before archiving:</div>
    {errors.map((capErr) => (
      <div key={capErr.capability} className="mb-2 last:mb-0">
        <div className="text-xs font-mono">{capErr.capability}</div>
        <ul className="list-disc pl-5 mt-1 space-y-0.5 text-xs text-muted-foreground">
          {capErr.issues.map((i, idx) => <li key={idx}>{i}</li>)}
        </ul>
      </div>
    ))}
  </div>
)}
```

The "Close & Archive" button should re-enable when errors are present (so the user can retry after fixing):

```tsx
disabled={busy || !issue || result !== null}
// (remove any `errors.length > 0` gating — the user may have fixed things and want to retry)
```

- [ ] **Step 3: Add tests**

```typescript
// apps/desktop/src/features/openspec/__tests__/ArchiveConfirmDialog.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArchiveConfirmDialog } from '../components/ArchiveConfirmDialog.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkIssue() {
  return {
    id: 's', projectId: 'p1', title: 'X', status: 'reviewing', priority: 'medium', labels: [],
    type: 'implement', isAnonymous: false, specChangeId: 'sc1', createdAt: 0, updatedAt: 0,
  } as never;
}

describe('ArchiveConfirmDialog', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue()] },
      specChangesById: { sc1: { id: 'sc1', slug: 'x', deltaSpecPaths: ['openspec/changes/x/specs/auth/spec.md'] } as never },
      executorsBySpecChange: {}, corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders delta capability list', () => {
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    expect(screen.getByText('auth')).toBeInTheDocument();
  });

  it('successful archive shows confirmation + Done button', async () => {
    vi.spyOn(api, 'closeAndArchive').mockResolvedValue({
      issue: mkIssue(),
      archive: { ok: true, capabilities: [], archivedDir: '/tmp/archive' },
    } as never);
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close & Archive' }));
    await waitFor(() => expect(screen.getByText(/Archive complete/i)).toBeInTheDocument());
  });

  it('failed validation displays per-capability errors', async () => {
    vi.spyOn(api, 'closeAndArchive').mockResolvedValue({
      issue: mkIssue(),
      archive: { ok: false, validationErrors: [
        { capability: 'auth', issues: ['requirement[Login].scenario[Valid]: bodyLines empty', 'requirement[Login]: missing RFC keyword'] },
        { capability: 'billing', issues: ['delta is empty'] },
      ] },
    } as never);
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close & Archive' }));
    await waitFor(() => expect(screen.getByText(/Validation failed/)).toBeInTheDocument());
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('billing')).toBeInTheDocument();
    expect(screen.getByText(/bodyLines empty/)).toBeInTheDocument();
  });

  it('Close & Archive remains clickable after validation failure (user can retry)', async () => {
    vi.spyOn(api, 'closeAndArchive').mockResolvedValue({
      issue: mkIssue(),
      archive: { ok: false, validationErrors: [{ capability: 'auth', issues: ['x'] }] },
    } as never);
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close & Archive' }));
    await waitFor(() => expect(screen.getByText(/Validation failed/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Close & Archive' })).not.toBeDisabled();
  });
});
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/ArchiveConfirmDialog.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/openspec/api.ts \
        apps/desktop/src/features/openspec/components/ArchiveConfirmDialog.tsx \
        apps/desktop/src/features/openspec/__tests__/ArchiveConfirmDialog.test.tsx
git commit -m "feat(openspec-ui): surface archive validation errors in dialog"
```

---

## Task 4: Legacy badges on Classic / Meta panels

**Files:**
- Modify: `apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx` (badge in Classic tab header when active change has no OpenSpec link)
- Modify: `apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx` (banner in run-list when no spec_change link)

**Goal:** When a Classic ProjectChange or MetaWorkflowRun was created BEFORE OpenSpec integration (i.e., not driven through OpenSpec issue), show a small `[Legacy]` badge so the user knows they should be using OpenSpec for new work.

- [ ] **Step 1: Define "is legacy" heuristic**

For a Classic Change: a `ProjectChange` is "legacy" if no `executor_instances` row references it via `underlyingId`. Use a quick existence query.

For a Meta Workflow run: same heuristic — `meta_workflow_runs.id` not in `executor_instances.underlying_id`.

To avoid extra round-trips, expose this via simple endpoints in the existing executor REST routes:

```typescript
// In server/src/domains/executor/routes.ts, add at end:
router.get('/legacy-classic-change-ids', (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
  const rows = deps.db.prepare(
    `SELECT pc.id FROM project_changes pc
     WHERE pc.project_id = ?
       AND NOT EXISTS (SELECT 1 FROM executor_instances ei WHERE ei.underlying_id = pc.id AND ei.type = 'classic')`,
  ).all(projectId) as { id: string }[];
  res.json({ legacyIds: rows.map((r) => r.id) });
});

router.get('/legacy-meta-workflow-run-ids', (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
  const rows = deps.db.prepare(
    `SELECT mr.id FROM meta_workflow_runs mr
     WHERE mr.project_id = ?
       AND NOT EXISTS (SELECT 1 FROM executor_instances ei WHERE ei.underlying_id = mr.id AND ei.type = 'meta-workflow')`,
  ).all(projectId) as { id: string }[];
  res.json({ legacyIds: rows.map((r) => r.id) });
});
```

> `deps.db` must be in `ExecutorRoutesDeps`. Update the interface if it isn't already there.

- [ ] **Step 2: Client helpers in OpenSpec api.ts**

```typescript
export async function listLegacyClassicChangeIds(projectId: string): Promise<string[]> {
  const body = await apiCall<{ legacyIds: string[] }>(`/api/openspec/legacy-classic-change-ids?projectId=${projectId}`);
  return body.legacyIds;
}

export async function listLegacyMetaWorkflowRunIds(projectId: string): Promise<string[]> {
  const body = await apiCall<{ legacyIds: string[] }>(`/api/openspec/legacy-meta-workflow-run-ids?projectId=${projectId}`);
  return body.legacyIds;
}
```

- [ ] **Step 3: Add `<LegacyBadge>` micro-component**

Create `apps/desktop/src/features/openspec/components/LegacyBadge.tsx`:

```typescript
import React from 'react';

export function LegacyBadge(): React.ReactElement {
  return (
    <span
      className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-600 font-medium"
      title="Created before OpenSpec integration — new work should go through OpenSpec"
    >
      Legacy
    </span>
  );
}
```

- [ ] **Step 4: Wire into Supervisor + Meta panels**

In `SupervisorWorkspacePanel.tsx`: when the active change's ID is in the legacy set, render `<LegacyBadge />` next to the change title. Load the set on mount:

```typescript
import { listLegacyClassicChangeIds } from '../../openspec/api.js';
import { LegacyBadge } from '../../openspec/components/LegacyBadge.js';

const [legacyIds, setLegacyIds] = useState<Set<string>>(new Set());
useEffect(() => {
  listLegacyClassicChangeIds(projectId).then((ids) => setLegacyIds(new Set(ids))).catch(() => undefined);
}, [projectId]);

// Wherever the active change title is rendered, append: {legacyIds.has(activeChange?.id ?? '') && <LegacyBadge />}
```

For `MetaWorkflowPanel.tsx`: do the same with `listLegacyMetaWorkflowRunIds` and decorate each row in the run list.

- [ ] **Step 5: Quick test (optional, low value)**

Skip dedicated tests — these are tiny additions; the existing panel tests will still pass.

- [ ] **Step 6: Verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/executor/__tests__/routes.test.ts
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: tsc clean both sides; executor route tests still pass (existing tests untouched).

- [ ] **Step 7: Commit**

```bash
git add server/src/domains/executor/routes.ts \
        apps/desktop/src/features/openspec/api.ts \
        apps/desktop/src/features/openspec/components/LegacyBadge.tsx \
        apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx \
        apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx
git commit -m "feat(openspec): Legacy badges on Classic / Meta panels"
```

---

## Task 5: `AnonymousManagementPanel`

**Files:**
- Create: `apps/desktop/src/features/openspec/components/AnonymousManagementPanel.tsx`
- Create: `apps/desktop/src/features/openspec/__tests__/AnonymousManagementPanel.test.tsx`
- Modify: `apps/desktop/src/features/openspec/view-state.ts` (add 'anonymous-management' screen)
- Modify: `apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx` (route + entry button)
- Modify: `apps/desktop/src/features/openspec/components/IssueListScreen.tsx` (add "Manage Anonymous" link in the fold header)

**Goal:** A simple panel listing all `isAnonymous=true` issues with bulk-close action.

- [ ] **Step 1: Extend view-state**

In `view-state.ts`:

```typescript
export type OpenSpecScreen =
  | 'issues'
  | 'feature-detail'
  | 'sub-issue-detail'
  | 'corpus'
  | 'anonymous-management';
```

- [ ] **Step 2: Create panel**

```typescript
// apps/desktop/src/features/openspec/components/AnonymousManagementPanel.tsx
import React, { useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props { projectId: string }

export function AnonymousManagementPanel({ projectId }: Props): React.ReactElement {
  const anonymous = useOpenSpecStore((s) => (s.issuesByProject[projectId] ?? []).filter((i) => i.isAnonymous));
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const patchView = useOpenSpecStore((s) => s.patchView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllOpen = (): void => {
    setSelected(new Set(anonymous.filter((i) => i.status !== 'closed' && i.status !== 'cancelled').map((i) => i.id)));
  };

  const bulkCancel = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      for (const id of selected) {
        const issue = await api.transitionStatus(id, 'cancelled');
        upsertIssue(issue);
      }
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closedCount = anonymous.filter((i) => i.status === 'closed' || i.status === 'cancelled').length;
  const openCount = anonymous.length - closedCount;

  return (
    <div className="space-y-4 max-w-3xl">
      <nav className="text-sm text-muted-foreground">
        <button className="text-primary hover:underline" onClick={() => patchView(projectId, { screen: 'issues' })}>← Issues</button>
        <span className="mx-2">/</span>
        <span className="text-foreground font-medium">Manage Anonymous Issues</span>
      </nav>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Anonymous Issues</h3>
          <div className="text-xs text-muted-foreground mt-1">{openCount} open · {closedCount} closed/cancelled · {anonymous.length} total</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80" onClick={selectAllOpen}>Select all open</button>
          <button
            className="px-2.5 py-1.5 text-xs rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25 disabled:opacity-50"
            disabled={busy || selected.size === 0}
            onClick={() => void bulkCancel()}
          >
            Cancel selected ({selected.size})
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500">Error: {error}</div>}

      {anonymous.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-border rounded-md p-4 bg-muted/30 text-center">No anonymous issues.</div>
      ) : (
        <ul className="space-y-1.5">
          {anonymous.map((i) => (
            <li key={i.id} className="border border-border rounded-md p-2 bg-card flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(i.id)}
                onChange={() => toggle(i.id)}
                disabled={i.status === 'closed' || i.status === 'cancelled'}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{i.title}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(i.createdAt).toLocaleDateString()}</div>
              </div>
              <StatusBadge status={i.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Route in OpenSpecPanel**

```typescript
import { AnonymousManagementPanel } from './AnonymousManagementPanel.js';

// inside the screen switch:
if (view.screen === 'anonymous-management') {
  return <AnonymousManagementPanel projectId={projectId} />;
}
```

- [ ] **Step 4: Entry button in IssueListScreen**

In the anonymous fold header (the button that toggles `anonymousExpanded`), add a separate "Manage" link to the right when fold is expanded:

```tsx
{view?.anonymousExpanded && (
  <div className="px-3 py-1.5 text-right border-t border-border">
    <button
      className="text-xs text-primary hover:underline"
      onClick={() => patchView(projectId, { screen: 'anonymous-management' })}
    >
      Manage Anonymous Issues →
    </button>
  </div>
)}
```

- [ ] **Step 5: Tests**

```typescript
// apps/desktop/src/features/openspec/__tests__/AnonymousManagementPanel.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnonymousManagementPanel } from '../components/AnonymousManagementPanel.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkAnon(over: Partial<{ id: string; status: string; title: string }>) {
  return {
    id: over.id ?? 'a1', projectId: 'p1', title: over.title ?? 'A', status: over.status ?? 'open',
    priority: 'medium', labels: [], type: 'implement', isAnonymous: true,
    createdAt: 0, updatedAt: 0,
  } as never;
}

describe('AnonymousManagementPanel', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {}, specChangesById: {}, executorsBySpecChange: {},
      corpusByProject: {}, viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders empty state', () => {
    render(<AnonymousManagementPanel projectId="p1" />);
    expect(screen.getByText(/No anonymous issues/)).toBeInTheDocument();
  });

  it('lists anonymous issues with counts header', () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [
      mkAnon({ id: 'a1', status: 'open', title: 'A' }),
      mkAnon({ id: 'a2', status: 'closed', title: 'B' }),
    ] } } as never);
    render(<AnonymousManagementPanel projectId="p1" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText(/1 open · 1 closed/)).toBeInTheDocument();
  });

  it('Select all open ticks all non-closed checkboxes', () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [
      mkAnon({ id: 'a1', status: 'open' }),
      mkAnon({ id: 'a2', status: 'closed' }),
      mkAnon({ id: 'a3', status: 'open' }),
    ] } } as never);
    render(<AnonymousManagementPanel projectId="p1" />);
    fireEvent.click(screen.getByText(/Select all open/));
    const cancelBtn = screen.getByRole('button', { name: /Cancel selected/ });
    expect(cancelBtn.textContent).toContain('(2)');
  });

  it('Cancel selected calls transitionStatus for each picked', async () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [
      mkAnon({ id: 'a1', status: 'open' }),
      mkAnon({ id: 'a2', status: 'open' }),
    ] } } as never);
    const spy = vi.spyOn(api, 'transitionStatus').mockImplementation(async (id) => mkAnon({ id, status: 'cancelled' }));
    render(<AnonymousManagementPanel projectId="p1" />);
    fireEvent.click(screen.getByText(/Select all open/));
    fireEvent.click(screen.getByRole('button', { name: /Cancel selected/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenCalledWith('a1', 'cancelled');
    expect(spy).toHaveBeenCalledWith('a2', 'cancelled');
  });

  it('Cancel selected is disabled when nothing selected', () => {
    useOpenSpecStore.setState({ issuesByProject: { p1: [mkAnon({ id: 'a1' })] } } as never);
    render(<AnonymousManagementPanel projectId="p1" />);
    expect(screen.getByRole('button', { name: /Cancel selected/ })).toBeDisabled();
  });
});
```

- [ ] **Step 6: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/AnonymousManagementPanel.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: 5 tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/features/openspec/components/AnonymousManagementPanel.tsx \
        apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx \
        apps/desktop/src/features/openspec/components/IssueListScreen.tsx \
        apps/desktop/src/features/openspec/view-state.ts \
        apps/desktop/src/features/openspec/__tests__/AnonymousManagementPanel.test.tsx
git commit -m "feat(openspec-ui): AnonymousManagementPanel with bulk cancel"
```

---

## Task 6: Smoke + tag

- [ ] **Step 1: Build + full tests**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm build
pnpm --filter @my-claudia/server exec vitest run
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec
```

Expected: all clean.

- [ ] **Step 2: Manual smoke (quick)**

In the desktop app:
1. Open a project → Supervisor → OpenSpec tab → Issue list now auto-loads (verify with a project that already has issues)
2. Create a sub-issue → drill in → toggle Edit/Split/Preview on artifact tabs → see preview render
3. Try Close & Archive on a sub-issue whose delta is malformed (e.g. missing scenario) → see validation errors panel
4. From the anonymous fold → click "Manage Anonymous Issues →" → bulk cancel works
5. Open a legacy ProjectChange or MetaWorkflowRun → see `[Legacy]` badge

If all 5 work without console errors, smoke passes.

- [ ] **Step 3: Tag**

```bash
git tag -a openspec/phase-g6-complete -m "OpenSpec × Supervisor Phase G6 polish (list endpoint + markdown preview + validation errors + legacy badges + anonymous management) landed"
```

---

## Phase G6 Acceptance Criteria

- [ ] All 5 implementation tasks complete with individual commits.
- [ ] `pnpm build` passes both packages.
- [ ] G6 adds: 2 backend tests (route + autoload) + ~16 desktop tests (preview + dialog + management).
- [ ] Manual smoke (5 steps) passes.
- [ ] Tag `openspec/phase-g6-complete` exists.

---

## What Phase G6 Deliberately Does NOT Cover

| Item | Phase / Status |
|------|----------------|
| AI-drafted SpecChange artifacts (proposal/design/tasks/delta generation) | Separate phase (probably G7) — substantial work |
| WebSocket push for executor / issue status changes | Not yet scheduled — polling is acceptable |
| Drag-drop issue reordering | Out of scope for spec-driven workflow |
| Inline diff view for delta files | Possible future — current textarea + preview is enough |
| Search beyond type chips | Not yet needed at expected scale |

---

*Plan version: 1 / 2026-05-22*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` §11 G6 + G5b deferred items*
*Predecessors: G1 / G2 / G3 / G4 / G5a / G5b (latest `openspec/phase-g5b-complete`)*
