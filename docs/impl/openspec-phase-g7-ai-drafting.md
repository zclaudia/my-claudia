# OpenSpec × Supervisor — Phase G7: AI-Drafted SpecChange Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "user manually types raw OpenSpec markdown" experience with one-click AI drafting. Each of the 4 artifact tabs (proposal / design / tasks / delta-per-capability) gets a `✨ Draft with AI` button that asks the AI to write content from scratch using the sub-issue + project context.

**Architecture:** Mirrors G4's `AiExploreService` pattern. New `SpecChangeDraftingService` wraps the existing `aiRunPort`. 4 prompts, 4 service methods, 4 REST endpoints, 4 UI buttons. Each draft writes the file via the existing `SpecChangeService.write*` methods (auto-save) so refresh + reload paths just work. UI doesn't stream (text appears all at once when AI returns); selection-based "improve text" is out of scope (deferred).

**Tech Stack:** TypeScript strict, vitest + RTL, the existing `aiRunPort` bridge (`server/src/application/bootstrap/feature-domains.ts:metaWorkflowAiRunPort`), G5a routes + G5b UI.

**Spec reference:**
- `docs/design/openspec-integration-v2.zh-CN.md` §11 G6 (Prompt 优化) — G7 is the concrete realization.
- G6 plan's "Deliberately does NOT cover": AI drafting was deferred to G7.

**Phase predecessors:**
- G6 tag `openspec/phase-g6-complete`
- AI infrastructure: `metaWorkflowAiRunPort` + Meta Workflow E2a pattern

**Scope decisions (locked):**
- 4 artifacts only: proposal / design / tasks / delta-per-capability
- No "improve selected text" (selection UX + diff logic deferred)
- No streaming UX (whole response appears when AI returns; UX shows loading spinner)
- Auto-save AI output to disk (user can Reload or edit + Save to override)

---

## File Structure

```
server/src/domains/openspec/
├── spec-change-drafting-service.ts                                   NEW
├── routes/
│   └── spec-change-routes.ts                                         MODIFY (+ 4 draft POST routes)
├── index.ts                                                          MODIFY (+ export)
└── __tests__/
    ├── spec-change-drafting-service.test.ts                          NEW
    └── routes/spec-change-routes.test.ts                             MODIFY (+ draft tests)

server/src/application/bootstrap/
└── feature-domains.ts                                                MODIFY (wire SpecChangeDraftingService)

apps/desktop/src/features/openspec/
├── api.ts                                                            MODIFY (+ 4 draft* helpers)
├── components/
│   └── SubIssueDetailScreen.tsx                                      MODIFY (+ Draft with AI button per tab)
└── __tests__/
    └── SubIssueDetailScreen.test.tsx                                 MODIFY (+ draft button test)
```

5 tasks total.

```
Task 1 — SpecChangeDraftingService (service + 4 prompts)              ← independent
Task 2 — REST: 4 draft routes (POST under /spec-changes/:id/draft-*)  ← needs T1
Task 3 — Wire service into feature-domains + smoke route mount        ← needs T2
Task 4 — Desktop: api helpers + Draft button per artifact tab         ← needs T3
Task 5 — End-to-end smoke + tag                                       ← final
```

---

## Task 1: `SpecChangeDraftingService`

**Files:**
- Create: `server/src/domains/openspec/spec-change-drafting-service.ts`
- Create: `server/src/domains/openspec/__tests__/spec-change-drafting-service.test.ts`

**Goal:** A service with 4 methods, each:
1. Reads sub-issue (title + description) for context
2. Reads current spec_change artifacts (proposal/design that already exist provide context for downstream artifacts)
3. For delta: reads existing corpus capability (to ground the AI in current behavior)
4. Builds a prompt
5. Calls `aiRunPort.startVirtualRun`
6. Returns the drafted markdown content

The service **does not write to disk** — that's the route's job (Task 2) by calling existing `SpecChangeService.writeProposal/Design/Tasks/DeltaSpec`. Separating keeps the service pure and testable.

- [ ] **Step 1: Create the service**

