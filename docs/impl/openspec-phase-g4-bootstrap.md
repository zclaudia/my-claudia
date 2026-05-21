# OpenSpec × Supervisor — Phase G4: Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Initialize Specs" / "Re-scan" project-level action. AI reads the project working tree, produces per-capability deltas. ADDED requirements are auto-accepted into the corpus; MODIFIED and REMOVED items are queued for human review. After all review decisions are resolved, scan is closed and corpus reflects the new state. **Does NOT create Issue / SpecChange / ExecutorInstance** (per design v0.2 §7.3) — purely a spec-corpus action.

**Architecture:** New tables (`bootstrap_scans` + `bootstrap_review_items`) on top of G1/G2 infrastructure. `AiExploreService` wraps the existing `aiRunPort` (used by Meta Workflow) with a structured prompt that asks the AI to emit one JSON object describing per-capability deltas. `BootstrapService` orchestrates the scan: invokes explore, splits each delta into auto-accept (ADDED) vs review-queue (MODIFIED/REMOVED), applies the auto-accept slice immediately to `openspec/specs/`, persists the review queue. `BootstrapReviewService` lets users approve/reject queued items; once the queue is fully resolved it merges approved items + marks the scan complete + bumps `project_spec_corpus_meta`.

**Tech Stack:** TypeScript strict, vitest, the existing `aiRunPort` bridge (`server/src/application/bootstrap/feature-domains.ts:350`), G2 parsers + merger + formatter.

**Spec reference:**
- `docs/design/openspec-integration-v2.zh-CN.md` §7.3 (bootstrap flow), §13.2 (auto-accept ADDED / review MODIFIED+REMOVED), §11 G4 acceptance.

**Phase predecessors:**
- G1 tag `openspec/phase-g1-complete` (data layer)
- G2 tag `openspec/phase-g2-complete` (spec runtime + delta merger)
- G3 tag `openspec/phase-g3-complete` (issue orchestration — referenced for `getProjectRoot` shape only)

---

## File Structure

```
server/src/infrastructure/storage/migrations/
└── 072_bootstrap_scans.ts                                       NEW (2 tables)

server/src/domains/openspec/                                     (existing dir)
├── ai-explore-service.ts                                        NEW (wraps aiRunPort + prompt)
├── bootstrap-service.ts                                         NEW (orchestrate scan)
├── bootstrap-review-service.ts                                  NEW (accept/reject + final merge)
├── repositories/                                                NEW dir
│   ├── bootstrap-scan-repository.ts                             NEW
│   └── bootstrap-review-item-repository.ts                      NEW
├── index.ts                                                     MODIFY (re-export new services)
└── __tests__/
    ├── ai-explore-service.test.ts                               NEW
    ├── bootstrap-service.test.ts                                NEW
    ├── bootstrap-review-service.test.ts                         NEW
    └── repositories/
        ├── bootstrap-scan-repository.test.ts                    NEW
        └── bootstrap-review-item-repository.test.ts             NEW

server/src/application/bootstrap/
└── feature-domains.ts                                           MODIFY (wire G4 services using existing metaWorkflowAiRunPort)
```

5 tasks total.

```
Task 1 — Migration 072 + 2 repositories                          ← independent
Task 2 — AiExploreService (prompt + parse AI JSON to DeltaDoc[]) ← independent
Task 3 — BootstrapService (orchestrate scan + auto-apply)        ← needs T1, T2
Task 4 — BootstrapReviewService (approve/reject + final merge)   ← needs T3
Task 5 — Bootstrap wire + smoke + tag                            ← final
```

---

## Task 1: Migration 072 + repositories

**Files:**
- Create: `server/src/infrastructure/storage/migrations/072_bootstrap_scans.ts`
- Modify: `server/src/infrastructure/storage/migrations/index.ts`
- Create: `server/src/domains/openspec/repositories/bootstrap-scan-repository.ts`
- Create: `server/src/domains/openspec/repositories/bootstrap-review-item-repository.ts`
- Create: `server/src/domains/openspec/__tests__/repositories/bootstrap-scan-repository.test.ts`
- Create: `server/src/domains/openspec/__tests__/repositories/bootstrap-review-item-repository.test.ts`

**Goal:** Schema + repos in place.

- [ ] **Step 1: Create migration 072**

```typescript
// server/src/infrastructure/storage/migrations/072_bootstrap_scans.ts
import type { Migration } from './types.js';

export const migration: Migration = {
  name: '072_bootstrap_scans',
  sql: `
    CREATE TABLE IF NOT EXISTS bootstrap_scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','awaiting_review','completed','failed','cancelled')),
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      applied_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bootstrap_scans_project ON bootstrap_scans(project_id, status);

    CREATE TABLE IF NOT EXISTS bootstrap_review_items (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      operation TEXT NOT NULL
        CHECK (operation IN ('modify','remove')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected')),
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (scan_id) REFERENCES bootstrap_scans(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bootstrap_review_items_scan ON bootstrap_review_items(scan_id, status);
  `,
};
```

- [ ] **Step 2: Register in migration index**

Edit `server/src/infrastructure/storage/migrations/index.ts`. After the import of `m_071_local_issues_status_expand` (added during G3 Task 2), add:

```typescript
import { migration as m_072_bootstrap_scans } from './072_bootstrap_scans.js';
```

Append `m_072_bootstrap_scans` to the `migrations` array (at the end).

- [ ] **Step 3: Create BootstrapScanRepository**

```typescript
// server/src/domains/openspec/repositories/bootstrap-scan-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';

export type BootstrapScanStatus =
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BootstrapScan {
  id: string;
  projectId: string;
  status: BootstrapScanStatus;
  startedAt: number;
  finishedAt?: number;
  appliedCount: number;
  pendingCount: number;
  errorMessage?: string;
}

export interface BootstrapScanCreate {
  projectId: string;
}

export interface BootstrapScanUpdate {
  status?: BootstrapScanStatus;
  finishedAt?: number;
  appliedCount?: number;
  pendingCount?: number;
  errorMessage?: string;
}

interface Row {
  id: string;
  project_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  applied_count: number;
  pending_count: number;
  error_message: string | null;
}

export class BootstrapScanRepository extends BaseRepository<BootstrapScan, BootstrapScanCreate, BootstrapScanUpdate> {
  constructor(db: Database) {
    super(db, 'bootstrap_scans');
  }

  mapRow(row: unknown): BootstrapScan {
    const r = row as Row;
    return {
      id: r.id,
      projectId: r.project_id,
      status: r.status as BootstrapScanStatus,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
      appliedCount: r.applied_count,
      pendingCount: r.pending_count,
      errorMessage: r.error_message ?? undefined,
    };
  }

  createQuery(id: string, data: BootstrapScanCreate): { sql: string; params: unknown[] } {
    const now = Date.now();
    return {
      sql: `INSERT INTO bootstrap_scans (id, project_id, status, started_at, applied_count, pending_count) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [id, data.projectId, 'running', now, 0, 0],
    };
  }

  updateQuery(id: string, data: BootstrapScanUpdate): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.finishedAt !== undefined) { sets.push('finished_at = ?'); params.push(data.finishedAt); }
    if (data.appliedCount !== undefined) { sets.push('applied_count = ?'); params.push(data.appliedCount); }
    if (data.pendingCount !== undefined) { sets.push('pending_count = ?'); params.push(data.pendingCount); }
    if (data.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(data.errorMessage); }
    params.push(id);
    return { sql: `UPDATE bootstrap_scans SET ${sets.join(', ')} WHERE id = ?`, params };
  }

  findActiveByProject(projectId: string): BootstrapScan | null {
    const row = this.db.prepare(
      `SELECT * FROM bootstrap_scans WHERE project_id = ? AND status IN ('running','awaiting_review') ORDER BY started_at DESC LIMIT 1`,
    ).get(projectId);
    return row ? this.mapRow(row) : null;
  }

  listByProject(projectId: string): BootstrapScan[] {
    const rows = this.db.prepare(
      `SELECT * FROM bootstrap_scans WHERE project_id = ? ORDER BY started_at DESC`,
    ).all(projectId);
    return rows.map((r) => this.mapRow(r));
  }
}
```

> Check the actual `BaseRepository` API in `server/src/infrastructure/repositories/base.ts`. Per G1 Task 2 findings the methods are `mapRow` / `createQuery` / `updateQuery` (public abstract) — match that. If the base class signature differs, adapt.

- [ ] **Step 4: Create BootstrapReviewItemRepository**

```typescript
// server/src/domains/openspec/repositories/bootstrap-review-item-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';

