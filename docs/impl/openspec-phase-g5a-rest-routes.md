# OpenSpec × Supervisor — Phase G5a: Backend Wiring + REST Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose every G1–G4 service via HTTP so the desktop UI (G5b) and external tools can drive the whole lifecycle. Replace the `getProjectRoot` placeholder with a real lookup against `projects.root_path`.

**Architecture:** Five new route modules under `server/src/domains/{openspec,issue-orchestration,executor}/routes/*.ts`. Each follows the project's existing `(deps) => Router` pattern (see `server/src/domains/meta-workflow/routes.ts`). All routes mount under `/api/openspec/*` and `/api/issues/*` for clean namespacing. Tests use `supertest` against an in-process Express app + in-memory SQLite, mirroring the Meta Workflow Phase F REST tests.

**Tech Stack:** TypeScript strict, Express, supertest, the existing `authMiddleware` from `feature-domains.ts`, G1-G4 services.

**Spec reference:** `docs/design/openspec-integration-v2.zh-CN.md` §10 (UI surfaces — REST is the layer beneath those views), §11 G5 acceptance.

**Phase predecessors:**
- G1-G4 tags (`openspec/phase-g{1,2,3,4}-complete`)
- Plan commit `8ec48fbc` (G4)

---

## File Structure

```
server/src/domains/openspec/
├── routes/
│   ├── corpus-routes.ts                                         NEW (GET /corpus, GET /specs/:capability)
│   ├── spec-change-routes.ts                                    NEW (GET/PATCH proposal/design/tasks, delta-spec, list)
│   └── bootstrap-routes.ts                                      NEW (POST /bootstrap, GET review items, POST approve/reject/finalize)
└── __tests__/routes/
    ├── corpus-routes.test.ts                                    NEW
    ├── spec-change-routes.test.ts                               NEW
    └── bootstrap-routes.test.ts                                 NEW

server/src/domains/issue-orchestration/
├── routes.ts                                                    NEW (POST /issues parent/sub, GET /issues, PATCH status, POST close-and-archive)
└── __tests__/routes.test.ts                                     NEW

server/src/domains/executor/
├── routes.ts                                                    NEW (GET /executor-instances/:id, POST /executor-instances/:id/start|pause|cancel|markCompleted)
└── __tests__/routes.test.ts                                     NEW

server/src/application/bootstrap/
└── feature-domains.ts                                           MODIFY (replace getProjectRootPlaceholder with real lookup; mount 5 new routers)
```

7 tasks total.

```
Task 1 — Real getProjectRoot lookup (replace G3 placeholder)     ← independent
Task 2 — Corpus routes (read-only)                               ← needs T1
Task 3 — SpecChange routes                                       ← needs T1
Task 4 — Executor routes                                         ← needs T1
Task 5 — Issue + sub-issue routes (parent/sub + transitions)     ← needs T1
Task 6 — Bootstrap routes (scan/review)                          ← needs T1
Task 7 — Mount everything in feature-domains + smoke + tag       ← needs T2-T6
```

---

## Task 1: Real `getProjectRoot` lookup

**Files:**
- Modify: `server/src/application/bootstrap/feature-domains.ts`

**Goal:** Replace the throwing placeholder with a real lookup against `projects.root_path`. Throw a structured error when the project has no root_path set so HTTP callers get a 400.

- [ ] **Step 1: Replace `getProjectRootPlaceholder`**

In `server/src/application/bootstrap/feature-domains.ts`, find the existing `getProjectRootPlaceholder` (added in G3 Task 5). Replace it with:

```typescript
// G5a: real project root lookup. Returns the projects.root_path string.
// Throws if project is missing or has no root_path configured.
const getProjectRoot = (projectId: string): string => {
  const row = opts.db
    .prepare('SELECT root_path FROM projects WHERE id = ?')
    .get(projectId) as { root_path: string | null } | undefined;
  if (!row) {
    throw new Error(`Project not found: ${projectId}`);
  }
  if (!row.root_path) {
    throw new Error(`Project ${projectId} has no root_path configured (set via PATCH /api/projects/:id { rootPath })`);
  }
  return row.root_path;
};
```

Replace **every** reference to `getProjectRootPlaceholder` in this file with `getProjectRoot`. There are 3 call sites (SpecChangeService, ArchiveService, both Bootstrap services from G4).

- [ ] **Step 2: Type-check + full tests**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/server exec vitest run
```

Expected: tsc clean; tests still green (no test was exercising the throwing placeholder in production code paths — only synthetic smoke scripts which used their own `getProjectRoot`).

- [ ] **Step 3: Commit**

```bash
git add server/src/application/bootstrap/feature-domains.ts
git commit -m "feat(openspec): real getProjectRoot lookup against projects.root_path"
```

---

## Task 2: Corpus routes (read-only)

**Files:**
- Create: `server/src/domains/openspec/routes/corpus-routes.ts`
- Create: `server/src/domains/openspec/__tests__/routes/corpus-routes.test.ts`

**Goal:** Expose spec corpus for browsing. Endpoints:
- `GET /api/openspec/corpus?projectId=...` → list capabilities + counts
- `GET /api/openspec/corpus/:capability?projectId=...` → return parsed spec + raw markdown

- [ ] **Step 1: Create routes**

```typescript
// server/src/domains/openspec/routes/corpus-routes.ts
import { Router, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSpec } from '../markdown/spec-parser.js';

export interface CorpusRoutesDeps {
  getProjectRoot: (projectId: string) => string;
}