```typescript
// server/src/domains/openspec/spec-change-drafting-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { AiRunPort } from '../meta-workflow/run-entities/subagent-run-entity.js';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';
import { LocalIssueRepository } from '../local-issues/repository.js';
import { parseSpec } from './markdown/spec-parser.js';

const OPENSPEC_DIR = 'openspec';

export interface SpecChangeDraftingServiceDeps {
  db: Database;
  aiRunPort: AiRunPort;
  getProjectRoot: (projectId: string) => string;
  timeoutMs?: number;
  providerId?: string;
}

export interface DraftResult {
  content: string;
  /** Raw AI response (for debugging / logging). */
  rawResponse: string;
}

export class SpecChangeDraftingService {
  private specChangeRepo: SpecChangeRepository;
  private issueRepo: LocalIssueRepository;

  constructor(private deps: SpecChangeDraftingServiceDeps) {
    this.specChangeRepo = new SpecChangeRepository(deps.db);
    this.issueRepo = new LocalIssueRepository(deps.db);
  }

  async draftProposal(specChangeId: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const prompt = buildProposalPrompt(ctx);
    return this.run(prompt, ctx.projectRoot);
  }

  async draftDesign(specChangeId: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const proposal = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'proposal.md');
    const prompt = buildDesignPrompt({ ...ctx, proposal });
    return this.run(prompt, ctx.projectRoot);
  }

  async draftTasks(specChangeId: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const design = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'design.md');
    const prompt = buildTasksPrompt({ ...ctx, design });
    return this.run(prompt, ctx.projectRoot);
  }

  async draftDelta(specChangeId: string, capability: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const proposal = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'proposal.md');
    const design = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'design.md');
    const corpusFile = path.join(ctx.projectRoot, OPENSPEC_DIR, 'specs', capability, 'spec.md');
    const existingCorpus = fs.existsSync(corpusFile)
      ? fs.readFileSync(corpusFile, 'utf-8')
      : null;
    const corpusSummary = existingCorpus ? summarizeCapability(existingCorpus) : '(capability does not yet exist in corpus)';
    const prompt = buildDeltaPrompt({ ...ctx, proposal, design, capability, corpusSummary });
    return this.run(prompt, ctx.projectRoot);
  }

  // ── Internals ──────────────────────────────────────────────────

  private loadContext(specChangeId: string): {
    specChangeId: string;
    projectId: string;
    projectRoot: string;
    slug: string;
    issueTitle: string;
    issueDescription: string | undefined;
    issueType: string;
  } {
    const sc = this.specChangeRepo.findById(specChangeId);
    if (!sc) throw new Error(`SpecChange not found: ${specChangeId}`);
    const issue = this.issueRepo.findById(sc.subIssueId);
    if (!issue) throw new Error(`Sub-issue not found for spec_change: ${sc.subIssueId}`);
    return {
      specChangeId: sc.id,
      projectId: sc.projectId,
      projectRoot: this.deps.getProjectRoot(sc.projectId),
      slug: sc.slug,
      issueTitle: issue.title,
      issueDescription: issue.description,
      issueType: issue.type,
    };
  }

  private readArtifactSafe(projectRoot: string, slug: string, name: 'proposal.md' | 'design.md' | 'tasks.md'): string {
    const file = path.join(projectRoot, OPENSPEC_DIR, 'changes', slug, name);
    if (!fs.existsSync(file)) return '(not yet written)';
    return fs.readFileSync(file, 'utf-8');
  }

  private async run(prompt: string, workingDirectory: string): Promise<DraftResult> {
    let collected = '';
    let resolved = false;
    const timeoutMs = this.deps.timeoutMs ?? 120_000;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, timeoutMs);
      this.deps.aiRunPort.startVirtualRun({
        input: prompt,
        workingDirectory,
        providerId: this.deps.providerId,
        onMessage: (m) => {
          if (m.content) collected += m.content;
          if (m.kind === 'run_completed' || m.kind === 'completed' || m.kind === 'final') {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(); }
          }
        },
      }).catch(() => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(); } });
    });

    const content = stripPreamble(collected);
    return { content, rawResponse: collected };
  }
}

// ── Prompt builders ───────────────────────────────────────────────

interface BaseCtx { issueTitle: string; issueDescription?: string; issueType: string; slug: string }

export function buildProposalPrompt(ctx: BaseCtx): string {
  return [
    `You are drafting a proposal.md for an OpenSpec change.`,
    ``,
    `# Sub-Issue`,
    `- Type: ${ctx.issueType}`,
    `- Title: ${ctx.issueTitle}`,
    ctx.issueDescription ? `- Description: ${ctx.issueDescription}` : `- Description: (none provided)`,
    `- Slug: ${ctx.slug}`,
    ``,
    `# Task`,
    `Draft a complete proposal.md in this exact structure:`,
    ``,
    `\`\`\`markdown`,
    `# Proposal: ${ctx.issueTitle}`,
    ``,
    `## Why`,
    `<one-paragraph motivation grounded in the sub-issue title + description>`,
    ``,
    `## What Changes`,
    `<bulleted list of user-visible or behavior-visible changes>`,
    ``,
    `## Impact`,
    `<who/what is affected; which capabilities are touched>`,
    ``,
    `## Out of Scope`,
    `<explicit non-goals>`,
    `\`\`\``,
    ``,
    `Output ONLY the markdown — no commentary, no code fences around it, no leading explanation.`,
  ].join('\n');
}