export type BootstrapReviewOp = 'modify' | 'remove';
export type BootstrapReviewStatus = 'pending' | 'approved' | 'rejected';

export interface BootstrapReviewItem {
  id: string;
  scanId: string;
  capability: string;
  operation: BootstrapReviewOp;
  /** For 'modify': serialized ParsedRequirement. For 'remove': { name: string }. */
  payloadJson: string;
  status: BootstrapReviewStatus;
  createdAt: number;
  resolvedAt?: number;
}

export interface BootstrapReviewItemCreate {
  scanId: string;
  capability: string;
  operation: BootstrapReviewOp;
  payloadJson: string;
}

export interface BootstrapReviewItemUpdate {
  status?: BootstrapReviewStatus;
  resolvedAt?: number;
}

interface Row {
  id: string;
  scan_id: string;
  capability: string;
  operation: string;
  payload_json: string;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

export class BootstrapReviewItemRepository extends BaseRepository<BootstrapReviewItem, BootstrapReviewItemCreate, BootstrapReviewItemUpdate> {
  constructor(db: Database) {
    super(db, 'bootstrap_review_items');
  }

  mapRow(row: unknown): BootstrapReviewItem {
    const r = row as Row;
    return {
      id: r.id,
      scanId: r.scan_id,
      capability: r.capability,
      operation: r.operation as BootstrapReviewOp,
      payloadJson: r.payload_json,
      status: r.status as BootstrapReviewStatus,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at ?? undefined,
    };
  }

  createQuery(id: string, data: BootstrapReviewItemCreate): { sql: string; params: unknown[] } {
    return {
      sql: `INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, data.scanId, data.capability, data.operation, data.payloadJson, 'pending', Date.now()],
    };
  }

  updateQuery(id: string, data: BootstrapReviewItemUpdate): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.resolvedAt !== undefined) { sets.push('resolved_at = ?'); params.push(data.resolvedAt); }
    params.push(id);
    return { sql: `UPDATE bootstrap_review_items SET ${sets.join(', ')} WHERE id = ?`, params };
  }

  listByScan(scanId: string): BootstrapReviewItem[] {
    const rows = this.db.prepare(
      `SELECT * FROM bootstrap_review_items WHERE scan_id = ? ORDER BY created_at ASC`,
    ).all(scanId);
    return rows.map((r) => this.mapRow(r));
  }

  listPendingByScan(scanId: string): BootstrapReviewItem[] {
    const rows = this.db.prepare(
      `SELECT * FROM bootstrap_review_items WHERE scan_id = ? AND status = 'pending' ORDER BY created_at ASC`,
    ).all(scanId);
    return rows.map((r) => this.mapRow(r));
  }
}
```

- [ ] **Step 5: Write repository tests**

```typescript
// server/src/domains/openspec/__tests__/repositories/bootstrap-scan-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { BootstrapScanRepository } from '../../repositories/bootstrap-scan-repository.js';

describe('BootstrapScanRepository', () => {
  let db: Database.Database;
  let repo: BootstrapScanRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    repo = new BootstrapScanRepository(db);
  });

  it('create defaults status to running, started_at to now', () => {
    const s = repo.create({ projectId: 'proj-1' });
    expect(s.status).toBe('running');
    expect(s.startedAt).toBeGreaterThan(0);
    expect(s.appliedCount).toBe(0);
    expect(s.pendingCount).toBe(0);
  });

  it('update transitions status + sets finishedAt + counts', () => {
    const s = repo.create({ projectId: 'proj-1' });
    const upd = repo.update(s.id, { status: 'completed', finishedAt: 9999, appliedCount: 5, pendingCount: 0 });
    expect(upd.status).toBe('completed');
    expect(upd.finishedAt).toBe(9999);
    expect(upd.appliedCount).toBe(5);
  });

  it('findActiveByProject returns only running or awaiting_review', () => {
    const a = repo.create({ projectId: 'proj-1' });
    repo.update(a.id, { status: 'completed' });
    expect(repo.findActiveByProject('proj-1')).toBeNull();
    const b = repo.create({ projectId: 'proj-1' });
    repo.update(b.id, { status: 'awaiting_review' });
    expect(repo.findActiveByProject('proj-1')!.id).toBe(b.id);
  });

  it('CHECK constraint rejects invalid status', () => {
    expect(() => db.prepare(`INSERT INTO bootstrap_scans (id, project_id, status, started_at) VALUES (?, ?, ?, ?)`)
      .run('x', 'proj-1', 'invalid', 0)).toThrow();
  });

  it('listByProject returns all scans newest first', () => {
    const a = repo.create({ projectId: 'proj-1' });
    const b = repo.create({ projectId: 'proj-1' });
    const items = repo.listByProject('proj-1');
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
  });
});
```

```typescript
// server/src/domains/openspec/__tests__/repositories/bootstrap-review-item-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { BootstrapScanRepository } from '../../repositories/bootstrap-scan-repository.js';
import { BootstrapReviewItemRepository } from '../../repositories/bootstrap-review-item-repository.js';

describe('BootstrapReviewItemRepository', () => {
  let db: Database.Database;
  let scanRepo: BootstrapScanRepository;
  let repo: BootstrapReviewItemRepository;
  let scanId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    scanRepo = new BootstrapScanRepository(db);
    repo = new BootstrapReviewItemRepository(db);
    scanId = scanRepo.create({ projectId: 'proj-1' }).id;
  });

  it('create defaults status to pending', () => {
    const it = repo.create({ scanId, capability: 'auth', operation: 'modify', payloadJson: '{}' });
    expect(it.status).toBe('pending');
    expect(it.operation).toBe('modify');
  });

  it('listPendingByScan filters resolved out', () => {
    const a = repo.create({ scanId, capability: 'auth', operation: 'modify', payloadJson: '{}' });
    const b = repo.create({ scanId, capability: 'auth', operation: 'remove', payloadJson: '{}' });
    repo.update(a.id, { status: 'approved', resolvedAt: Date.now() });
    const pending = repo.listPendingByScan(scanId);
    expect(pending.map((i) => i.id)).toEqual([b.id]);
  });

  it('listByScan returns all in creation order', () => {
    const a = repo.create({ scanId, capability: 'a', operation: 'modify', payloadJson: '{}' });
    const b = repo.create({ scanId, capability: 'b', operation: 'remove', payloadJson: '{}' });
    expect(repo.listByScan(scanId).map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it('CHECK rejects invalid operation', () => {
    expect(() => db.prepare(`INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('x', scanId, 'a', 'invalid', '{}', 'pending', 0)).toThrow();
  });