export function createCorpusRoutes(deps: CorpusRoutesDeps): Router {
  const router = Router();

  router.get('/corpus', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param required' });
      return;
    }
    try {
      const root = deps.getProjectRoot(projectId);
      const specsDir = path.join(root, 'openspec', 'specs');
      if (!fs.existsSync(specsDir)) {
        res.json({ capabilities: [] });
        return;
      }
      const capabilities = fs.readdirSync(specsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const file = path.join(specsDir, e.name, 'spec.md');
          if (!fs.existsSync(file)) return null;
          const parsed = parseSpec(fs.readFileSync(file, 'utf-8'));
          return {
            capability: e.name,
            requirementCount: parsed.requirements.length,
            scenarioCount: parsed.requirements.reduce((s, r) => s + r.scenarios.length, 0),
            lastUpdatedAt: fs.statSync(file).mtimeMs,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      res.json({ capabilities });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/corpus/:capability', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param required' });
      return;
    }
    try {
      const root = deps.getProjectRoot(projectId);
      const file = path.join(root, 'openspec', 'specs', req.params.capability, 'spec.md');
      if (!fs.existsSync(file)) {
        res.status(404).json({ error: 'capability not found in corpus' });
        return;
      }
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = parseSpec(raw);
      res.json({ capability: req.params.capability, raw, parsed });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/routes/corpus-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCorpusRoutes } from '../../routes/corpus-routes.js';

const SPEC = `# auth Specification

## Requirements
### Requirement: Login
System MUST authenticate.

#### Scenario: Valid
- **WHEN** valid
- **THEN** SHALL return token
`;

describe('Corpus routes', () => {
  let app: express.Express;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'corpus-'));
    app = express();
    app.use('/api/openspec', createCorpusRoutes({ getProjectRoot: () => projectRoot }));
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('GET /corpus requires projectId', async () => {
    const res = await request(app).get('/api/openspec/corpus');
    expect(res.status).toBe(400);
  });

  it('GET /corpus returns empty list when openspec/specs/ missing', async () => {
    const res = await request(app).get('/api/openspec/corpus?projectId=p1');
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual([]);
  });

  it('GET /corpus lists capabilities with counts', async () => {
    const dir = join(projectRoot, 'openspec', 'specs', 'auth');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.md'), SPEC);
    const res = await request(app).get('/api/openspec/corpus?projectId=p1');
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toHaveLength(1);
    expect(res.body.capabilities[0].capability).toBe('auth');
    expect(res.body.capabilities[0].requirementCount).toBe(1);
    expect(res.body.capabilities[0].scenarioCount).toBe(1);
  });

  it('GET /corpus/:capability returns parsed + raw', async () => {
    const dir = join(projectRoot, 'openspec', 'specs', 'auth');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.md'), SPEC);
    const res = await request(app).get('/api/openspec/corpus/auth?projectId=p1');
    expect(res.status).toBe(200);
    expect(res.body.capability).toBe('auth');
    expect(res.body.raw).toBe(SPEC);
    expect(res.body.parsed.requirements[0].name).toBe('Login');
  });

  it('GET /corpus/:capability returns 404 when capability missing', async () => {
    const res = await request(app).get('/api/openspec/corpus/missing?projectId=p1');
    expect(res.status).toBe(404);
  });

  it('returns 400 when getProjectRoot throws', async () => {
    const app2 = express();
    app2.use('/api/openspec', createCorpusRoutes({ getProjectRoot: () => { throw new Error('no root'); } }));
    const res = await request(app2).get('/api/openspec/corpus?projectId=p1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no root/);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/routes/corpus-routes.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 6 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/routes/corpus-routes.ts \
        server/src/domains/openspec/__tests__/routes/corpus-routes.test.ts
git commit -m "feat(openspec): REST routes for spec corpus browsing"
```

---

## Task 3: SpecChange routes

**Files:**
- Create: `server/src/domains/openspec/routes/spec-change-routes.ts`
- Create: `server/src/domains/openspec/__tests__/routes/spec-change-routes.test.ts`

**Goal:** Read/write artifacts of an active SpecChange.

Endpoints:
- `GET /api/openspec/spec-changes?projectId=...` → list
- `GET /api/openspec/spec-changes/:id` → details (metadata only)
- `GET /api/openspec/spec-changes/:id/proposal` → raw markdown
- `GET /api/openspec/spec-changes/:id/design`
- `GET /api/openspec/spec-changes/:id/tasks`
- `GET /api/openspec/spec-changes/:id/delta/:capability`
- `PUT /api/openspec/spec-changes/:id/proposal` body: `{ content: string }`
- `PUT /api/openspec/spec-changes/:id/design`
- `PUT /api/openspec/spec-changes/:id/tasks`
- `PUT /api/openspec/spec-changes/:id/delta/:capability`

- [ ] **Step 1: Create routes**

```typescript
// server/src/domains/openspec/routes/spec-change-routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { SpecChangeService } from '../spec-change-service.js';
import { SpecChangeRepository } from '../../spec-change/spec-change-repository.js';
import type { Database } from 'better-sqlite3';

export interface SpecChangeRoutesDeps {
  db: Database;
  specChangeService: SpecChangeService;
}

export function createSpecChangeRoutes(deps: SpecChangeRoutesDeps): Router {
  const router = Router();
  router.use(express.json());
  const repo = new SpecChangeRepository(deps.db);

  router.get('/spec-changes', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
    res.json({ specChanges: repo.listByProject(projectId) });
  });

  router.get('/spec-changes/:id', (req: Request, res: Response) => {
    const sc = repo.findById(req.params.id);
    if (!sc) { res.status(404).json({ error: 'spec_change not found' }); return; }
    res.json({ specChange: sc });
  });

  const reader = (kind: 'proposal' | 'design' | 'tasks') => (req: Request, res: Response) => {
    try {
      const fn = kind === 'proposal' ? deps.specChangeService.readProposal
        : kind === 'design' ? deps.specChangeService.readDesign
        : deps.specChangeService.readTasks;
      res.type('text/markdown').send(fn.call(deps.specChangeService, req.params.id));
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  };
  router.get('/spec-changes/:id/proposal', reader('proposal'));
  router.get('/spec-changes/:id/design', reader('design'));
  router.get('/spec-changes/:id/tasks', reader('tasks'));

  router.get('/spec-changes/:id/delta/:capability', (req: Request, res: Response) => {
    try {
      res.type('text/markdown').send(deps.specChangeService.readDeltaSpec(req.params.id, req.params.capability));
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  const writer = (kind: 'proposal' | 'design' | 'tasks') => (req: Request, res: Response) => {
    const content = (req.body as { content?: unknown }).content;
    if (typeof content !== 'string') { res.status(400).json({ error: 'content (string) required in body' }); return; }
    try {
      const fn = kind === 'proposal' ? deps.specChangeService.writeProposal
        : kind === 'design' ? deps.specChangeService.writeDesign
        : deps.specChangeService.writeTasks;
      res.json({ specChange: fn.call(deps.specChangeService, req.params.id, content) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  };
  router.put('/spec-changes/:id/proposal', writer('proposal'));
  router.put('/spec-changes/:id/design', writer('design'));
  router.put('/spec-changes/:id/tasks', writer('tasks'));

  router.put('/spec-changes/:id/delta/:capability', (req: Request, res: Response) => {
    const content = (req.body as { content?: unknown }).content;
    if (typeof content !== 'string') { res.status(400).json({ error: 'content (string) required in body' }); return; }
    try {
      res.json({ specChange: deps.specChangeService.writeDeltaSpec(req.params.id, req.params.capability, content) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/routes/spec-change-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../../spec-change-service.js';
import { createSpecChangeRoutes } from '../../routes/spec-change-routes.js';

describe('SpecChange routes', () => {
  let db: Database.Database;
  let projectRoot: string;
  let app: express.Express;
  let svc: SpecChangeService;
  let specChangeId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'sc-routes-'));
    svc = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    specChangeId = svc.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' }).id;
    app = express();
    app.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc }));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('GET /spec-changes lists by project', async () => {
    const res = await request(app).get('/api/openspec/spec-changes?projectId=proj-1');
    expect(res.status).toBe(200);
    expect(res.body.specChanges).toHaveLength(1);
  });

  it('GET /spec-changes/:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/openspec/spec-changes/nope');
    expect(res.status).toBe(404);
  });

  it('GET /spec-changes/:id/proposal returns skeleton markdown', async () => {
    const res = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/proposal`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Proposal');
  });

  it('PUT /spec-changes/:id/proposal updates and bumps status', async () => {
    const res = await request(app)
      .put(`/api/openspec/spec-changes/${specChangeId}/proposal`)
      .send({ content: '# new\n' });
    expect(res.status).toBe(200);
    expect(res.body.specChange.status).toBe('proposing');
    const get = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/proposal`);
    expect(get.text).toBe('# new\n');
  });

  it('PUT requires content string', async () => {
    const res = await request(app).put(`/api/openspec/spec-changes/${specChangeId}/proposal`).send({});
    expect(res.status).toBe(400);
  });

  it('PUT /spec-changes/:id/delta/:capability writes delta + tracks path', async () => {
    const res = await request(app)
      .put(`/api/openspec/spec-changes/${specChangeId}/delta/auth`)
      .send({ content: '## ADDED Requirements\n' });
    expect(res.status).toBe(200);
    expect(res.body.specChange.deltaSpecPaths).toContain('openspec/changes/x/specs/auth/spec.md');
    const get = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/delta/auth`);
    expect(get.status).toBe(200);
    expect(get.text).toContain('ADDED');
  });

  it('GET /spec-changes/:id/delta/:capability returns 404 when not written', async () => {
    const res = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/delta/missing`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/routes/spec-change-routes.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 7 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/routes/spec-change-routes.ts \
        server/src/domains/openspec/__tests__/routes/spec-change-routes.test.ts
git commit -m "feat(openspec): REST routes for spec_change CRUD + artifacts"
```

---

## Task 4: Executor routes

**Files:**
- Create: `server/src/domains/executor/routes.ts`
- Create: `server/src/domains/executor/__tests__/routes.test.ts`

**Goal:** Drive executor lifecycle via HTTP.

Endpoints:
- `GET /api/openspec/executor-instances?specChangeId=...` → list
- `GET /api/openspec/executor-instances/:id` → details
- `POST /api/openspec/executor-instances` body: `{ projectId, specChangeId, type, underlyingId? }` → create
- `POST /api/openspec/executor-instances/:id/start`
- `POST /api/openspec/executor-instances/:id/pause`
- `POST /api/openspec/executor-instances/:id/resume`
- `POST /api/openspec/executor-instances/:id/cancel`
- `POST /api/openspec/executor-instances/:id/mark-completed`
- `POST /api/openspec/executor-instances/:id/refresh`

- [ ] **Step 1: Create routes**

```typescript
// server/src/domains/executor/routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { Database } from 'better-sqlite3';
import { ExecutorInstanceRepository } from './executor-instance-repository.js';
import type { ExecutorService } from '../issue-orchestration/executor-service.js';
import type { ExecutorType } from '@my-claudia/shared/features/executor';

export interface ExecutorRoutesDeps {
  db: Database;
  executorService: ExecutorService;
}

export function createExecutorRoutes(deps: ExecutorRoutesDeps): Router {
  const router = Router();
  router.use(express.json());
  const repo = new ExecutorInstanceRepository(deps.db);

  router.get('/executor-instances', (req: Request, res: Response) => {
    const specChangeId = req.query.specChangeId as string | undefined;
    if (!specChangeId) { res.status(400).json({ error: 'specChangeId required' }); return; }
    res.json({ executorInstances: repo.listBySpecChange(specChangeId) });
  });

  router.get('/executor-instances/:id', (req: Request, res: Response) => {
    const inst = repo.findById(req.params.id);
    if (!inst) { res.status(404).json({ error: 'executor_instance not found' }); return; }
    res.json({ executorInstance: inst });
  });

  router.post('/executor-instances', (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; specChangeId?: string; type?: ExecutorType; underlyingId?: string };
    if (!body.projectId || !body.specChangeId || !body.type) {
      res.status(400).json({ error: 'projectId, specChangeId, type required' });
      return;
    }
    try {
      const created = repo.create({
        projectId: body.projectId,
        specChangeId: body.specChangeId,
        type: body.type,
        underlyingId: body.underlyingId,
      });
      res.status(201).json({ executorInstance: created });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  const op = (action: (id: string) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await action(req.params.id);
      const inst = repo.findById(req.params.id);
      res.json({ executorInstance: inst });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  };
  router.post('/executor-instances/:id/start',          op((id) => deps.executorService.start(id)));
  router.post('/executor-instances/:id/pause',          op((id) => deps.executorService.pause(id)));
  router.post('/executor-instances/:id/resume',         op((id) => deps.executorService.resume(id)));
  router.post('/executor-instances/:id/cancel',         op((id) => deps.executorService.cancel(id)));
  router.post('/executor-instances/:id/mark-completed', op((id) => deps.executorService.markCompleted(id)));
  router.post('/executor-instances/:id/refresh',        op((id) => deps.executorService.refresh(id)));

  return router;
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/executor/__tests__/routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository, ExecutorRegistry, ManualAdapter } from '../index.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { ExecutorService } from '../../issue-orchestration/executor-service.js';
import { createExecutorRoutes } from '../routes.js';
import type { IssueDomainEvent } from '../../issue-orchestration/events.js';

describe('Executor routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let instId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(`INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const executorService = new ExecutorService({ db, registry, dispatcher });
    instId = new ExecutorInstanceRepository(db).create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' }).id;
    app = express();
    app.use('/api/openspec', createExecutorRoutes({ db, executorService }));
  });

  it('GET /executor-instances requires specChangeId', async () => {
    const res = await request(app).get('/api/openspec/executor-instances');
    expect(res.status).toBe(400);
  });

  it('GET /executor-instances lists by spec_change', async () => {
    const res = await request(app).get('/api/openspec/executor-instances?specChangeId=sc');
    expect(res.status).toBe(200);
    expect(res.body.executorInstances).toHaveLength(1);
  });

  it('POST /executor-instances/:id/start advances to executing', async () => {
    const res = await request(app).post(`/api/openspec/executor-instances/${instId}/start`).send({});
    expect(res.status).toBe(200);
    expect(res.body.executorInstance.statusSummary).toBe('executing');
  });

  it('POST /executor-instances/:id/mark-completed → completed', async () => {
    await request(app).post(`/api/openspec/executor-instances/${instId}/start`).send({});
    const res = await request(app).post(`/api/openspec/executor-instances/${instId}/mark-completed`).send({});
    expect(res.status).toBe(200);
    expect(res.body.executorInstance.statusSummary).toBe('completed');
  });

  it('POST /executor-instances creates a new manual instance', async () => {
    const res = await request(app).post('/api/openspec/executor-instances').send({
      projectId: 'proj-1', specChangeId: 'sc', type: 'manual',
    });
    expect(res.status).toBe(201);
    expect(res.body.executorInstance.type).toBe('manual');
  });

  it('POST /executor-instances rejects missing fields', async () => {
    const res = await request(app).post('/api/openspec/executor-instances').send({ projectId: 'proj-1' });
    expect(res.status).toBe(400);
  });

  it('GET /executor-instances/:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/openspec/executor-instances/nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/executor/__tests__/routes.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 7 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/executor/routes.ts \
        server/src/domains/executor/__tests__/routes.test.ts
git commit -m "feat(openspec): REST routes for ExecutorInstance lifecycle"
```

---

## Task 5: Issue + sub-issue routes

**Files:**
- Create: `server/src/domains/issue-orchestration/routes.ts`
- Create: `server/src/domains/issue-orchestration/__tests__/routes.test.ts`

**Goal:** Expose IssueLifecycle + AnonymousIssueService over HTTP.

Endpoints:
- `POST /api/issues/features` body: `{ projectId, title, description?, priority?, labels? }` → create parent
- `POST /api/issues/sub` body: `{ projectId, parentIssueId?, type, title, slug?, description?, priority?, labels?, isAnonymous? }` → returns `{ issue, specChange }`
- `POST /api/issues/anonymous` body: `{ projectId, title }` → wraps `AnonymousIssueService.createAnonymous`
- `GET /api/issues/:id` → returns issue (parent or sub)
- `GET /api/issues/:id/sub-issues` → list children
- `PATCH /api/issues/:id/status` body: `{ status }` → transitionStatus
- `POST /api/issues/:id/close-and-archive` → calls closeSubIssueAndArchive, returns `{ issue, archive }`

- [ ] **Step 1: Create routes**

```typescript
// server/src/domains/issue-orchestration/routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { IssueLifecycle } from './issue-lifecycle.js';
import type { AnonymousIssueService } from './anonymous-issue-service.js';
import type { LocalIssueStatus, LocalIssueType } from '@my-claudia/shared/features/local-issue';

export interface IssueRoutesDeps {
  lifecycle: IssueLifecycle;
  anonymousService: AnonymousIssueService;
}

export function createIssueRoutes(deps: IssueRoutesDeps): Router {
  const router = Router();
  router.use(express.json());

  router.post('/features', (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; title?: string; description?: string; priority?: string; labels?: string[] };
    if (!body.projectId || !body.title) { res.status(400).json({ error: 'projectId + title required' }); return; }
    try {
      const issue = deps.lifecycle.createParent({
        projectId: body.projectId, title: body.title,
        description: body.description,
        priority: body.priority as never,
        labels: body.labels,
      });
      res.status(201).json({ issue });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/sub', (req: Request, res: Response) => {
    const body = req.body as {
      projectId?: string; parentIssueId?: string; type?: LocalIssueType; title?: string;
      slug?: string; description?: string; priority?: string; labels?: string[]; isAnonymous?: boolean;
    };
    if (!body.projectId || !body.type || !body.title) {
      res.status(400).json({ error: 'projectId + type + title required' }); return;
    }
    if (body.type === 'feature') { res.status(400).json({ error: 'sub-issue cannot be type=feature' }); return; }
    try {
      const out = deps.lifecycle.createSubIssue({
        projectId: body.projectId,
        type: body.type as Exclude<LocalIssueType, 'feature'>,
        title: body.title,
        parentIssueId: body.parentIssueId,
        slug: body.slug,
        description: body.description,
        priority: body.priority as never,
        labels: body.labels,
        isAnonymous: body.isAnonymous,
      });
      res.status(201).json(out);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/anonymous', (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; title?: string };
    if (!body.projectId || !body.title) { res.status(400).json({ error: 'projectId + title required' }); return; }
    try {
      const out = deps.anonymousService.createAnonymous({ projectId: body.projectId, title: body.title });
      res.status(201).json(out);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.get('/:id', (req: Request, res: Response) => {
    const issue = deps.lifecycle.getIssue(req.params.id);
    if (!issue) { res.status(404).json({ error: 'issue not found' }); return; }
    res.json({ issue });
  });

  router.get('/:id/sub-issues', (req: Request, res: Response) => {
    res.json({ subIssues: deps.lifecycle.listSubIssues(req.params.id) });
  });

  router.patch('/:id/status', (req: Request, res: Response) => {
    const body = req.body as { status?: LocalIssueStatus };
    if (!body.status) { res.status(400).json({ error: 'status required' }); return; }
    try {
      res.json({ issue: deps.lifecycle.transitionStatus(req.params.id, body.status) });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/:id/close-and-archive', async (req: Request, res: Response) => {
    try {
      const out = await deps.lifecycle.closeSubIssueAndArchive(req.params.id);
      res.json(out);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  return router;
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/issue-orchestration/__tests__/routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService, ArchiveService } from '../../openspec/index.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import { AnonymousIssueService } from '../anonymous-issue-service.js';
import { createIssueRoutes } from '../routes.js';
import type { IssueDomainEvent } from '../events.js';

describe('Issue routes', () => {
  let db: Database.Database;
  let projectRoot: string;
  let app: express.Express;
  let lifecycle: IssueLifecycle;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'issue-routes-'));
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const archiveService = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher, archiveService });
    const anonymousService = new AnonymousIssueService(lifecycle);
    app = express();
    app.use('/api/issues', createIssueRoutes({ lifecycle, anonymousService }));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('POST /features creates a parent issue', async () => {
    const res = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'Add 2FA' });
    expect(res.status).toBe(201);
    expect(res.body.issue.type).toBe('feature');
  });

  it('POST /sub creates a sub-issue + spec_change', async () => {
    const res = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'Initial flow' });
    expect(res.status).toBe(201);
    expect(res.body.issue.type).toBe('implement');
    expect(res.body.specChange.slug).toBe('initial-flow');
  });

  it('POST /sub rejects type=feature', async () => {
    const res = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'feature', title: 'X' });
    expect(res.status).toBe(400);
  });

  it('POST /anonymous creates anonymous sub-issue', async () => {
    const res = await request(app).post('/api/issues/anonymous').send({ projectId: 'proj-1', title: 'Quick fix' });
    expect(res.status).toBe(201);
    expect(res.body.issue.isAnonymous).toBe(true);
    expect(res.body.issue.parentIssueId).toBeUndefined();
  });

  it('GET /:id returns issue', async () => {
    const create = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'F' });
    const res = await request(app).get(`/api/issues/${create.body.issue.id}`);
    expect(res.status).toBe(200);
    expect(res.body.issue.id).toBe(create.body.issue.id);
  });

  it('GET /:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/issues/nope');
    expect(res.status).toBe(404);
  });

  it('GET /:id/sub-issues lists children', async () => {
    const f = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'F' });
    await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'S', parentIssueId: f.body.issue.id });
    const res = await request(app).get(`/api/issues/${f.body.issue.id}/sub-issues`);
    expect(res.body.subIssues).toHaveLength(1);
  });

  it('PATCH /:id/status transitions', async () => {
    const sub = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'A' });
    const res = await request(app).patch(`/api/issues/${sub.body.issue.id}/status`).send({ status: 'planning' });
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('planning');
  });

  it('PATCH /:id/status rejects illegal transition', async () => {
    const sub = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'A' });
    const res = await request(app).patch(`/api/issues/${sub.body.issue.id}/status`).send({ status: 'reviewing' });
    expect(res.status).toBe(400);
  });

  it('POST /:id/close-and-archive runs through archive', async () => {
    const sub = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'A' });
    const id = sub.body.issue.id;
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'planning' });
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'tasks_ready' });
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'executing' });
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'reviewing' });
    const res = await request(app).post(`/api/issues/${id}/close-and-archive`).send({});
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('closed');
    expect(res.body.archive).toBeDefined();
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/issue-orchestration/__tests__/routes.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 10 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/issue-orchestration/routes.ts \
        server/src/domains/issue-orchestration/__tests__/routes.test.ts