export function buildDesignPrompt(ctx: BaseCtx & { proposal: string }): string {
  return [
    `You are drafting design.md for an OpenSpec change, given the proposal.`,
    ``,
    `# Proposal context`,
    `\`\`\`markdown`,
    ctx.proposal,
    `\`\`\``,
    ``,
    `# Task`,
    `Draft a complete design.md in this structure:`,
    ``,
    `\`\`\`markdown`,
    `# Design: ${ctx.issueTitle}`,
    ``,
    `## Overview`,
    `<2-3 sentences technical summary>`,
    ``,
    `## Technical Approach`,
    `<concrete approach; data model changes; APIs; algorithms>`,
    ``,
    `## Risks`,
    `<known risks + mitigation per risk>`,
    ``,
    `## Testing Strategy`,
    `<unit / integration / manual test coverage>`,
    `\`\`\``,
    ``,
    `Output ONLY the markdown — no commentary, no outer code fence.`,
  ].join('\n');
}

export function buildTasksPrompt(ctx: BaseCtx & { design: string }): string {
  return [
    `You are drafting tasks.md for an OpenSpec change, given the design.`,
    ``,
    `# Design context`,
    `\`\`\`markdown`,
    ctx.design,
    `\`\`\``,
    ``,
    `# Task`,
    `Draft a complete tasks.md as a checklist. Each task should be a concrete actionable step (file to create/modify, test to write, command to run). Use this structure:`,
    ``,
    `\`\`\`markdown`,
    `# Tasks: ${ctx.issueTitle}`,
    ``,
    `- [ ] <Concrete task 1>`,
    `- [ ] <Concrete task 2>`,
    `- [ ] ...`,
    `\`\`\``,
    ``,
    `Aim for 4-10 tasks. Each should be implementable in 30 minutes or less. Output ONLY the markdown — no commentary.`,
  ].join('\n');
}