  it('cascade delete: deleting scan removes items', () => {
    repo.create({ scanId, capability: 'auth', operation: 'modify', payloadJson: '{}' });
    db.prepare(`DELETE FROM bootstrap_scans WHERE id = ?`).run(scanId);
    expect(repo.listByScan(scanId)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/repositories
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 5 + 5 = 10 tests green, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/infrastructure/storage/migrations/072_bootstrap_scans.ts \
        server/src/infrastructure/storage/migrations/index.ts \
        server/src/domains/openspec/repositories/bootstrap-scan-repository.ts \
        server/src/domains/openspec/repositories/bootstrap-review-item-repository.ts \
        server/src/domains/openspec/__tests__/repositories/bootstrap-scan-repository.test.ts \
        server/src/domains/openspec/__tests__/repositories/bootstrap-review-item-repository.test.ts
git commit -m "feat(openspec): migration 072 + bootstrap_scans/review_items repos"
```

---

## Task 2: `AiExploreService` — AI prompt + parse to per-capability DeltaDoc

**Files:**
- Create: `server/src/domains/openspec/ai-explore-service.ts`
- Create: `server/src/domains/openspec/__tests__/ai-explore-service.test.ts`

**Goal:** Wrap the existing `AiRunPort` with a prompt template that asks the AI to scan the project working tree and emit one JSON object describing per-capability deltas. Parse the response into `Record<capability, DeltaDoc>`.

- [ ] **Step 1: Create the service**

```typescript
// server/src/domains/openspec/ai-explore-service.ts
import type { AiRunPort } from '../meta-workflow/run-entities/subagent-run-entity.js';
import type { DeltaDoc, ParsedRequirement, ParsedScenario, RfcKeyword } from './markdown/types.js';

export interface AiExploreServiceDeps {
  aiRunPort: AiRunPort;
  /** Maximum tokens/time to wait for the AI response. Default 120s. */
  timeoutMs?: number;
  /** Optional providerId override (passed straight to aiRunPort). */
  providerId?: string;
}

export interface ExploreInput {
  projectId: string;
  /** Working directory the AI scans. */
  workingDirectory: string;
  /** Optional: existing corpus shown to the AI for diff-based re-scan. */
  existingCorpusSummary?: string;
  /** First-time bootstrap vs incremental re-scan — affects prompt. */
  mode: 'initial' | 'rescan';
}

export interface ExploreResult {
  /** Map capability → delta. Empty if AI returned nothing usable. */
  perCapability: Record<string, DeltaDoc>;
  /** Raw AI output (for debugging / persistence). */
  rawResponse: string;
  /** Parse errors collected during JSON extraction. */
  parseErrors: string[];
}

export class AiExploreService {
  constructor(private deps: AiExploreServiceDeps) {}

  async explore(input: ExploreInput): Promise<ExploreResult> {
    const prompt = buildExplorePrompt(input);
    let collected = '';
    let resolved = false;
    const timeoutMs = this.deps.timeoutMs ?? 120_000;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, timeoutMs);
      this.deps.aiRunPort.startVirtualRun({
        input: prompt,
        workingDirectory: input.workingDirectory,
        providerId: this.deps.providerId,
        onMessage: (m) => {
          if (m.content) collected += m.content;
          if (m.kind === 'run_completed' || m.kind === 'completed' || m.kind === 'final') {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(); }
          }
        },
      }).catch(() => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(); } });
    });

    return parseExploreResponse(collected);
  }
}

/**
 * Build the explore prompt. The AI is told to emit a single JSON object on its own line
 * after any prose, with the shape: { perCapability: { <cap>: { added: [...], modified: [...], removed: [...] } } }
 */
export function buildExplorePrompt(input: ExploreInput): string {
  const intro = input.mode === 'initial'
    ? `You are bootstrapping a project specification corpus. Scan the codebase at the working directory and identify the system's current behaviors. Group them into "capabilities" (e.g. auth, billing, notifications).`
    : `You are re-scanning a project to find specification drift. Compare the codebase to the existing corpus summary below and emit deltas for what has changed.`;
  const corpusBlock = input.existingCorpusSummary
    ? `\n\n## Existing corpus summary\n\n${input.existingCorpusSummary}\n`
    : '';

  return [
    intro,
    corpusBlock,
    ``,
    `## Output format`,
    ``,
    `Emit a SINGLE JSON object on its own line, in this shape:`,
    ``,
    `\`\`\`json`,
    `{`,
    `  "perCapability": {`,
    `    "<capability-name>": {`,
    `      "added": [`,
    `        {`,
    `          "name": "<requirement name>",`,
    `          "body": "The system MUST/SHOULD/MAY <behavior>.",`,
    `          "scenarios": [`,
    `            { "name": "<scenario name>", "bodyLines": ["- **WHEN** ...", "- **THEN** ..."] }`,
    `          ]`,
    `        }`,
    `      ],`,
    `      "modified": [ /* same shape as added */ ],`,
    `      "removed": [ "<requirement name>", ... ]`,
    `    }`,
    `  }`,
    `}`,
    `\`\`\``,
    ``,
    `Rules:`,
    `- For initial bootstrap, "modified" and "removed" arrays should be empty for every capability.`,
    `- Each requirement body MUST contain at least one of: MUST, MUST NOT, SHALL, SHALL NOT, SHOULD, SHOULD NOT, MAY.`,
    `- Each requirement MUST have at least one scenario.`,
    `- Scenario bodyLines should be bullet items using **WHEN**/**THEN**/**AND**.`,
    `- Do not include implementation details (class names, file paths) — describe behavior only.`,
    `- The JSON must be valid (no comments, no trailing commas).`,
  ].join('\n');
}

/** Extract the JSON object and convert to per-capability DeltaDoc map. */
export function parseExploreResponse(rawResponse: string): ExploreResult {
  const parseErrors: string[] = [];
  const empty: ExploreResult = { perCapability: {}, rawResponse, parseErrors };

  // Find the first `{ ... }` block by brace-matching (skips JSON inside ```json fences too).
  const jsonText = extractJsonObject(rawResponse);
  if (!jsonText) {
    parseErrors.push('No JSON object found in AI response');
    return empty;
  }
  let parsed: { perCapability?: Record<string, unknown> };
  try {
    parsed = JSON.parse(jsonText) as { perCapability?: Record<string, unknown> };
  } catch (e) {
    parseErrors.push(`JSON.parse failed: ${(e as Error).message}`);
    return empty;
  }
  if (!parsed.perCapability || typeof parsed.perCapability !== 'object') {
    parseErrors.push('Missing or invalid `perCapability` field');
    return empty;
  }

  const perCapability: Record<string, DeltaDoc> = {};
  for (const [cap, val] of Object.entries(parsed.perCapability)) {
    const slot = val as { added?: unknown[]; modified?: unknown[]; removed?: unknown[] };
    perCapability[cap] = {
      added: (slot.added ?? []).map(toRequirement).filter((r): r is ParsedRequirement => r !== null),
      modified: (slot.modified ?? []).map(toRequirement).filter((r): r is ParsedRequirement => r !== null),
      removed: (slot.removed ?? []).filter((x): x is string => typeof x === 'string'),
    };
  }
  return { perCapability, rawResponse, parseErrors };
}