git commit -m "feat(issue-orchestration): REST routes for issue + sub-issue lifecycle"
```

---

## Task 6: Bootstrap routes

**Files:**
- Create: `server/src/domains/openspec/routes/bootstrap-routes.ts`
- Create: `server/src/domains/openspec/__tests__/routes/bootstrap-routes.test.ts`

**Goal:** Drive the scan flow over HTTP.

Endpoints:
- `POST /api/openspec/bootstrap/scans` body: `{ projectId, mode: 'initial' | 'rescan' }` → start scan
- `GET /api/openspec/bootstrap/scans?projectId=...` → list scans
- `GET /api/openspec/bootstrap/scans/:id` → details
- `GET /api/openspec/bootstrap/scans/:id/items?status=pending|all` → review items
- `POST /api/openspec/bootstrap/items/:itemId/approve`
- `POST /api/openspec/bootstrap/items/:itemId/reject`
- `POST /api/openspec/bootstrap/scans/:id/finalize`

- [ ] **Step 1: Create routes**

```typescript
// server/src/domains/openspec/routes/bootstrap-routes.ts
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { BootstrapService } from '../bootstrap-service.js';
import type { BootstrapReviewService } from '../bootstrap-review-service.js';
import { BootstrapScanRepository } from '../repositories/bootstrap-scan-repository.js';
import type { Database } from 'better-sqlite3';