export function buildDeltaPrompt(ctx: BaseCtx & { proposal: string; design: string; capability: string; corpusSummary: string }): string {
  return [
    `You are drafting a delta spec for the capability "${ctx.capability}" in OpenSpec format.`,
    ``,
    `# Existing capability in corpus`,
    ctx.corpusSummary,
    ``,
    `# Proposal context`,
    `\`\`\`markdown`,
    ctx.proposal,
    `\`\`\``,
    ``,
    `# Design context`,
    `\`\`\`markdown`,
    ctx.design,
    `\`\`\``,
    ``,
    `# Task`,
    `Draft a delta spec describing how "${ctx.capability}" changes. Use OpenSpec's delta format with ADDED / MODIFIED / REMOVED sections. Each requirement must:`,
    `- Use the OpenSpec heading format: \`### Requirement: <name>\``,
    `- Have a body using MUST / SHOULD / SHALL / MAY (RFC 2119 keywords)`,
    `- Have at least one \`#### Scenario: <name>\` block with bulleted "- **WHEN** ..." / "- **THEN** ..." lines`,
    ``,
    `Structure:`,
    `\`\`\`markdown`,
    `## Purpose`,
    `<change-specific description of why this capability is being changed>`,
    ``,
    `## ADDED Requirements`,
    `### Requirement: <new requirement>`,
    `<body with RFC keyword>`,
    ``,
    `#### Scenario: <scenario name>`,
    `- **WHEN** ...`,
    `- **THEN** ...`,
    ``,
    `## MODIFIED Requirements`,
    `<only requirements that already exist in corpus and need behavior change>`,
    ``,
    `## REMOVED Requirements`,
    `- \`<existing requirement name to remove>\``,
    `\`\`\``,
    ``,
    `Only include section headers that have content (omit empty MODIFIED/REMOVED sections). Output ONLY the markdown — no commentary.`,
  ].join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────

function stripPreamble(raw: string): string {
  // AI sometimes wraps output in ```markdown ... ``` even when told not to.
  // Strip leading code-fence block if present.
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim() + '\n';
  return trimmed.endsWith('\n') ? trimmed : trimmed + '\n';
}

function summarizeCapability(corpusMarkdown: string): string {
  const parsed = parseSpec(corpusMarkdown);
  const lines: string[] = [`Capability: ${parsed.capability}`];
  if (parsed.purpose) lines.push(`Purpose: ${parsed.purpose}`);
  lines.push(`Existing requirements (${parsed.requirements.length}):`);
  for (const r of parsed.requirements) {
    lines.push(`- ${r.name}${r.scenarios.length > 0 ? ` (${r.scenarios.length} scenarios)` : ''}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/spec-change-drafting-service.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeDraftingService, buildProposalPrompt, buildDeltaPrompt } from '../spec-change-drafting-service.js';

function mkPort(reply: string) {
  return {
    async startVirtualRun(args: { onMessage?: (m: { kind: string; content?: string }) => void }) {
      args.onMessage?.({ kind: 'assistant', content: reply });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

describe('SpecChangeDraftingService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let specChangeId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('i', 'proj-1', 'Add 2FA support', 'Users need 2FA for login', 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(`INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('sc', 'proj-1', 'i', 'add-2fa', 'Add 2FA support', 'drafting',
           'openspec/changes/add-2fa/proposal.md',
           'openspec/changes/add-2fa/design.md',
           'openspec/changes/add-2fa/tasks.md',
           0, 0);
    specChangeId = 'sc';
    projectRoot = mkdtempSync(join(tmpdir(), 'draft-'));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('draftProposal includes issue title + description in the prompt', async () => {
    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: { input: string; onMessage?: (m: { kind: string; content?: string }) => void }) {
        capturedPrompt = args.input;
        args.onMessage?.({ kind: 'assistant', content: '# Proposal: Add 2FA support\n\n## Why\nUsers need this.\n' });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({ db, aiRunPort: port, getProjectRoot: () => projectRoot });
    const result = await svc.draftProposal(specChangeId);
    expect(capturedPrompt).toContain('Add 2FA support');
    expect(capturedPrompt).toContain('Users need 2FA for login');
    expect(result.content).toContain('# Proposal');
  });

  it('draftDesign reads proposal.md from disk and embeds it in prompt', async () => {
    const changeDir = join(projectRoot, 'openspec', 'changes', 'add-2fa');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\n## Why\nUser security.\n');

    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: { input: string; onMessage?: (m: { kind: string; content?: string }) => void }) {
        capturedPrompt = args.input;
        args.onMessage?.({ kind: 'assistant', content: '# Design\n' });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({ db, aiRunPort: port, getProjectRoot: () => projectRoot });
    await svc.draftDesign(specChangeId);
    expect(capturedPrompt).toContain('User security');
  });

  it('draftDelta summarizes existing corpus capability when present', async () => {
    const corpusDir = join(projectRoot, 'openspec', 'specs', 'auth');
    mkdirSync(corpusDir, { recursive: true });
    writeFileSync(join(corpusDir, 'spec.md'), `# auth Specification\n\n## Requirements\n\n### Requirement: Login\n\nMUST authenticate.\n\n#### Scenario: Valid\n- **WHEN** valid\n- **THEN** SHALL return token\n`);
    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: { input: string; onMessage?: (m: { kind: string; content?: string }) => void }) {
        capturedPrompt = args.input;
        args.onMessage?.({ kind: 'assistant', content: '## ADDED Requirements\n' });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({ db, aiRunPort: port, getProjectRoot: () => projectRoot });
    await svc.draftDelta(specChangeId, 'auth');
    expect(capturedPrompt).toContain('Existing requirements (1)');
    expect(capturedPrompt).toContain('- Login');
  });

  it('draftDelta tolerates missing corpus capability (new capability)', async () => {
    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: { input: string; onMessage?: (m: { kind: string; content?: string }) => void }) {
        capturedPrompt = args.input;
        args.onMessage?.({ kind: 'assistant', content: '## ADDED Requirements\n' });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({ db, aiRunPort: port, getProjectRoot: () => projectRoot });
    const result = await svc.draftDelta(specChangeId, 'new-cap');
    expect(capturedPrompt).toContain('capability does not yet exist in corpus');
    expect(result.content).toContain('ADDED');
  });

  it('strips outer code-fence wrapper if AI returns ```markdown ... ```', async () => {
    const port = mkPort('```markdown\n# wrapped\n\ncontent\n```\n');
    const svc = new SpecChangeDraftingService({ db, aiRunPort: port, getProjectRoot: () => projectRoot });
    const result = await svc.draftProposal(specChangeId);
    expect(result.content).toBe('# wrapped\n\ncontent\n');
  });

  it('throws when spec_change is unknown', async () => {
    const port = mkPort('');
    const svc = new SpecChangeDraftingService({ db, aiRunPort: port, getProjectRoot: () => projectRoot });
    await expect(svc.draftProposal('nope')).rejects.toThrow(/SpecChange not found/);
  });

  it('throws when sub-issue is missing (data integrity)', async () => {
    db.prepare(`DELETE FROM local_issues WHERE id = 'i'`).run();
    db.pragma('foreign_keys = OFF');
    // The FK on spec_changes.sub_issue_id is ON DELETE CASCADE, so it would have deleted sc too.
    // Reinsert spec_change without FK enforcement to test the service-level guard.
    db.prepare(`INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('orphan', 'proj-1', 'ghost', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    const port = mkPort('');
    const svc = new SpecChangeDraftingService({ db, aiRunPort: port, getProjectRoot: () => projectRoot });
    await expect(svc.draftProposal('orphan')).rejects.toThrow(/Sub-issue not found/);
  });

  it('buildProposalPrompt sanity', () => {
    const p = buildProposalPrompt({ issueTitle: 'X', issueDescription: 'Y', issueType: 'bug', slug: 'x' });
    expect(p).toMatch(/Title: X/);
    expect(p).toMatch(/Description: Y/);
    expect(p).toMatch(/bug/);
  });

  it('buildDeltaPrompt names the capability and includes corpus summary', () => {
    const p = buildDeltaPrompt({
      issueTitle: 'X', issueType: 'implement', slug: 'x',
      proposal: 'p', design: 'd', capability: 'billing', corpusSummary: 'Existing requirements (3):\n- a\n- b\n- c',
    });
    expect(p).toContain('billing');
    expect(p).toContain('Existing requirements (3)');
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/spec-change-drafting-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 9 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/spec-change-drafting-service.ts \
        server/src/domains/openspec/__tests__/spec-change-drafting-service.test.ts
git commit -m "feat(openspec): SpecChangeDraftingService — AI draft per artifact"
```

---

## Task 2: REST routes for the 4 draft endpoints

**Files:**
- Modify: `server/src/domains/openspec/routes/spec-change-routes.ts`
- Modify: `server/src/domains/openspec/__tests__/routes/spec-change-routes.test.ts`

**Goal:** Add 4 POST routes. Each calls the drafting service + the existing write API to auto-save the draft. Return the saved SpecChange (so client store updates).

Routes:
- `POST /api/openspec/spec-changes/:id/draft-proposal`
- `POST /api/openspec/spec-changes/:id/draft-design`
- `POST /api/openspec/spec-changes/:id/draft-tasks`
- `POST /api/openspec/spec-changes/:id/draft-delta/:capability`

Each returns `{ specChange: SpecChange, content: string }`.

- [ ] **Step 1: Extend `SpecChangeRoutesDeps`**

In `spec-change-routes.ts`, add the drafting service to the deps:

```typescript
import type { SpecChangeDraftingService } from '../spec-change-drafting-service.js';

export interface SpecChangeRoutesDeps {
  db: Database;
  specChangeService: SpecChangeService;
  draftingService: SpecChangeDraftingService;
}
```

- [ ] **Step 2: Add the 4 routes**

After the existing PUT handlers, add:

```typescript
const draftHandler = (kind: 'proposal' | 'design' | 'tasks') => async (req: Request, res: Response) => {
  try {
    const draft = kind === 'proposal' ? await deps.draftingService.draftProposal(req.params.id)
      : kind === 'design'  ? await deps.draftingService.draftDesign(req.params.id)
      : await deps.draftingService.draftTasks(req.params.id);
    const writer = kind === 'proposal' ? deps.specChangeService.writeProposal
      : kind === 'design'  ? deps.specChangeService.writeDesign
      : deps.specChangeService.writeTasks;
    const specChange = writer.call(deps.specChangeService, req.params.id, draft.content);
    res.json({ specChange, content: draft.content });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
};
router.post('/spec-changes/:id/draft-proposal', draftHandler('proposal'));
router.post('/spec-changes/:id/draft-design',   draftHandler('design'));
router.post('/spec-changes/:id/draft-tasks',    draftHandler('tasks'));

router.post('/spec-changes/:id/draft-delta/:capability', async (req: Request, res: Response) => {
  try {
    const draft = await deps.draftingService.draftDelta(req.params.id, req.params.capability);
    const specChange = deps.specChangeService.writeDeltaSpec(req.params.id, req.params.capability, draft.content);
    res.json({ specChange, content: draft.content });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
```

- [ ] **Step 3: Add tests**

Append to `spec-change-routes.test.ts`:

```typescript
describe('SpecChange draft routes', () => {
  it('POST /draft-proposal returns drafted content + saves to disk', async () => {
    // Mock drafting service via setup (need to reconstruct app with a stub)
    const draftingService = {
      draftProposal: vi.fn().mockResolvedValue({ content: '# Drafted Proposal\n', rawResponse: '' }),
      draftDesign:   vi.fn(),
      draftTasks:    vi.fn(),
      draftDelta:    vi.fn(),
    };
    const localApp = express();
    localApp.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc, draftingService: draftingService as never }));
    const res = await request(localApp).post(`/api/openspec/spec-changes/${specChangeId}/draft-proposal`).send({});
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('Drafted Proposal');
    expect(res.body.specChange.status).toBe('proposing');
    // verify written to disk
    const read = await request(localApp).get(`/api/openspec/spec-changes/${specChangeId}/proposal`);
    expect(read.text).toContain('Drafted Proposal');
  });

  it('POST /draft-delta/:capability writes the delta + tracks path', async () => {
    const draftingService = {
      draftProposal: vi.fn(), draftDesign: vi.fn(), draftTasks: vi.fn(),
      draftDelta: vi.fn().mockResolvedValue({ content: '## ADDED Requirements\n', rawResponse: '' }),
    };
    const localApp = express();
    localApp.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc, draftingService: draftingService as never }));
    const res = await request(localApp).post(`/api/openspec/spec-changes/${specChangeId}/draft-delta/auth`).send({});
    expect(res.status).toBe(200);
    expect(res.body.specChange.deltaSpecPaths).toContain('openspec/changes/x/specs/auth/spec.md');
    expect(draftingService.draftDelta).toHaveBeenCalledWith(specChangeId, 'auth');
  });

  it('POST /draft-* returns 400 when drafting service throws', async () => {
    const draftingService = {
      draftProposal: vi.fn().mockRejectedValue(new Error('boom')),
      draftDesign:   vi.fn(), draftTasks: vi.fn(), draftDelta: vi.fn(),
    };
    const localApp = express();
    localApp.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc, draftingService: draftingService as never }));
    const res = await request(localApp).post(`/api/openspec/spec-changes/${specChangeId}/draft-proposal`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boom/);
  });
});
```

The test setup must also be updated so the **outer** `beforeEach` provides a stub `draftingService` for the routes to construct without runtime errors. Easiest: add a top-level `const noopDrafting = { draftProposal: vi.fn(), draftDesign: vi.fn(), draftTasks: vi.fn(), draftDelta: vi.fn() } as never;` and pass it to `createSpecChangeRoutes({ ..., draftingService: noopDrafting })` in the existing `beforeEach`.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/routes/spec-change-routes.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: existing 7 tests still pass + 3 new = 10 green.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/openspec/routes/spec-change-routes.ts \
        server/src/domains/openspec/__tests__/routes/spec-change-routes.test.ts
git commit -m "feat(openspec): REST routes for AI draft (proposal/design/tasks/delta)"
```

---

## Task 3: Wire drafting service into feature-domains

**Files:**
- Modify: `server/src/domains/openspec/index.ts`
- Modify: `server/src/application/bootstrap/feature-domains.ts`

**Goal:** Construct `SpecChangeDraftingService` in bootstrap, wire it into the spec-change routes' deps.

- [ ] **Step 1: Re-export**

In `server/src/domains/openspec/index.ts`, add:

```typescript
export { SpecChangeDraftingService } from './spec-change-drafting-service.js';
export type { DraftResult } from './spec-change-drafting-service.js';
```

- [ ] **Step 2: Construct + wire**

In `server/src/application/bootstrap/feature-domains.ts`, after the existing G4 bootstrap services block:

```typescript
import { SpecChangeDraftingService } from '../../domains/openspec/index.js';

// ... after const bootstrapService / bootstrapReviewService:
const specChangeDraftingService = new SpecChangeDraftingService({
  db: opts.db,
  aiRunPort: metaWorkflowAiRunPort,
  getProjectRoot,
});
```

Then update the call to `createSpecChangeRoutes`:

```typescript
app.use('/api/openspec', authMiddleware, createSpecChangeRoutes({
  db: opts.db,
  specChangeService,
  draftingService: specChangeDraftingService,
}));
```

Expose `specChangeDraftingService` in the returned bag too (optional — for tests/diagnostics).

- [ ] **Step 3: Verify build + full server**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/server exec vitest run
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/index.ts \
        server/src/application/bootstrap/feature-domains.ts
git commit -m "feat(openspec): wire SpecChangeDraftingService into bootstrap + routes"
```

---

## Task 4: Desktop — api helpers + "Draft with AI" buttons

**Files:**
- Modify: `apps/desktop/src/features/openspec/api.ts` (+ 4 helpers)
- Modify: `apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx` (+ Draft button per tab)
- Modify: `apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx` (+ draft button test)

**Goal:** Each artifact tab gains a `✨ Draft with AI` button next to the existing `Save` / `Reload`. Click → POSTs to the draft route → response replaces textarea content + updates spec_change in store. Shows loading state during the call (AI may take 30-60s).

- [ ] **Step 1: Add 4 client helpers**

```typescript
// apps/desktop/src/features/openspec/api.ts

export interface DraftResponse {
  specChange: SpecChange;
  content: string;
}

export async function draftProposal(specChangeId: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(`/api/openspec/spec-changes/${specChangeId}/draft-proposal`, { method: 'POST', body: '{}' });
}

export async function draftDesign(specChangeId: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(`/api/openspec/spec-changes/${specChangeId}/draft-design`, { method: 'POST', body: '{}' });
}

export async function draftTasks(specChangeId: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(`/api/openspec/spec-changes/${specChangeId}/draft-tasks`, { method: 'POST', body: '{}' });
}

export async function draftDelta(specChangeId: string, capability: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(`/api/openspec/spec-changes/${specChangeId}/draft-delta/${encodeURIComponent(capability)}`, { method: 'POST', body: '{}' });
}
```

- [ ] **Step 2: Add Draft button in `SpecChangeArtifactTabs`**

Inside `SubIssueDetailScreen.tsx`'s `SpecChangeArtifactTabs` component, near the existing Save/Reload row, add:

```tsx
const [drafting, setDrafting] = useState(false);
const setSpecChange = useOpenSpecStore((s) => s.setSpecChange);

const doDraft = async (): Promise<void> => {
  setDrafting(true); setError(null);
  try {
    const result =
      activeTab === 'proposal' ? await api.draftProposal(specChangeId)
      : activeTab === 'design'  ? await api.draftDesign(specChangeId)
      : activeTab === 'tasks'   ? await api.draftTasks(specChangeId)
      : selectedCap             ? await api.draftDelta(specChangeId, selectedCap)
      : null;
    if (result) {
      setContent(result.content);
      setSpecChange(result.specChange);
    }
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setDrafting(false);
  }
};

// In the JSX, near the Save / Reload buttons (in the row after the textarea/preview grid):
<button
  className="px-2.5 py-1 text-xs rounded-md bg-purple-500/15 text-purple-600 hover:bg-purple-500/25 disabled:opacity-50"
  disabled={drafting || saving || (activeTab === 'delta' && !selectedCap)}
  onClick={() => void doDraft()}
  title={`Have AI draft this ${activeTab} from sub-issue context`}
>
  {drafting ? 'Drafting…' : '✨ Draft with AI'}
</button>
```

> Disable on delta tab when no capability selected (consistent with Save's existing rule).

- [ ] **Step 3: Add test**

In `SubIssueDetailScreen.test.tsx`, append inside the existing artifact-tabs describe:

```typescript
it('clicking "Draft with AI" calls draftProposal and replaces content', async () => {
  // Setup as in existing tab tests (mock getSpecChange + listExecutors + readProposal)
  vi.spyOn(api, 'getSpecChange').mockResolvedValue({ id: 'sc1', slug: 'x', status: 'drafting', deltaSpecPaths: [] } as never);
  vi.spyOn(api, 'listExecutors').mockResolvedValue([]);
  vi.spyOn(api, 'readProposal').mockResolvedValue('# Old skeleton');
  const draftSpy = vi.spyOn(api, 'draftProposal').mockResolvedValue({
    specChange: { id: 'sc1', slug: 'x', status: 'proposing', deltaSpecPaths: [] } as never,
    content: '# AI-Drafted Proposal\n\n## Why\nGenerated\n',
  });

  useOpenSpecStore.setState({
    issuesByProject: { p1: [mkIssue({ id: 's' })] },
    specChangesById: { sc1: { id: 'sc1', slug: 'x', status: 'drafting', deltaSpecPaths: [] } as never },
    viewByProject: { p1: { ...INITIAL_VIEW_STATE } },
  } as never);

  render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
  // Wait for proposal to load
  await waitFor(() => expect(screen.getByDisplayValue(/Old skeleton/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /Draft with AI/ }));
  await waitFor(() => expect(draftSpy).toHaveBeenCalledWith('sc1'));
  await waitFor(() => expect(screen.getByDisplayValue(/AI-Drafted/)).toBeInTheDocument());
});

it('Draft button is disabled while drafting', async () => {
  vi.spyOn(api, 'getSpecChange').mockResolvedValue({ id: 'sc1', slug: 'x', status: 'drafting', deltaSpecPaths: [] } as never);
  vi.spyOn(api, 'listExecutors').mockResolvedValue([]);
  vi.spyOn(api, 'readProposal').mockResolvedValue('');
  let resolveDraft: (v: { specChange: never; content: string }) => void;
  vi.spyOn(api, 'draftProposal').mockImplementation(() => new Promise((res) => { resolveDraft = res; }));

  useOpenSpecStore.setState({
    issuesByProject: { p1: [mkIssue({ id: 's' })] },
    specChangesById: { sc1: { id: 'sc1', slug: 'x', status: 'drafting', deltaSpecPaths: [] } as never },
    viewByProject: { p1: { ...INITIAL_VIEW_STATE } },
  } as never);

  render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
  await screen.findByRole('button', { name: /Draft with AI/ });

  fireEvent.click(screen.getByRole('button', { name: /Draft with AI/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Drafting…/ })).toBeDisabled());

  // unblock
  resolveDraft!({ specChange: { id: 'sc1' } as never, content: 'x' });
  await waitFor(() => expect(screen.getByRole('button', { name: /Draft with AI/ })).toBeInTheDocument());
});
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
pnpm --filter @my-claudia/desktop exec tsc --noEmit
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/openspec/api.ts \
        apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx \
        apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
git commit -m "feat(openspec-ui): Draft with AI button on each artifact tab"
```

---

## Task 5: End-to-end smoke + tag

- [ ] **Step 1: Build + tests**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm build
pnpm --filter @my-claudia/server exec vitest run
pnpm --filter @my-claudia/desktop exec vitest run src/features/openspec
```

Expected: all green.

- [ ] **Step 2: Programmatic HTTP smoke**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import { mkdtempSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { applyMigrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { SpecChangeService, SpecChangeDraftingService } from './server/dist/domains/openspec/index.js';
import { createSpecChangeRoutes } from './server/dist/domains/openspec/routes/spec-change-routes.js';
import { createIssueRoutes } from './server/dist/domains/issue-orchestration/routes.js';
import { IssueLifecycle, AnonymousIssueService } from './server/dist/domains/issue-orchestration/index.js';
import { EventDispatcher } from './server/dist/domains/supervision/event-dispatcher.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
applyMigrations(db);
const root = mkdtempSync(join(tmpdir(), 'g7-smoke-'));
db.prepare(\"INSERT INTO projects (id, name, type, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)\").run('proj-1','P','code', root, 0, 0);

// Mock AI port returning a canned proposal
const fakePort = {
  startVirtualRun: async (a) => {
    a.onMessage?.({ kind: 'assistant', content: '# Proposal: Smoke test\n\n## Why\nAI drafted this.\n' });
    a.onMessage?.({ kind: 'run_completed' });
  },
};

const sc = new SpecChangeService({ db, getProjectRoot: () => root });
const drafting = new SpecChangeDraftingService({ db, aiRunPort: fakePort, getProjectRoot: () => root });
const dispatcher = new EventDispatcher();
const lifecycle = new IssueLifecycle({ db, specChangeService: sc, dispatcher });
const anon = new AnonymousIssueService(lifecycle);

const app = express();
app.use(express.json());
app.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: sc, draftingService: drafting }));
app.use('/api/issues', createIssueRoutes({ lifecycle, anonymousService: anon }));

const server = app.listen(0, async () => {
  const port = server.address().port;
  const base = \`http://127.0.0.1:\${port}\`;
  const post = async (p, body) => (await (await fetch(\`\${base}\${p}\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());

  // 1. Create anonymous sub-issue → has spec_change
  const created = await post('/api/issues/anonymous', { projectId: 'proj-1', title: 'AI draft smoke' });
  const scId = created.specChange.id;
  console.log('1. created sub-issue + spec_change', scId);

  // 2. Draft proposal via AI
  const drafted = await post(\`/api/openspec/spec-changes/\${scId}/draft-proposal\`, {});
  if (!drafted.content?.includes('AI drafted')) { console.error('Draft missing content'); process.exit(1); }
  console.log('2. drafted proposal:', drafted.content.split('\\n')[0]);

  // 3. Verify saved to disk
  const file = join(root, 'openspec', 'changes', drafted.specChange.slug, 'proposal.md');
  if (!fs.readFileSync(file, 'utf-8').includes('AI drafted')) { console.error('Not saved'); process.exit(1); }

  console.log('OpenSpec G7 smoke: PASS — AI drafts proposal + auto-saves');
  server.close();
  process.exit(0);
});
"
```

Expected output: `OpenSpec G7 smoke: PASS — AI drafts proposal + auto-saves`.

- [ ] **Step 3: Tag**

```bash
git tag -a openspec/phase-g7-complete -m "OpenSpec × Supervisor Phase G7 AI-drafted SpecChange artifacts landed"
```

---

## Phase G7 Acceptance Criteria

- [ ] All 5 tasks complete with individual commits.
- [ ] `pnpm build` passes both packages.
- [ ] G7 adds: 9 backend service tests + 3 backend route tests + 2 desktop tests = 14 new tests.
- [ ] HTTP smoke shows AI draft → auto-saved.
- [ ] Tag `openspec/phase-g7-complete` exists.

---

## What Phase G7 Deliberately Does NOT Cover

| Item | Phase |
|------|-------|
| "Improve selected text" — select + regenerate just that span | Later (needs diff/patch logic + selection state) |
| Streaming UX (AI types into textarea progressively) | Later (needs SSE/WS streaming infra) |
| Multi-turn refinement ("ask AI to revise based on review feedback") | Later |
| Prompt customization per project (style guide / domain glossary) | Later |
| WebSocket push for status changes | G8 (next) |

---

*Plan version: 1 / 2026-05-22*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` §11 G6*
*Predecessors: G1 / G2 / G3 / G4 / G5a / G5b / G6 (latest `openspec/phase-g6-complete`)*