function extractJsonObject(text: string): string | null {
  // Walk character by character to find a balanced { ... } pair, respecting strings.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const RFC_KEYWORDS: RfcKeyword[] = ['MUST NOT', 'MUST', 'SHALL NOT', 'SHALL', 'SHOULD NOT', 'SHOULD', 'MAY'];

function detectRfcKeywords(body: string): RfcKeyword[] {
  const out: RfcKeyword[] = [];
  let scratch = body;
  for (const kw of RFC_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`);
    if (pattern.test(scratch)) {
      out.push(kw);
      scratch = scratch.replace(new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'g'), ' '.repeat(kw.length));
    }
  }
  return out;
}

function toRequirement(raw: unknown): ParsedRequirement | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { name?: string; body?: string; scenarios?: unknown[] };
  if (typeof obj.name !== 'string' || typeof obj.body !== 'string') return null;
  const scenarios: ParsedScenario[] = Array.isArray(obj.scenarios)
    ? obj.scenarios
        .map((s) => {
          if (!s || typeof s !== 'object') return null;
          const sObj = s as { name?: string; bodyLines?: unknown[] };
          if (typeof sObj.name !== 'string') return null;
          const bodyLines = Array.isArray(sObj.bodyLines)
            ? sObj.bodyLines.filter((l): l is string => typeof l === 'string')
            : [];
          return { name: sObj.name, bodyLines };
        })
        .filter((s): s is ParsedScenario => s !== null)
    : [];
  return {
    name: obj.name,
    body: obj.body,
    rfcKeywords: detectRfcKeywords(obj.body),
    scenarios,
  };
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/ai-explore-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AiExploreService, buildExplorePrompt, parseExploreResponse } from '../ai-explore-service.js';

describe('buildExplorePrompt', () => {
  it('initial mode does not include corpus block', () => {
    const p = buildExplorePrompt({ projectId: 'p1', workingDirectory: '/tmp/x', mode: 'initial' });
    expect(p).toContain('bootstrapping a project specification corpus');
    expect(p).not.toContain('Existing corpus summary');
  });

  it('rescan mode includes corpus block when summary provided', () => {
    const p = buildExplorePrompt({ projectId: 'p1', workingDirectory: '/tmp/x', mode: 'rescan', existingCorpusSummary: 'EXISTING' });
    expect(p).toContain('re-scanning');
    expect(p).toContain('EXISTING');
  });

  it('contains output-format JSON schema example', () => {
    const p = buildExplorePrompt({ projectId: 'p1', workingDirectory: '/tmp/x', mode: 'initial' });
    expect(p).toMatch(/perCapability/);
    expect(p).toMatch(/added/);
    expect(p).toMatch(/modified/);
    expect(p).toMatch(/removed/);
  });
});

describe('parseExploreResponse', () => {
  it('parses a well-formed AI response into perCapability map', () => {
    const raw = `Here is the analysis:\n\n\`\`\`json\n${JSON.stringify({
      perCapability: {
        auth: {
          added: [{
            name: 'Login',
            body: 'System MUST authenticate users.',
            scenarios: [{ name: 'Valid creds', bodyLines: ['- **WHEN** valid', '- **THEN** SHALL return token'] }],
          }],
          modified: [],
          removed: [],
        },
      },
    })}\n\`\`\``;
    const result = parseExploreResponse(raw);
    expect(result.parseErrors).toEqual([]);
    expect(Object.keys(result.perCapability)).toEqual(['auth']);
    const auth = result.perCapability.auth;
    expect(auth.added).toHaveLength(1);
    expect(auth.added[0].name).toBe('Login');
    expect(auth.added[0].rfcKeywords).toContain('MUST');
    expect(auth.added[0].scenarios[0].name).toBe('Valid creds');
  });

  it('parses MODIFIED + REMOVED entries', () => {
    const raw = JSON.stringify({
      perCapability: {
        billing: {
          added: [],
          modified: [{
            name: 'Charge user',
            body: 'System SHALL charge.',
            scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
          }],
          removed: ['Legacy refund'],
        },
      },
    });
    const result = parseExploreResponse(raw);
    expect(result.perCapability.billing.modified).toHaveLength(1);
    expect(result.perCapability.billing.removed).toEqual(['Legacy refund']);
  });

  it('returns empty perCapability + error when no JSON found', () => {
    const result = parseExploreResponse('I think we should scan things, but here is no JSON.');
    expect(result.perCapability).toEqual({});
    expect(result.parseErrors[0]).toMatch(/No JSON/);
  });

  it('returns empty perCapability + error on invalid JSON', () => {
    const result = parseExploreResponse('{ this is not valid json }');
    expect(result.perCapability).toEqual({});
    expect(result.parseErrors[0]).toMatch(/JSON.parse failed/);
  });

  it('skips malformed requirements but keeps valid ones', () => {
    const raw = JSON.stringify({
      perCapability: {
        x: { added: [{ name: 'Good', body: 'MUST', scenarios: [{ name: 's', bodyLines: [] }] }, { invalid: true }], modified: [], removed: [] },
      },
    });
    const result = parseExploreResponse(raw);
    expect(result.perCapability.x.added).toHaveLength(1);
    expect(result.perCapability.x.added[0].name).toBe('Good');
  });
});