export interface BootstrapRoutesDeps {
  db: Database;
  bootstrapService: BootstrapService;
  reviewService: BootstrapReviewService;
}

export function createBootstrapRoutes(deps: BootstrapRoutesDeps): Router {
  const router = Router();
  router.use(express.json());
  const scanRepo = new BootstrapScanRepository(deps.db);

  router.post('/bootstrap/scans', async (req: Request, res: Response) => {
    const body = req.body as { projectId?: string; mode?: 'initial' | 'rescan' };
    if (!body.projectId || !body.mode) { res.status(400).json({ error: 'projectId + mode required' }); return; }
    if (body.mode !== 'initial' && body.mode !== 'rescan') { res.status(400).json({ error: "mode must be 'initial' or 'rescan'" }); return; }
    try {
      const result = await deps.bootstrapService.start({ projectId: body.projectId, mode: body.mode });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/bootstrap/scans', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
    res.json({ scans: scanRepo.listByProject(projectId) });
  });

  router.get('/bootstrap/scans/:id', (req: Request, res: Response) => {
    const scan = scanRepo.findById(req.params.id);
    if (!scan) { res.status(404).json({ error: 'scan not found' }); return; }
    res.json({ scan });
  });

  router.get('/bootstrap/scans/:id/items', (req: Request, res: Response) => {
    const filter = (req.query.status as string | undefined) ?? 'all';
    const items = filter === 'pending'
      ? deps.reviewService.listPending(req.params.id)
      : deps.reviewService.listAll(req.params.id);
    res.json({ items });
  });

  router.post('/bootstrap/items/:itemId/approve', (req: Request, res: Response) => {
    try { res.json({ item: deps.reviewService.approve(req.params.itemId) }); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/bootstrap/items/:itemId/reject', (req: Request, res: Response) => {
    try { res.json({ item: deps.reviewService.reject(req.params.itemId) }); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  router.post('/bootstrap/scans/:id/finalize', async (req: Request, res: Response) => {
    try {
      const result = await deps.reviewService.finalize(req.params.id);
      if (!result) { res.status(409).json({ error: 'pending items remain; finalize aborted' }); return; }
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Write tests**

```typescript
// server/src/domains/openspec/__tests__/routes/bootstrap-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { AiExploreService, BootstrapService, BootstrapReviewService } from '../../index.js';
import { createBootstrapRoutes } from '../../routes/bootstrap-routes.js';

function mkPort(jsonObj: unknown) {
  return {
    async startVirtualRun(args: { onMessage?: (m: { kind: string; content?: string }) => void }) {
      args.onMessage?.({ kind: 'assistant', content: JSON.stringify(jsonObj) });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

describe('Bootstrap routes', () => {
  let db: Database.Database;
  let projectRoot: string;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'bootstrap-routes-'));
    const explore = new AiExploreService({ aiRunPort: mkPort({
      perCapability: { auth: { added: [{ name: 'A', body: 'MUST', scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }] }], modified: [], removed: [] } },
    }) });
    const bootstrapService = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    const reviewService = new BootstrapReviewService({ db, getProjectRoot: () => projectRoot });
    app = express();
    app.use('/api/openspec', createBootstrapRoutes({ db, bootstrapService, reviewService }));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('POST /bootstrap/scans starts a scan', async () => {
    const res = await request(app).post('/api/openspec/bootstrap/scans').send({ projectId: 'proj-1', mode: 'initial' });
    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe('completed');
    expect(res.body.scan.appliedCount).toBe(1);
  });

  it('POST /bootstrap/scans rejects invalid mode', async () => {
    const res = await request(app).post('/api/openspec/bootstrap/scans').send({ projectId: 'proj-1', mode: 'wrong' });
    expect(res.status).toBe(400);
  });

  it('GET /bootstrap/scans lists', async () => {
    await request(app).post('/api/openspec/bootstrap/scans').send({ projectId: 'proj-1', mode: 'initial' });
    const res = await request(app).get('/api/openspec/bootstrap/scans?projectId=proj-1');
    expect(res.body.scans).toHaveLength(1);
  });

  it('GET /bootstrap/scans/:id returns 404 for unknown', async () => {
    const res = await request(app).get('/api/openspec/bootstrap/scans/nope');
    expect(res.status).toBe(404);
  });

  it('GET /bootstrap/scans/:id/items lists items', async () => {
    const start = await request(app).post('/api/openspec/bootstrap/scans').send({ projectId: 'proj-1', mode: 'initial' });
    const id = start.body.scan.id;
    const res = await request(app).get(`/api/openspec/bootstrap/scans/${id}/items`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('POST /bootstrap/scans/:id/finalize returns 409 when items pending', async () => {
    // Seed a scan with pending items by stubbing reviewService directly through DB
    const start = await request(app).post('/api/openspec/bootstrap/scans').send({ projectId: 'proj-1', mode: 'initial' });
    const id = start.body.scan.id;
    db.prepare(`UPDATE bootstrap_scans SET status='awaiting_review' WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run('it', id, 'cap', 'modify', '{}', 'pending', Date.now());
    const res = await request(app).post(`/api/openspec/bootstrap/scans/${id}/finalize`).send({});
    expect(res.status).toBe(409);
  });

  it('POST /bootstrap/items/:itemId/approve marks approved', async () => {
    const start = await request(app).post('/api/openspec/bootstrap/scans').send({ projectId: 'proj-1', mode: 'initial' });
    db.prepare(`INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run('it', start.body.scan.id, 'cap', 'modify', '{"name":"x","body":"MUST","scenarios":[{"name":"s","bodyLines":["- **WHEN** x"]}]}', 'pending', Date.now());
    const res = await request(app).post('/api/openspec/bootstrap/items/it/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('approved');
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm --filter @my-claudia/server exec vitest run src/domains/openspec/__tests__/routes/bootstrap-routes.test.ts
pnpm --filter @my-claudia/server exec tsc --noEmit
```

Expected: 7 tests green, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/domains/openspec/routes/bootstrap-routes.ts \
        server/src/domains/openspec/__tests__/routes/bootstrap-routes.test.ts
git commit -m "feat(openspec): REST routes for bootstrap scan + review"
```

---

## Task 7: Mount everything + smoke + tag

**Files:**
- Modify: `server/src/application/bootstrap/feature-domains.ts`

**Goal:** Mount all 5 new routers under `/api/openspec/*` and `/api/issues/*`; full regression; smoke; tag.

- [ ] **Step 1: Mount routers**

In `server/src/application/bootstrap/feature-domains.ts`, after the existing G3 + G4 wiring blocks (and before the `return` at the end of `registerFeatureDomains`), add:

```typescript
import { createCorpusRoutes } from '../../domains/openspec/routes/corpus-routes.js';
import { createSpecChangeRoutes } from '../../domains/openspec/routes/spec-change-routes.js';
import { createBootstrapRoutes } from '../../domains/openspec/routes/bootstrap-routes.js';
import { createExecutorRoutes } from '../../domains/executor/routes.js';
import { createIssueRoutes } from '../../domains/issue-orchestration/routes.js';

// ... after existing wiring ...

app.use('/api/openspec', authMiddleware, createCorpusRoutes({ getProjectRoot }));
app.use('/api/openspec', authMiddleware, createSpecChangeRoutes({ db: opts.db, specChangeService }));
app.use('/api/openspec', authMiddleware, createExecutorRoutes({ db: opts.db, executorService: issueOrchestration.executorService }));
app.use('/api/openspec', authMiddleware, createBootstrapRoutes({ db: opts.db, bootstrapService, reviewService: bootstrapReviewService }));
app.use('/api/issues',   authMiddleware, createIssueRoutes({ lifecycle: issueOrchestration.lifecycle, anonymousService: issueOrchestration.anonymousService }));
```

> Note: Multiple `app.use('/api/openspec', ...)` mounts share the path prefix — that's fine in Express; each router handles only its own sub-paths.

- [ ] **Step 2: Build + tests + tsc**

```bash
pnpm --filter @my-claudia/server exec tsc --noEmit
pnpm --filter @my-claudia/desktop exec tsc --noEmit
pnpm build
pnpm --filter @my-claudia/server exec vitest run
```

Expected: tsc clean both packages; build clean; ~3675 tests green (G4's 3631 + ~44 new G5a tests).

- [ ] **Step 3: End-to-end smoke through HTTP**

```bash
cd /Users/haozhang/SourceCode/zhvala/my-claudia && node --input-type=module -e "
import { mkdtempSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { applyMigrations } from './server/dist/infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository, ExecutorRegistry, ManualAdapter } from './server/dist/domains/executor/index.js';
import { SpecChangeService, ArchiveService, AiExploreService, BootstrapService, BootstrapReviewService } from './server/dist/domains/openspec/index.js';
import { EventDispatcher } from './server/dist/domains/supervision/event-dispatcher.js';
import { ExecutorService, IssueLifecycle, AnonymousIssueService } from './server/dist/domains/issue-orchestration/index.js';
import { createCorpusRoutes } from './server/dist/domains/openspec/routes/corpus-routes.js';
import { createSpecChangeRoutes } from './server/dist/domains/openspec/routes/spec-change-routes.js';
import { createExecutorRoutes } from './server/dist/domains/executor/routes.js';
import { createBootstrapRoutes } from './server/dist/domains/openspec/routes/bootstrap-routes.js';
import { createIssueRoutes } from './server/dist/domains/issue-orchestration/routes.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
applyMigrations(db);
const projectRoot = mkdtempSync(join(tmpdir(), 'g5a-smoke-'));
db.prepare(\"INSERT INTO projects (id, name, type, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)\").run('proj-1','P','code', projectRoot, 0, 0);

const sc = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
const ar = new ArchiveService({ db, getProjectRoot: () => projectRoot });
const dispatcher = new EventDispatcher();
const registry = new ExecutorRegistry();
registry.register('manual', (inst) => new ManualAdapter(db, inst));
const execSvc = new ExecutorService({ db, registry, dispatcher });
const lifecycle = new IssueLifecycle({ db, specChangeService: sc, dispatcher, archiveService: ar });
const anon = new AnonymousIssueService(lifecycle);
const explore = new AiExploreService({ aiRunPort: { startVirtualRun: async (a) => { a.onMessage?.({ kind: 'assistant', content: JSON.stringify({ perCapability: { auth: { added: [{ name: 'Login', body: 'MUST authenticate', scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }] }], modified: [], removed: [] } } }) }); a.onMessage?.({ kind: 'run_completed' }); } } });
const bootstrap = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
const review = new BootstrapReviewService({ db, getProjectRoot: () => projectRoot });

const app = express();
app.use(express.json());
app.use('/api/openspec', createCorpusRoutes({ getProjectRoot: () => projectRoot }));
app.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: sc }));
app.use('/api/openspec', createExecutorRoutes({ db, executorService: execSvc }));
app.use('/api/openspec', createBootstrapRoutes({ db, bootstrapService: bootstrap, reviewService: review }));
app.use('/api/issues', createIssueRoutes({ lifecycle, anonymousService: anon }));

const server = app.listen(0, async () => {
  const port = server.address().port;
  const base = \`http://127.0.0.1:\${port}\`;
  const fetch_ = async (p, opts) => { const r = await fetch(\`\${base}\${p}\`, opts); return { status: r.status, body: r.status === 204 ? null : await r.json() }; };

  // 1. Bootstrap
  let r = await fetch_('/api/openspec/bootstrap/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'proj-1', mode: 'initial' }) });
  if (r.status !== 201) { console.error('bootstrap failed', r); process.exit(1); }
  console.log('1. bootstrap →', r.body.scan.status, 'applied=', r.body.scan.appliedCount);

  // 2. Create anonymous sub-issue
  r = await fetch_('/api/issues/anonymous', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'proj-1', title: 'Quick fix' }) });
  const issueId = r.body.issue.id;
  const scId = r.body.specChange.id;
  console.log('2. anon sub-issue →', issueId, 'spec_change=', scId);

  // 3. Write a delta
  r = await fetch_(\`/api/openspec/spec-changes/\${scId}/delta/auth\`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '## MODIFIED Requirements\n### Requirement: Login\nSystem MUST authenticate with 2FA.\n#### Scenario: 2FA\n- **WHEN** logs in\n- **THEN** prompt 2FA\n' }) });
  console.log('3. delta written →', r.body.specChange.deltaSpecPaths);

  // 4. Transition + executor
  await fetch_(\`/api/issues/\${issueId}/status\`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'planning' }) });
  await fetch_(\`/api/issues/\${issueId}/status\`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'tasks_ready' }) });
  r = await fetch_('/api/openspec/executor-instances', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'proj-1', specChangeId: scId, type: 'manual' }) });
  const execId = r.body.executorInstance.id;
  await fetch_(\`/api/openspec/executor-instances/\${execId}/start\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await fetch_(\`/api/openspec/executor-instances/\${execId}/mark-completed\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  console.log('4. executor lifecycle → completed');

  // 5. Close + archive
  r = await fetch_(\`/api/issues/\${issueId}/close-and-archive\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!r.body.archive?.ok) { console.error('archive failed', r.body); process.exit(1); }
  console.log('5. archive →', r.body.archive.archivedDir);

  // 6. Verify corpus
  r = await fetch_('/api/openspec/corpus?projectId=proj-1');
  console.log('6. corpus caps →', r.body.capabilities.map(c => c.capability));
  if (!r.body.capabilities.find(c => c.capability === 'auth')) { console.error('corpus missing auth'); process.exit(1); }

  console.log('OpenSpec G5a smoke: PASS — full HTTP chain works');
  server.close();
  process.exit(0);
});
"
```

Expected: chain completes; `OpenSpec G5a smoke: PASS — full HTTP chain works`.

- [ ] **Step 4: Commit + tag**

```bash
git add server/src/application/bootstrap/feature-domains.ts
git commit -m "feat(openspec): mount all G5a routers under /api/openspec + /api/issues"
git tag -a openspec/phase-g5a-complete -m "OpenSpec × Supervisor Phase G5a backend wiring + REST routes landed"
```

---

## Phase G5a Acceptance Criteria

- [ ] All 7 tasks complete with individual commits.
- [ ] `pnpm build` passes (both server + desktop tsc).
- [ ] Full server vitest green (~3675 tests).
- [ ] End-to-end HTTP smoke runs through: bootstrap → anonymous sub-issue → delta → executor lifecycle → close → archive → corpus updated.
- [ ] Tag `openspec/phase-g5a-complete` exists.

---

## What Phase G5a Deliberately Does NOT Cover

| Item | Phase |
|------|-------|
| Desktop UI (Issue list, Sub-issue detail, Spec corpus browser, dialogs) | G5b |
| WebSocket push of executor / sub-issue status changes | G5b (UI may use polling first) |
| Optimistic UI updates | G5b |
| Prompt fine-tuning for real LLMs | G6 |
| Validation diagnostics surfaced via REST (validator runs but errors aren't yet a structured response field on archive endpoints) | G6 |

---

*Plan version: 1 / 2026-05-21*
*Design reference: `docs/design/openspec-integration-v2.zh-CN.md` §10 + §11 G5*
*Predecessors: G1 / G2 / G3 / G4 (tags `openspec/phase-g{1,2,3,4}-complete`)*