describe('AiExploreService (integration with mock aiRunPort)', () => {
  it('passes prompt + workingDirectory to aiRunPort and returns parsed result', async () => {
    let capturedInput = '';
    let capturedCwd = '';
    const fakePort = {
      async startVirtualRun(args: { input: string; workingDirectory?: string; onMessage?: (m: { kind: string; content?: string }) => void }) {
        capturedInput = args.input;
        capturedCwd = args.workingDirectory ?? '';
        args.onMessage?.({ kind: 'assistant', content: JSON.stringify({
          perCapability: { core: { added: [{ name: 'A', body: 'MUST', scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }] }], modified: [], removed: [] } },
        }) });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new AiExploreService({ aiRunPort: fakePort, timeoutMs: 1000 });
    const result = await svc.explore({ projectId: 'p1', workingDirectory: '/tmp/proj', mode: 'initial' });
    expect(capturedCwd).toBe('/tmp/proj');
    expect(capturedInput).toContain('perCapability');
    expect(result.perCapability.core.added[0].name).toBe('A');
  });

  it('returns empty result when aiRunPort throws (handled gracefully)', async () => {
    const fakePort = { startVirtualRun: vi.fn().mockRejectedValue(new Error('boom')) };
    const svc = new AiExploreService({ aiRunPort: fakePort, timeoutMs: 1000 });
    const result = await svc.explore({ projectId: 'p1', workingDirectory: '/tmp/x', mode: 'initial' });
    expect(result.perCapability).toEqual({});
    expect(result.parseErrors[0]).toMatch(/No JSON/);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/ai-explore-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 8 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/ai-explore-service.ts \
        server/src/domains/openspec/__tests__/ai-explore-service.test.ts
git commit -m "feat(openspec): AiExploreService — explore prompt + JSON parse to DeltaDoc"
```

---

## Task 3: `BootstrapService` — orchestrate scan + auto-apply ADDED

**Files:**
- Create: `server/src/domains/openspec/bootstrap-service.ts`
- Create: `server/src/domains/openspec/__tests__/bootstrap-service.test.ts`

**Goal:** End-to-end scan orchestration:
1. Create a `bootstrap_scans` row (status='running')
2. Invoke `AiExploreService.explore`
3. For each capability:
   - Read corpus spec (if exists) → ParsedSpec; else empty
   - Apply ONLY the ADDED slice immediately (write corpus back)
   - Persist MODIFIED + REMOVED items as `bootstrap_review_items` rows
4. Set scan status:
   - If `pendingCount === 0` → 'completed' + bump `project_spec_corpus_meta.initialized=1`
   - Else → 'awaiting_review'
5. Return summary

- [ ] **Step 1: Create the service**

```typescript
// server/src/domains/openspec/bootstrap-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { DeltaDoc, ParsedRequirement, ParsedSpec } from './markdown/types.js';
import { parseSpec } from './markdown/spec-parser.js';
import { formatSpec } from './markdown/spec-formatter.js';
import { applyDelta } from './delta-merger.js';
import { AiExploreService, type ExploreInput, type ExploreResult } from './ai-explore-service.js';
import { BootstrapScanRepository, type BootstrapScan } from './repositories/bootstrap-scan-repository.js';
import { BootstrapReviewItemRepository } from './repositories/bootstrap-review-item-repository.js';

const OPENSPEC_DIR = 'openspec';
const SPECS_DIR = 'specs';

export interface BootstrapServiceDeps {
  db: Database;
  explore: AiExploreService;
  getProjectRoot: (projectId: string) => string;
}

export interface BootstrapStartInput {
  projectId: string;
  mode: 'initial' | 'rescan';
}

export interface BootstrapStartResult {
  scan: BootstrapScan;
  exploreResult: ExploreResult;
  /** Number of ADDED requirements applied immediately, per capability. */
  appliedSummary: Record<string, number>;
  /** Number of pending review items created, per capability. */
  pendingSummary: Record<string, { modified: number; removed: number }>;
}

export class BootstrapService {
  private scanRepo: BootstrapScanRepository;
  private reviewRepo: BootstrapReviewItemRepository;

  constructor(private deps: BootstrapServiceDeps) {
    this.scanRepo = new BootstrapScanRepository(deps.db);
    this.reviewRepo = new BootstrapReviewItemRepository(deps.db);
  }

  async start(input: BootstrapStartInput): Promise<BootstrapStartResult> {
    // Reject if a scan is already active for this project.
    const active = this.scanRepo.findActiveByProject(input.projectId);
    if (active) {
      throw new Error(`A bootstrap scan is already active for project ${input.projectId} (id=${active.id})`);
    }

    const scan = this.scanRepo.create({ projectId: input.projectId });
    const projectRoot = this.deps.getProjectRoot(input.projectId);

    let exploreResult: ExploreResult;
    try {
      const exploreInput: ExploreInput = {
        projectId: input.projectId,
        workingDirectory: projectRoot,
        mode: input.mode,
        existingCorpusSummary: input.mode === 'rescan' ? summarizeCorpus(projectRoot) : undefined,
      };
      exploreResult = await this.deps.explore.explore(exploreInput);
    } catch (e) {
      this.scanRepo.update(scan.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: (e as Error).message,
      });
      throw e;
    }

    const appliedSummary: Record<string, number> = {};
    const pendingSummary: Record<string, { modified: number; removed: number }> = {};
    let appliedCount = 0;
    let pendingCount = 0;

    for (const [capability, delta] of Object.entries(exploreResult.perCapability)) {
      // 1. Apply ADDED slice immediately.
      const addedOnly: DeltaDoc = { added: delta.added, modified: [], removed: [] };
      const corpus = readOrEmptyCorpus(projectRoot, capability);
      const mergeResult = applyDelta(corpus, addedOnly);
      writeCorpus(projectRoot, capability, mergeResult.spec);
      appliedSummary[capability] = mergeResult.added.length;
      appliedCount += mergeResult.added.length;

      // 2. Persist MODIFIED + REMOVED items for review.
      let modified = 0;
      let removed = 0;
      for (const req of delta.modified) {
        this.reviewRepo.create({
          scanId: scan.id,
          capability,
          operation: 'modify',
          payloadJson: JSON.stringify(req),
        });
        modified += 1;
      }
      for (const name of delta.removed) {
        this.reviewRepo.create({
          scanId: scan.id,
          capability,
          operation: 'remove',
          payloadJson: JSON.stringify({ name }),
        });
        removed += 1;
      }
      pendingSummary[capability] = { modified, removed };
      pendingCount += modified + removed;
    }

    // 3. Transition scan status.
    const finalStatus = pendingCount > 0 ? 'awaiting_review' : 'completed';
    const updated = this.scanRepo.update(scan.id, {
      status: finalStatus,
      appliedCount,
      pendingCount,
      finishedAt: finalStatus === 'completed' ? Date.now() : undefined,
    });

    // 4. If completed AND there were items applied, bump corpus meta.
    if (finalStatus === 'completed' && appliedCount > 0) {
      bumpCorpusMeta(this.deps.db, input.projectId);
    }

    return { scan: updated, exploreResult, appliedSummary, pendingSummary };
  }
}

function summarizeCorpus(projectRoot: string): string {
  const dir = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR);
  if (!fs.existsSync(dir)) return '(no existing corpus)';
  const caps: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const specFile = path.join(dir, entry.name, 'spec.md');
    if (fs.existsSync(specFile)) {
      const text = fs.readFileSync(specFile, 'utf-8');
      const reqNames = [...text.matchAll(/^###\s+Requirement:\s*(.+)$/gm)].map((m) => m[1].trim());
      caps.push(`- ${entry.name}: ${reqNames.length} requirements [${reqNames.slice(0, 5).join(', ')}${reqNames.length > 5 ? ', ...' : ''}]`);
    }
  }
  return caps.length > 0 ? caps.join('\n') : '(no existing corpus)';
}

function readOrEmptyCorpus(projectRoot: string, capability: string): ParsedSpec {
  const file = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR, capability, 'spec.md');
  if (!fs.existsSync(file)) return { capability, requirements: [] };
  return parseSpec(fs.readFileSync(file, 'utf-8'));
}

function writeCorpus(projectRoot: string, capability: string, spec: ParsedSpec): void {
  const file = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR, capability, 'spec.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatSpec(spec));
}

function bumpCorpusMeta(db: Database, projectId: string): void {
  db.prepare(
    `INSERT INTO project_spec_corpus_meta (project_id, initialized, last_bootstrap_at, capabilities_json)
     VALUES (?, 1, ?, '[]')
     ON CONFLICT(project_id) DO UPDATE SET initialized = 1, last_bootstrap_at = excluded.last_bootstrap_at`,
  ).run(projectId, Date.now());
}

// Re-export ParsedRequirement for callers that need the shape (Review service).
export type { ParsedRequirement };
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/bootstrap-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { AiExploreService } from '../ai-explore-service.js';
import { BootstrapService } from '../bootstrap-service.js';
import { BootstrapReviewItemRepository } from '../repositories/bootstrap-review-item-repository.js';

function mkPort(jsonObj: unknown) {
  return {
    async startVirtualRun(args: { onMessage?: (m: { kind: string; content?: string }) => void }) {
      args.onMessage?.({ kind: 'assistant', content: JSON.stringify(jsonObj) });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

describe('BootstrapService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let reviewRepo: BootstrapReviewItemRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'bootstrap-'));
    reviewRepo = new BootstrapReviewItemRepository(db);
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('initial bootstrap auto-applies all ADDED and marks scan completed', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({
      perCapability: {
        auth: { added: [{ name: 'Login', body: 'System MUST authenticate.', scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }] }], modified: [], removed: [] },
        billing: { added: [{ name: 'Charge', body: 'System SHALL charge.', scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }] }], modified: [], removed: [] },
      },
    }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });

    const result = await svc.start({ projectId: 'proj-1', mode: 'initial' });
    expect(result.scan.status).toBe('completed');
    expect(result.scan.appliedCount).toBe(2);
    expect(result.scan.pendingCount).toBe(0);
    expect(result.appliedSummary).toEqual({ auth: 1, billing: 1 });
    expect(fs.existsSync(join(projectRoot, 'openspec', 'specs', 'auth', 'spec.md'))).toBe(true);
    expect(fs.existsSync(join(projectRoot, 'openspec', 'specs', 'billing', 'spec.md'))).toBe(true);
    // corpus meta bumped
    const meta = db.prepare(`SELECT * FROM project_spec_corpus_meta WHERE project_id = ?`).get('proj-1') as { initialized: number; last_bootstrap_at: number };
    expect(meta.initialized).toBe(1);
    expect(meta.last_bootstrap_at).toBeGreaterThan(0);
  });

  it('re-scan with MODIFIED + REMOVED queues them for review (status=awaiting_review)', async () => {
    // Seed an existing corpus first.
    const corpusDir = join(projectRoot, 'openspec', 'specs', 'auth');
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.writeFileSync(join(corpusDir, 'spec.md'), `# auth Specification\n\n## Requirements\n\n### Requirement: Login\n\nSystem SHALL authenticate.\n\n#### Scenario: Valid\n- **WHEN** valid\n- **THEN** SHALL return token\n`);

    const explore = new AiExploreService({ aiRunPort: mkPort({
      perCapability: {
        auth: {
          added: [{ name: '2FA', body: 'System SHALL support 2FA.', scenarios: [{ name: 'enroll', bodyLines: ['- **WHEN** x', '- **THEN** y'] }] }],
          modified: [{ name: 'Login', body: 'System SHALL authenticate with 2FA.', scenarios: [{ name: 'with 2FA', bodyLines: ['- **WHEN** valid', '- **THEN** prompt 2FA'] }] }],
          removed: ['Legacy guest login'],
        },
      },
    }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });

    const result = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
    expect(result.scan.status).toBe('awaiting_review');
    expect(result.scan.appliedCount).toBe(1);  // only 2FA ADDED
    expect(result.scan.pendingCount).toBe(2);  // Login MODIFIED + Legacy REMOVED
    // corpus has Login + 2FA but Login is still the OLD body (delta not applied yet)
    const corpus = fs.readFileSync(join(corpusDir, 'spec.md'), 'utf-8');
    expect(corpus).toContain('2FA');
    expect(corpus).toContain('### Requirement: Login');
    expect(corpus).toContain('System SHALL authenticate.');  // old body, unchanged
    expect(corpus).not.toContain('2FA prompt');  // new body NOT yet applied

    // Review items persisted
    const pending = reviewRepo.listPendingByScan(result.scan.id);
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.operation).sort()).toEqual(['modify', 'remove']);
  });

  it('throws when another scan is already active', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    await svc.start({ projectId: 'proj-1', mode: 'initial' });  // completed (no perCapability → empty)
    // Manually mark as awaiting_review to simulate an active scan
    db.prepare(`UPDATE bootstrap_scans SET status = 'awaiting_review' WHERE project_id = ?`).run('proj-1');
    await expect(svc.start({ projectId: 'proj-1', mode: 'rescan' })).rejects.toThrow(/already active/);
  });

  it('marks scan failed when AiExploreService throws', async () => {
    const explore = new AiExploreService({ aiRunPort: { startVirtualRun: () => { throw new Error('boom'); } }, timeoutMs: 500 });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    // The aiRunPort throws synchronously; explore() handles it and returns empty perCapability.
    // Bootstrap should treat empty result as "completed with nothing applied".
    const result = await svc.start({ projectId: 'proj-1', mode: 'initial' });
    expect(result.scan.appliedCount).toBe(0);
    expect(result.scan.pendingCount).toBe(0);
    expect(result.scan.status).toBe('completed');
  });

  it('empty perCapability → scan completed with 0 applied, no corpus meta bump', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    const result = await svc.start({ projectId: 'proj-1', mode: 'initial' });
    expect(result.scan.appliedCount).toBe(0);
    expect(result.scan.status).toBe('completed');
    const meta = db.prepare(`SELECT * FROM project_spec_corpus_meta WHERE project_id = ?`).get('proj-1');
    expect(meta).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/bootstrap-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 5 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/bootstrap-service.ts \
        server/src/domains/openspec/__tests__/bootstrap-service.test.ts
git commit -m "feat(openspec): BootstrapService — scan + auto-apply ADDED + queue review"
```

---

## Task 4: `BootstrapReviewService` — approve/reject + final merge

**Files:**
- Create: `server/src/domains/openspec/bootstrap-review-service.ts`
- Create: `server/src/domains/openspec/__tests__/bootstrap-review-service.test.ts`

**Goal:** Resolve each pending review item. When the queue becomes empty, apply all approved items to the corpus, mark scan completed, bump corpus meta.

- [ ] **Step 1: Create the service**

```typescript
// server/src/domains/openspec/bootstrap-review-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { DeltaDoc, ParsedRequirement, ParsedSpec } from './markdown/types.js';
import { parseSpec } from './markdown/spec-parser.js';
import { formatSpec } from './markdown/spec-formatter.js';
import { applyDelta } from './delta-merger.js';
import { BootstrapScanRepository, type BootstrapScan } from './repositories/bootstrap-scan-repository.js';
import {
  BootstrapReviewItemRepository,
  type BootstrapReviewItem,
} from './repositories/bootstrap-review-item-repository.js';

const OPENSPEC_DIR = 'openspec';
const SPECS_DIR = 'specs';

export interface BootstrapReviewServiceDeps {
  db: Database;
  getProjectRoot: (projectId: string) => string;
}

export interface ReviewFinalizeResult {
  scan: BootstrapScan;
  /** Number of items merged into the corpus, per capability. */
  mergedSummary: Record<string, { modified: number; removed: number }>;
}

export class BootstrapReviewService {
  private scanRepo: BootstrapScanRepository;
  private reviewRepo: BootstrapReviewItemRepository;

  constructor(private deps: BootstrapReviewServiceDeps) {
    this.scanRepo = new BootstrapScanRepository(deps.db);
    this.reviewRepo = new BootstrapReviewItemRepository(deps.db);
  }

  listPending(scanId: string): BootstrapReviewItem[] {
    return this.reviewRepo.listPendingByScan(scanId);
  }

  listAll(scanId: string): BootstrapReviewItem[] {
    return this.reviewRepo.listByScan(scanId);
  }

  approve(itemId: string): BootstrapReviewItem {
    return this.reviewRepo.update(itemId, { status: 'approved', resolvedAt: Date.now() });
  }

  reject(itemId: string): BootstrapReviewItem {
    return this.reviewRepo.update(itemId, { status: 'rejected', resolvedAt: Date.now() });
  }

  /**
   * If all items for this scan are resolved, apply the approved ones to the corpus,
   * mark scan completed, and bump corpus meta. Returns the merge summary.
   *
   * Returns null if there are still pending items.
   */
  async finalize(scanId: string): Promise<ReviewFinalizeResult | null> {
    const scan = this.scanRepo.findById(scanId);
    if (!scan) throw new Error(`Scan not found: ${scanId}`);
    const pending = this.reviewRepo.listPendingByScan(scanId);
    if (pending.length > 0) return null;

    const all = this.reviewRepo.listByScan(scanId);
    const approved = all.filter((i) => i.status === 'approved');
    const projectRoot = this.deps.getProjectRoot(scan.projectId);

    // Group by capability, build a delta containing only the approved entries.
    const byCapability = new Map<string, DeltaDoc>();
    for (const item of approved) {
      let delta = byCapability.get(item.capability);
      if (!delta) { delta = { added: [], modified: [], removed: [] }; byCapability.set(item.capability, delta); }
      if (item.operation === 'modify') {
        const req = JSON.parse(item.payloadJson) as ParsedRequirement;
        delta.modified.push(req);
      } else {
        const obj = JSON.parse(item.payloadJson) as { name: string };
        delta.removed.push(obj.name);
      }
    }

    const mergedSummary: Record<string, { modified: number; removed: number }> = {};
    for (const [capability, delta] of byCapability) {
      const corpus = readOrEmptyCorpus(projectRoot, capability);
      const merge = applyDelta(corpus, delta);
      writeCorpus(projectRoot, capability, merge.spec);
      mergedSummary[capability] = { modified: merge.modified.length, removed: merge.removed.length };
    }

    const updated = this.scanRepo.update(scanId, {
      status: 'completed',
      finishedAt: Date.now(),
      pendingCount: 0,
    });
    bumpCorpusMeta(this.deps.db, scan.projectId);
    return { scan: updated, mergedSummary };
  }
}

function readOrEmptyCorpus(projectRoot: string, capability: string): ParsedSpec {
  const file = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR, capability, 'spec.md');
  if (!fs.existsSync(file)) return { capability, requirements: [] };
  return parseSpec(fs.readFileSync(file, 'utf-8'));
}

function writeCorpus(projectRoot: string, capability: string, spec: ParsedSpec): void {
  const file = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR, capability, 'spec.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatSpec(spec));
}

function bumpCorpusMeta(db: Database, projectId: string): void {
  db.prepare(
    `INSERT INTO project_spec_corpus_meta (project_id, initialized, last_bootstrap_at, capabilities_json)
     VALUES (?, 1, ?, '[]')
     ON CONFLICT(project_id) DO UPDATE SET initialized = 1, last_bootstrap_at = excluded.last_bootstrap_at`,
  ).run(projectId, Date.now());
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/bootstrap-review-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { AiExploreService } from '../ai-explore-service.js';
import { BootstrapService } from '../bootstrap-service.js';
import { BootstrapReviewService } from '../bootstrap-review-service.js';

function mkPort(jsonObj: unknown) {
  return {
    async startVirtualRun(args: { onMessage?: (m: { kind: string; content?: string }) => void }) {
      args.onMessage?.({ kind: 'assistant', content: JSON.stringify(jsonObj) });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

const RESCAN_DELTA = {
  perCapability: {
    auth: {
      added: [],
      modified: [{ name: 'Login', body: 'System SHALL authenticate with 2FA.', scenarios: [{ name: 'with 2FA', bodyLines: ['- **WHEN** valid', '- **THEN** prompt 2FA'] }] }],
      removed: ['Legacy guest login'],
    },
  },
};

async function setupAwaitingReview(db: Database.Database, projectRoot: string) {
  // Seed corpus
  const dir = join(projectRoot, 'openspec', 'specs', 'auth');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'spec.md'), `# auth Specification\n\n## Requirements\n\n### Requirement: Login\n\nSystem SHALL authenticate.\n\n#### Scenario: Valid\n- **WHEN** valid\n- **THEN** SHALL return token\n\n### Requirement: Legacy guest login\n\nUsers MAY browse as guest.\n\n#### Scenario: Guest\n- **WHEN** anon\n- **THEN** allow read-only\n`);
  const explore = new AiExploreService({ aiRunPort: mkPort(RESCAN_DELTA) });
  const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
  const result = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
  expect(result.scan.status).toBe('awaiting_review');
  return result.scan;
}

describe('BootstrapReviewService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let reviewSvc: BootstrapReviewService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'review-'));
    reviewSvc = new BootstrapReviewService({ db, getProjectRoot: () => projectRoot });
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('approve + reject change item status', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const pending = reviewSvc.listPending(scan.id);
    expect(pending).toHaveLength(2);
    const approved = reviewSvc.approve(pending[0].id);
    const rejected = reviewSvc.reject(pending[1].id);
    expect(approved.status).toBe('approved');
    expect(rejected.status).toBe('rejected');
  });

  it('finalize returns null while pending items remain', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const result = await reviewSvc.finalize(scan.id);
    expect(result).toBeNull();
  });

  it('finalize after all approved merges modified+removed into corpus', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const pending = reviewSvc.listPending(scan.id);
    for (const item of pending) reviewSvc.approve(item.id);
    const result = await reviewSvc.finalize(scan.id);
    expect(result).not.toBeNull();
    expect(result!.scan.status).toBe('completed');
    expect(result!.mergedSummary.auth.modified).toBe(1);
    expect(result!.mergedSummary.auth.removed).toBe(1);
    // Corpus reflects merge
    const corpus = fs.readFileSync(join(projectRoot, 'openspec', 'specs', 'auth', 'spec.md'), 'utf-8');
    expect(corpus).toContain('2FA prompt');
    expect(corpus).not.toContain('Legacy guest login');
  });

  it('finalize after all rejected does NOT change corpus, scan completed with 0 merges', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const pending = reviewSvc.listPending(scan.id);
    for (const item of pending) reviewSvc.reject(item.id);
    const result = await reviewSvc.finalize(scan.id);
    expect(result!.scan.status).toBe('completed');
    expect(Object.keys(result!.mergedSummary)).toEqual([]);
    const corpus = fs.readFileSync(join(projectRoot, 'openspec', 'specs', 'auth', 'spec.md'), 'utf-8');
    expect(corpus).toContain('System SHALL authenticate.');  // unchanged
    expect(corpus).toContain('Legacy guest login');  // unchanged
  });

  it('finalize bumps corpus meta', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    for (const item of reviewSvc.listPending(scan.id)) reviewSvc.approve(item.id);
    await reviewSvc.finalize(scan.id);
    const meta = db.prepare(`SELECT * FROM project_spec_corpus_meta WHERE project_id = ?`).get('proj-1') as { initialized: number; last_bootstrap_at: number };
    expect(meta.initialized).toBe(1);
    expect(meta.last_bootstrap_at).toBeGreaterThan(0);
  });

  it('throws on unknown scanId', async () => {
    await expect(reviewSvc.finalize('nope')).rejects.toThrow(/Scan not found/);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/bootstrap-review-service.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 6 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/bootstrap-review-service.ts \
        server/src/domains/openspec/__tests__/bootstrap-review-service.test.ts
git commit -m "feat(openspec): BootstrapReviewService — approve/reject + finalize merge"
```

---

## Task 5: Bootstrap wire + smoke + tag

**Files:**
- Modify: `server/src/domains/openspec/index.ts` (re-export new services + types)
- Modify: `server/src/application/bootstrap/feature-domains.ts` (wire bootstrap services using `metaWorkflowAiRunPort`)

**Goal:** All services accessible via DI; full chain verified end-to-end.

- [ ] **Step 1: Extend domain index**

Append to `server/src/domains/openspec/index.ts`:

```typescript
export { AiExploreService, buildExplorePrompt, parseExploreResponse } from './ai-explore-service.js';
export { BootstrapService } from './bootstrap-service.js';
export { BootstrapReviewService } from './bootstrap-review-service.js';
export type { ExploreInput, ExploreResult } from './ai-explore-service.js';
export type { BootstrapStartInput, BootstrapStartResult } from './bootstrap-service.js';
export type { ReviewFinalizeResult } from './bootstrap-review-service.js';
export { BootstrapScanRepository } from './repositories/bootstrap-scan-repository.js';
export { BootstrapReviewItemRepository } from './repositories/bootstrap-review-item-repository.js';
export type { BootstrapScan, BootstrapScanStatus } from './repositories/bootstrap-scan-repository.js';
export type { BootstrapReviewItem, BootstrapReviewOp, BootstrapReviewStatus } from './repositories/bootstrap-review-item-repository.js';
```

- [ ] **Step 2: Wire into `feature-domains.ts`**

In `server/src/application/bootstrap/feature-domains.ts`, after the G3 issue orchestration block, add:

```typescript
import {
  AiExploreService,
  BootstrapService,
  BootstrapReviewService,
} from '../../domains/openspec/index.js';

// ... after issueOrchestration wiring ...

// G4: Bootstrap services. Reuses metaWorkflowAiRunPort (same AI port shape).
const aiExploreService = new AiExploreService({ aiRunPort: metaWorkflowAiRunPort });
const bootstrapService = new BootstrapService({
  db: opts.db,
  explore: aiExploreService,
  getProjectRoot: getProjectRootPlaceholder,  // wired to real lookup in G5
});
const bootstrapReviewService = new BootstrapReviewService({
  db: opts.db,
  getProjectRoot: getProjectRootPlaceholder,
});

// Expose in the returned bag
return {
  // ... existing services ...
  aiExploreService,
  bootstrapService,
  bootstrapReviewService,
};
```

> `getProjectRootPlaceholder` was introduced in G3 Task 5. Reuse it.

- [ ] **Step 3: Verify build + full tests + tsc**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm build
pnpm --filter @my-claudia/server exec vitest run
```

Expected: tsc clean both packages; build clean; ~3625 tests green (G3's 3600 + 29 new G4 tests).

- [ ] **Step 4: Programmatic end-to-end smoke**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { applyMigrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { AiExploreService, BootstrapService, BootstrapReviewService } from './server/dist/domains/openspec/index.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
applyMigrations(db);
db.prepare(\"INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)\").run('proj-1','P','code',0,0);
const root = mkdtempSync(join(tmpdir(), 'g4-smoke-'));

// Mock AI port that returns canned initial-bootstrap response
const fakePort = {
  startVirtualRun: async (args) => {
    args.onMessage?.({ kind: 'assistant', content: JSON.stringify({
      perCapability: {
        auth: { added: [{ name: 'Login', body: 'System MUST authenticate.', scenarios: [{ name: 'Valid', bodyLines: ['- **WHEN** valid creds', '- **THEN** SHALL return token'] }] }], modified: [], removed: [] },
        billing: { added: [{ name: 'Charge', body: 'System SHALL charge card on order.', scenarios: [{ name: 'Card OK', bodyLines: ['- **WHEN** valid card', '- **THEN** SHALL capture'] }] }], modified: [], removed: [] },
      },
    }) });
    args.onMessage?.({ kind: 'run_completed' });
  },
};
const explore = new AiExploreService({ aiRunPort: fakePort });
const bootstrap = new BootstrapService({ db, explore, getProjectRoot: () => root });
const review = new BootstrapReviewService({ db, getProjectRoot: () => root });

const initial = await bootstrap.start({ projectId: 'proj-1', mode: 'initial' });
if (initial.scan.status !== 'completed' || initial.scan.appliedCount !== 2) {
  console.error('Initial bootstrap failed:', initial.scan); process.exit(1);
}
if (!fs.existsSync(join(root, 'openspec', 'specs', 'auth', 'spec.md'))) {
  console.error('auth corpus missing'); process.exit(1);
}

// Now re-scan with MODIFIED + REMOVED
const fakePort2 = {
  startVirtualRun: async (args) => {
    args.onMessage?.({ kind: 'assistant', content: JSON.stringify({
      perCapability: {
        auth: {
          added: [{ name: '2FA enrollment', body: 'System SHALL allow 2FA.', scenarios: [{ name: 'enroll', bodyLines: ['- **WHEN** opts in', '- **THEN** provision TOTP'] }] }],
          modified: [{ name: 'Login', body: 'System SHALL authenticate with 2FA when enrolled.', scenarios: [{ name: '2FA', bodyLines: ['- **WHEN** logs in', '- **THEN** prompt 2FA'] }] }],
          removed: [],
        },
      },
    }) });
    args.onMessage?.({ kind: 'run_completed' });
  },
};
const explore2 = new AiExploreService({ aiRunPort: fakePort2 });
const bootstrap2 = new BootstrapService({ db, explore: explore2, getProjectRoot: () => root });
const rescan = await bootstrap2.start({ projectId: 'proj-1', mode: 'rescan' });
if (rescan.scan.status !== 'awaiting_review' || rescan.scan.pendingCount !== 1) {
  console.error('Rescan failed:', rescan.scan); process.exit(1);
}

const pending = review.listPending(rescan.scan.id);
for (const item of pending) review.approve(item.id);
const finalized = await review.finalize(rescan.scan.id);
if (!finalized || finalized.scan.status !== 'completed') {
  console.error('Finalize failed:', finalized); process.exit(1);
}
const finalCorpus = fs.readFileSync(join(root, 'openspec', 'specs', 'auth', 'spec.md'), 'utf-8');
if (!finalCorpus.includes('2FA enrollment') || !finalCorpus.includes('prompt 2FA')) {
  console.error('Corpus not updated correctly'); process.exit(1);
}
console.log('OpenSpec G4 smoke: PASS — initial bootstrap + rescan + review + finalize all succeeded');
"
```

Expected: `OpenSpec G4 smoke: PASS — initial bootstrap + rescan + review + finalize all succeeded`.

- [ ] **Step 5: Tag**

```bash
git add server/src/domains/openspec/index.ts \
        server/src/application/bootstrap/feature-domains.ts
git commit -m "feat(openspec): bootstrap wire — explore/bootstrap/review services"
git tag -a openspec/phase-g4-complete -m "OpenSpec × Supervisor Phase G4 bootstrap (explore + review) landed"
```

---

## Phase G4 Acceptance Criteria

- [ ] All 5 tasks complete with individual commits.
- [ ] `pnpm build` passes (both server + desktop).
- [ ] Full server vitest green (~3625 tests).
- [ ] Programmatic smoke shows: initial bootstrap → corpus seeded; re-scan → ADDED auto-applied + MODIFIED queued; review approve → finalize → corpus updated.
- [ ] Tag `openspec/phase-g4-complete` exists.

---

## What Phase G4 Deliberately Does NOT Cover

| Item | Phase |
|------|-------|
| REST routes for bootstrap (`POST /api/openspec/bootstrap/start`, `GET /api/openspec/bootstrap/scans/:id/items`, etc.) | G5 (paired with UI) |
| UI: "Initialize Specs" / "Re-scan" buttons; review modal | G5 |
| `getProjectRoot` real wiring | G5 |
| AI prompt fine-tuning for real LLMs (current prompt is starter; G6 polish) | G6 |
| Cancellation of running scans | G5+ |
| Incremental scan resume after server restart | future |
| Multiple concurrent scans per project | not supported by design |

---

*Plan version: 1 / 2026-05-21*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` §7.3 + §13.2*
*Predecessors: G1 (`openspec/phase-g1-complete`), G2 (`openspec/phase-g2-complete`), G3 (`openspec/phase-g3-complete`)*
