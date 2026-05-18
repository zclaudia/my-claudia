# Meta Workflow — Phase A: Foundation (Data Model & Types) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the SQLite schema, shared TypeScript types, protocol message scaffolding, and phase-template stubs that all subsequent Meta Workflow phases (B–F) will build on. No runtime logic. No UI. Output is "what downstream code can import".

**Architecture:** Five new SQLite tables added in a single migration (069); one new shared feature module (`shared/src/features/meta-workflow.ts`) for domain types; one new protocol-messages module wired into the existing `ServerMessage` union (push events only — CRUD messages are deferred to Phase B when handlers exist); a new server domain folder `server/src/domains/meta-workflow/` containing only `phase-templates/` (six stubs + a registry).

**Tech Stack:** TypeScript, `better-sqlite3` (existing migration framework — see `server/src/infrastructure/storage/migrations/types.ts`), Vitest, pnpm workspace.

**Spec reference:** `docs/design/supervisor-meta-workflow.zh-CN.md` (sections "数据模型", "核心抽象详解 §4 6 类 phaseType 模板", "§6.5 phases.json schema").

---

## File Structure

```
shared/src/features/meta-workflow.ts                                                   NEW
shared/src/features/__tests__/meta-workflow.test.ts                                    NEW

shared/src/protocol/messages/meta-workflow.ts                                          NEW
shared/src/protocol/messages/index.ts                                                  MODIFY (add export + union)

server/src/infrastructure/storage/migrations/069_meta_workflow.ts                      NEW
server/src/infrastructure/storage/migrations/index.ts                                  MODIFY (register migration)
server/src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts       NEW

server/src/domains/meta-workflow/index.ts                                              NEW
server/src/domains/meta-workflow/phase-templates/types.ts                              NEW
server/src/domains/meta-workflow/phase-templates/code-implement.ts                     NEW
server/src/domains/meta-workflow/phase-templates/code-refactor.ts                      NEW
server/src/domains/meta-workflow/phase-templates/code-test-write.ts                    NEW
server/src/domains/meta-workflow/phase-templates/design-doc.ts                         NEW
server/src/domains/meta-workflow/phase-templates/dep-update.ts                         NEW
server/src/domains/meta-workflow/phase-templates/investigation.ts                      NEW
server/src/domains/meta-workflow/phase-templates/index.ts                              NEW (registry)
server/src/domains/meta-workflow/__tests__/phase-templates.test.ts                     NEW
```

8 tasks total. Each task is independently committable.

---

## Task 1: Migration 069 — Five Meta Workflow Tables

**Files:**
- Create: `server/src/infrastructure/storage/migrations/069_meta_workflow.ts`
- Test: `server/src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../069_meta_workflow.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

describe('migration 069 — meta workflow tables', () => {
  function freshDb() {
    const db = new Database(':memory:');
    // Minimal prerequisite: projects.id is referenced by FK
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY
      );
    `);
    return db;
  }

  function cols(db: Database.Database, table: string): ColumnInfo[] {
    return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  }

  it('creates all five tables', () => {
    const db = freshDb();
    db.exec(m069.sql);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('meta_workflow_runs');
    expect(names).toContain('meta_workflow_phases');
    expect(names).toContain('meta_workflow_artifacts');
    expect(names).toContain('meta_workflow_reuse_pool');
    expect(names).toContain('meta_subagent_templates');
  });

  it('meta_workflow_runs has expected columns', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_runs').map((c) => c.name);
    for (const expected of [
      'id', 'project_id', 'title', 'description', 'status',
      'requirements_path', 'phases_json', 'smoke_path_run_id',
      'reject_count', 'default_provider_id', 'config',
      'worktree_id', 'created_at', 'updated_at', 'completed_at',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('meta_workflow_phases has provider override columns', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_phases').map((c) => c.name);
    for (const expected of [
      'id', 'run_id', 'phase_id', 'phase_type', 'status',
      'execute_entity', 'reused_from_pool_id',
      'generated_workflow_id', 'generated_subagent_id',
      'current_run_id', 'worktree_path',
      'stale_since', 'stale_source_phase_id',
      'attempt', 'max_retries',
      'inputs_snapshot', 'outputs_snapshot', 'gates_snapshot',
      'execute_config_snapshot',
      'synthesizer_provider_id', 'runtime_provider_id',
      'created_at', 'started_at', 'completed_at',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('meta_workflow_artifacts has version field', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_artifacts').map((c) => c.name);
    expect(names).toContain('version');
    expect(names).toContain('commit_sha');
    expect(names).toContain('status');
  });

  it('meta_workflow_reuse_pool supports both kinds (workflow / subagent)', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_workflow_reuse_pool').map((c) => c.name);
    expect(names).toContain('kind');
    expect(names).toContain('entity_id');
    expect(names).toContain('source_type');
  });

  it('meta_subagent_templates has prompt + tools + termination fields', () => {
    const db = freshDb();
    db.exec(m069.sql);
    const names = cols(db, 'meta_subagent_templates').map((c) => c.name);
    expect(names).toContain('system_prompt');
    expect(names).toContain('allowed_tools');
    expect(names).toContain('termination_condition');
  });

  it('is idempotent (running twice does not throw)', () => {
    const db = freshDb();
    db.exec(m069.sql);
    expect(() => db.exec(m069.sql)).not.toThrow();
  });

  it('unique (run_id, phase_id) on meta_workflow_phases', () => {
    const db = freshDb();
    db.exec(m069.sql);
    db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
    db.prepare(
      `INSERT INTO meta_workflow_runs (id, project_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('run-1', 'proj-1', 'T', 'requirement_draft', 0, 0);
    db.prepare(
      `INSERT INTO meta_workflow_phases (id, run_id, phase_id, phase_type, status, execute_entity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('p-1', 'run-1', 'phase-x', 'code-implement', 'pending', 'workflow', 0);

    expect(() =>
      db.prepare(
        `INSERT INTO meta_workflow_phases (id, run_id, phase_id, phase_type, status, execute_entity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('p-2', 'run-1', 'phase-x', 'code-implement', 'pending', 'workflow', 0),
    ).toThrow(/UNIQUE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run server/src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts`

Expected: FAIL with "Cannot find module ../069_meta_workflow.js".

- [ ] **Step 3: Write the migration**

```typescript
// server/src/infrastructure/storage/migrations/069_meta_workflow.ts
import type { Migration } from './types.js';

export const migration: Migration = {
  name: '069_meta_workflow',
  idempotent: true,
  sql: `
    CREATE TABLE IF NOT EXISTS meta_workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      requirements_path TEXT,
      phases_json TEXT,
      smoke_path_run_id TEXT,
      reject_count INTEGER NOT NULL DEFAULT 0,
      default_provider_id TEXT,
      config TEXT,
      worktree_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meta_runs_project
      ON meta_workflow_runs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meta_runs_status
      ON meta_workflow_runs(status);

    CREATE TABLE IF NOT EXISTS meta_workflow_phases (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase_id TEXT NOT NULL,
      phase_type TEXT NOT NULL,
      status TEXT NOT NULL,
      execute_entity TEXT NOT NULL,
      reused_from_pool_id TEXT,
      generated_workflow_id TEXT,
      generated_subagent_id TEXT,
      current_run_id TEXT,
      worktree_path TEXT,
      stale_since INTEGER,
      stale_source_phase_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      inputs_snapshot TEXT,
      outputs_snapshot TEXT,
      gates_snapshot TEXT,
      execute_config_snapshot TEXT,
      synthesizer_provider_id TEXT,
      runtime_provider_id TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES meta_workflow_runs(id) ON DELETE CASCADE,
      UNIQUE (run_id, phase_id)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_phases_run
      ON meta_workflow_phases(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_meta_phases_status
      ON meta_workflow_phases(status);

    CREATE TABLE IF NOT EXISTS meta_workflow_artifacts (
      id TEXT PRIMARY KEY,
      phase_record_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      commit_sha TEXT,
      artifact_files TEXT,
      gate_results TEXT,
      ai_review_notes_path TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (phase_record_id) REFERENCES meta_workflow_phases(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meta_artifacts_phase
      ON meta_workflow_artifacts(phase_record_id, version DESC);
    CREATE INDEX IF NOT EXISTS idx_meta_artifacts_status
      ON meta_workflow_artifacts(status);

    CREATE TABLE IF NOT EXISTS meta_workflow_reuse_pool (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      phase_type TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      source_type TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_meta_reuse_phase_type
      ON meta_workflow_reuse_pool(phase_type, source_type);
    CREATE INDEX IF NOT EXISTS idx_meta_reuse_kind
      ON meta_workflow_reuse_pool(kind);

    CREATE TABLE IF NOT EXISTS meta_subagent_templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      system_prompt TEXT NOT NULL,
      allowed_tools TEXT NOT NULL,
      max_turns INTEGER NOT NULL DEFAULT 30,
      termination_condition TEXT NOT NULL,
      source_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run server/src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts`

Expected: PASS (all 8 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/infrastructure/storage/migrations/069_meta_workflow.ts \
        server/src/infrastructure/storage/migrations/__tests__/069_meta_workflow.test.ts
git commit -m "feat(meta-workflow): add migration 069 for 5 new tables"
```

---

## Task 2: Register Migration 069 in Index

**Files:**
- Modify: `server/src/infrastructure/storage/migrations/index.ts`

This is a one-line + array-append change. No new test — the existing migration runner (assumed in `server/src/infrastructure/storage/`) will pick up the new entry.

- [ ] **Step 1: Add the import line**

Open `server/src/infrastructure/storage/migrations/index.ts`.

Add this line in alphabetical/numeric order after `m_068_local_issue_comments`:

```typescript
import { migration as m_069_meta_workflow } from './069_meta_workflow.js';
```

- [ ] **Step 2: Append to the `migrations` array**

Append `m_069_meta_workflow,` after `m_068_local_issue_comments,` in the `migrations` array (line ~142).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add server/src/infrastructure/storage/migrations/index.ts
git commit -m "feat(meta-workflow): register migration 069"
```

---

## Task 3: Shared Domain Types — `shared/src/features/meta-workflow.ts`

**Files:**
- Create: `shared/src/features/meta-workflow.ts`
- Test: `shared/src/features/__tests__/meta-workflow.test.ts`

This file is **type-only**. No runtime logic. The test ensures the types are well-formed by type-checking sample values.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/features/__tests__/meta-workflow.test.ts
import { describe, it, expect } from 'vitest';
import type {
  PhaseDef, PhasesDoc, AcceptanceGate, PhaseInput, PhaseOutput,
  MetaWorkflowRun, MetaWorkflowPhase, MetaWorkflowArtifact,
  ReusablePoolItem, MetaSubagentTemplate, MetaWorkflowConfig,
  MetaWorkflowRunStatus, MetaWorkflowPhaseStatus, PhaseType, ExecuteEntity,
  ExecutePattern,
} from '../meta-workflow.js';
import {
  PHASE_TYPES, EXECUTE_ENTITIES, EXECUTE_PATTERNS,
  META_WORKFLOW_RUN_STATUSES, META_WORKFLOW_PHASE_STATUSES,
} from '../meta-workflow.js';

describe('meta-workflow types', () => {
  it('PHASE_TYPES enum has exactly 6 values', () => {
    expect(PHASE_TYPES).toEqual([
      'code-implement', 'code-refactor', 'code-test-write',
      'design-doc', 'dep-update', 'investigation',
    ]);
  });

  it('EXECUTE_ENTITIES has workflow + subagent', () => {
    expect(EXECUTE_ENTITIES).toEqual(['workflow', 'subagent']);
  });

  it('EXECUTE_PATTERNS has 3 patterns', () => {
    expect(EXECUTE_PATTERNS).toEqual(['single-shot', 'multi-step', 'self-healing']);
  });

  it('a minimal PhaseDef is shape-compatible', () => {
    const phase: PhaseDef = {
      id: 'impl-user-service',
      name: 'Implement UserService',
      description: 'Wire up the UserServiceImpl behind IUserService',
      phaseType: 'code-implement',
      dependsOn: [],
      inputs: [],
      outputs: [{ kind: 'commit', description: 'feature commit' }],
      acceptanceGates: [{
        id: 'compile',
        description: 'project must compile',
        command: 'mvn compile -q',
        expect: { exitCode: 0 },
      }],
    };
    expect(phase.phaseType).toBe('code-implement');
  });

  it('a PhasesDoc carries smokePath + metadata', () => {
    const doc: PhasesDoc = {
      version: '1',
      phases: [],
      smokePath: ['phase-1', 'phase-2'],
      metadata: { generatedAt: 1, requirementsPath: 'design/requirements.md' },
    };
    expect(doc.version).toBe('1');
  });

  it('MetaWorkflowRun status enum', () => {
    expect(META_WORKFLOW_RUN_STATUSES).toContain('requirement_draft');
    expect(META_WORKFLOW_RUN_STATUSES).toContain('executing');
    expect(META_WORKFLOW_RUN_STATUSES).toContain('completed');
  });

  it('MetaWorkflowPhase status enum', () => {
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('searching_reuse');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('generating');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('verifying_gates');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('done');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('stale');
  });

  it('AcceptanceGate.expect supports stdout regex and file existence', () => {
    const gate: AcceptanceGate = {
      id: 'has-report',
      description: 'investigation report must exist',
      command: 'test -s investigation-report.md',
      expect: { exitCode: 0, fileExists: ['investigation-report.md'] },
    };
    expect(gate.expect.fileExists).toContain('investigation-report.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/shared exec vitest run shared/src/features/__tests__/meta-workflow.test.ts`

Expected: FAIL with "Cannot find module '../meta-workflow.js'".

- [ ] **Step 3: Write the type module**

```typescript
// shared/src/features/meta-workflow.ts

// ────────────────────────────────────────────────────────────────────
// Enums (exported as readonly arrays so they're usable at runtime)
// ────────────────────────────────────────────────────────────────────

export const PHASE_TYPES = [
  'code-implement',
  'code-refactor',
  'code-test-write',
  'design-doc',
  'dep-update',
  'investigation',
] as const;
export type PhaseType = typeof PHASE_TYPES[number];

export const EXECUTE_ENTITIES = ['workflow', 'subagent'] as const;
export type ExecuteEntity = typeof EXECUTE_ENTITIES[number];

export const EXECUTE_PATTERNS = ['single-shot', 'multi-step', 'self-healing'] as const;
export type ExecutePattern = typeof EXECUTE_PATTERNS[number];

export const META_WORKFLOW_RUN_STATUSES = [
  'requirement_draft',
  'requirement_review',
  'splitting',
  'executing',
  'reviewing',
  'completed',
  'cancelled',
] as const;
export type MetaWorkflowRunStatus = typeof META_WORKFLOW_RUN_STATUSES[number];

export const META_WORKFLOW_PHASE_STATUSES = [
  'pending',
  'searching_reuse',
  'generating',
  'ready_to_run',
  'running',
  'verifying_gates',
  'done',
  'failed',
  'stale',
] as const;
export type MetaWorkflowPhaseStatus = typeof META_WORKFLOW_PHASE_STATUSES[number];

export const REUSE_POOL_SOURCE_TYPES = ['auto', 'user'] as const;
export type ReusePoolSourceType = typeof REUSE_POOL_SOURCE_TYPES[number];

// ────────────────────────────────────────────────────────────────────
// PhasesDoc (the source-of-truth for a run's phase graph)
// ────────────────────────────────────────────────────────────────────

export interface PhaseInput {
  kind: 'commit' | 'file';
  /** For commit: 'phases:{phaseId}.commit'. For file: project-relative path. */
  source: string;
  description?: string;
}

export interface PhaseOutput {
  kind: 'commit' | 'file';
  path?: string;       // present when kind === 'file'
  description: string;
}

export interface AcceptanceGate {
  id: string;
  description: string;
  command: string;
  cwd?: string;        // relative to worktree root
  expect: {
    exitCode?: number;           // default 0
    stdoutMatches?: string;      // regex
    stderrMatches?: string;
    fileExists?: string[];
    fileNotExists?: string[];
    durationMaxMs?: number;
  };
}

export interface PhaseExecuteConfig {
  pattern?: ExecutePattern;
  planRequired?: boolean;
  aiReviewBlocking?: boolean;
  maxLoopIterations?: number;
  maxSubagentTurns?: number;
}

export interface PhaseDef {
  id: string;
  name: string;
  description: string;
  phaseType: PhaseType;
  executeEntity?: ExecuteEntity;        // defaults inferred from phaseType
  dependsOn: string[];
  inputs: PhaseInput[];
  outputs: PhaseOutput[];
  acceptanceGates: AcceptanceGate[];
  executeConfig?: PhaseExecuteConfig;
  synthesizerProviderId?: string;
  runtimeProviderId?: string;
  worktreeStrategy?: 'isolated' | 'shared';
  estimatedComplexity?: 'small' | 'medium' | 'large';
}

export interface PhasesDoc {
  version: '1';
  phases: PhaseDef[];
  smokePath: string[];
  metadata: {
    generatedAt: number;
    requirementsPath: string;
  };
}

// ────────────────────────────────────────────────────────────────────
// Runtime records (mirror the SQLite tables in migration 069)
// ────────────────────────────────────────────────────────────────────

export interface MetaWorkflowConfig {
  /** Max times the requirements phase can be rejected before the escape hatch is offered. */
  maxRequirementRejects?: number;
  /** Max simultaneous phases allowed under conservative_parallel automation. */
  maxParallelPhases?: number;
}

export interface MetaWorkflowRun {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: MetaWorkflowRunStatus;
  requirementsPath?: string;
  phasesJson?: string;                  // serialized PhasesDoc
  smokePathRunId?: string;
  rejectCount: number;
  defaultProviderId?: string;
  config?: MetaWorkflowConfig;
  worktreeId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface MetaWorkflowPhase {
  id: string;
  runId: string;
  phaseId: string;
  phaseType: PhaseType;
  status: MetaWorkflowPhaseStatus;
  executeEntity: ExecuteEntity;
  reusedFromPoolId?: string;
  generatedWorkflowId?: string;
  generatedSubagentId?: string;
  currentRunId?: string;
  worktreePath?: string;
  staleSince?: number;
  staleSourcePhaseId?: string;
  attempt: number;
  maxRetries: number;
  inputsSnapshot?: PhaseInput[];
  outputsSnapshot?: PhaseOutput[];
  gatesSnapshot?: AcceptanceGate[];
  executeConfigSnapshot?: PhaseExecuteConfig;
  synthesizerProviderId?: string;
  runtimeProviderId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface MetaWorkflowGateResult {
  gateId: string;
  passed: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface MetaWorkflowArtifact {
  id: string;
  phaseRecordId: string;
  version: number;
  commitSha?: string;
  artifactFiles?: { kind: 'commit' | 'file'; path?: string }[];
  gateResults?: MetaWorkflowGateResult[];
  aiReviewNotesPath?: string;
  status: 'active' | 'stale' | 'archived';
  createdAt: number;
}

export interface ReusablePoolMetadata {
  generatedFromPhaseId?: string;
  originalRunId?: string;
  promotedAt?: number;
  usageCount?: number;
  successRate?: number;
}

export interface ReusablePoolItem {
  id: string;
  kind: ExecuteEntity;
  entityId: string;
  phaseType: PhaseType;
  description?: string;
  tags: string[];
  sourceType: ReusePoolSourceType;
  metadata?: ReusablePoolMetadata;
  createdAt: number;
  archivedAt?: number;
}

export interface MetaSubagentTerminationCondition {
  kind: 'output-file' | 'output-keyword';
  target: string;
}

export interface MetaSubagentTemplate {
  id: string;
  name?: string;
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  terminationCondition: MetaSubagentTerminationCondition;
  sourceType: ReusePoolSourceType;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/shared exec vitest run shared/src/features/__tests__/meta-workflow.test.ts`

Expected: PASS (all 7 assertions).

- [ ] **Step 5: Verify shared package builds**

Run: `pnpm --filter @my-claudia/shared build`

Expected: success (no type errors propagating downstream).

- [ ] **Step 6: Commit**

```bash
git add shared/src/features/meta-workflow.ts \
        shared/src/features/__tests__/meta-workflow.test.ts
git commit -m "feat(meta-workflow): add shared domain types"
```

---

## Task 4: Protocol Messages — `shared/src/protocol/messages/meta-workflow.ts`

**Files:**
- Create: `shared/src/protocol/messages/meta-workflow.ts`
- Modify: `shared/src/protocol/messages/index.ts`

Phase A defines only **push messages (Server → Client)**: `MetaWorkflowRunUpdateMessage` and `MetaWorkflowPhaseUpdateMessage`. CRUD messages are deferred to Phase B (added when handlers exist; until then they would be dangling).

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/features/__tests__/meta-workflow-protocol.test.ts
// (Tests live alongside features tests for proximity)
import { describe, it, expect } from 'vitest';
import type { ServerMessage } from '../../protocol/messages/index.js';
import type {
  MetaWorkflowRunUpdateMessage,
  MetaWorkflowPhaseUpdateMessage,
} from '../../protocol/messages/meta-workflow.js';

describe('meta-workflow protocol messages', () => {
  it('MetaWorkflowRunUpdateMessage is a valid ServerMessage', () => {
    const msg: MetaWorkflowRunUpdateMessage = {
      type: 'meta_workflow_run_update',
      projectId: 'proj-1',
      run: {
        id: 'run-1', projectId: 'proj-1', title: 't', status: 'requirement_draft',
        rejectCount: 0, createdAt: 0, updatedAt: 0,
      },
    };
    const asUnion: ServerMessage = msg;
    expect(asUnion.type).toBe('meta_workflow_run_update');
  });

  it('MetaWorkflowPhaseUpdateMessage carries the phase record', () => {
    const msg: MetaWorkflowPhaseUpdateMessage = {
      type: 'meta_workflow_phase_update',
      projectId: 'proj-1',
      runId: 'run-1',
      phase: {
        id: 'pr-1', runId: 'run-1', phaseId: 'p1',
        phaseType: 'code-implement', status: 'pending',
        executeEntity: 'workflow', attempt: 0, maxRetries: 3,
        createdAt: 0,
      },
    };
    expect(msg.type).toBe('meta_workflow_phase_update');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/shared exec vitest run shared/src/features/__tests__/meta-workflow-protocol.test.ts`

Expected: FAIL with "Cannot find module ../../protocol/messages/meta-workflow.js".

- [ ] **Step 3: Create the protocol messages module**

```typescript
// shared/src/protocol/messages/meta-workflow.ts
import type { MetaWorkflowRun, MetaWorkflowPhase } from '../../features/meta-workflow.js';

/** Server → Client: a run was created, updated, or completed. */
export interface MetaWorkflowRunUpdateMessage {
  type: 'meta_workflow_run_update';
  projectId: string;
  run: MetaWorkflowRun;
}

/** Server → Client: a phase record changed (status, attempt, snapshot, stale flag, ...). */
export interface MetaWorkflowPhaseUpdateMessage {
  type: 'meta_workflow_phase_update';
  projectId: string;
  runId: string;
  phase: MetaWorkflowPhase;
}
```

- [ ] **Step 4: Wire into the protocol-messages barrel**

Open `shared/src/protocol/messages/index.ts`.

Add after line `export * from './plugins.js';`:

```typescript
export * from './meta-workflow.js';
```

In the **Server → Client** import block (just after the `notification-feed` import block, around line 163), add:

```typescript
import type {
  MetaWorkflowRunUpdateMessage,
  MetaWorkflowPhaseUpdateMessage,
} from './meta-workflow.js';
```

In the `ServerMessage` union (just after `// Notifications` block, before the closing semicolon), append:

```typescript
  // Meta Workflow
  | MetaWorkflowRunUpdateMessage
  | MetaWorkflowPhaseUpdateMessage
```

(No additions to `ClientMessage` — CRUD messages land in Phase B.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/shared exec vitest run shared/src/features/__tests__/meta-workflow-protocol.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify both server and desktop still type-check**

Run: `pnpm --filter @my-claudia/shared build && pnpm --filter @my-claudia/server exec tsc --noEmit && pnpm --filter @my-claudia/desktop exec tsc --noEmit`

Expected: success.

- [ ] **Step 7: Commit**

```bash
git add shared/src/protocol/messages/meta-workflow.ts \
        shared/src/protocol/messages/index.ts \
        shared/src/features/__tests__/meta-workflow-protocol.test.ts
git commit -m "feat(meta-workflow): add Server→Client protocol messages"
```

---

## Task 5: Phase Template Interface — `phase-templates/types.ts`

**Files:**
- Create: `server/src/domains/meta-workflow/phase-templates/types.ts`

This is the contract every phaseType template implements. Pure types and a single interface. No test in this task — Task 7 covers the registry that exercises this interface.

- [ ] **Step 1: Create the file**

```typescript
// server/src/domains/meta-workflow/phase-templates/types.ts
import type {
  PhaseType,
  ExecuteEntity,
  ExecutePattern,
  AcceptanceGate,
} from '@my-claudia/shared/features/meta-workflow';

/**
 * A phaseType template describes the defaults the synthesizer should apply
 * when generating an execution entity for a phase of this type.
 *
 * Phase A ships only the type contract + stubs.
 * Phase B will add `buildSynthesizerPrompt()` and `defaultAcceptanceGates()`
 * methods on these templates.
 */
export interface PhaseTemplate {
  readonly phaseType: PhaseType;

  /** Default execute entity (workflow vs subagent). */
  readonly defaultExecuteEntity: ExecuteEntity;

  /** Default execute pattern for workflow entities. */
  readonly defaultExecutePattern?: ExecutePattern;

  /** Whether the plan node is on by default for this phaseType. */
  readonly defaultPlanRequired: boolean;

  /**
   * A short, human-readable description that helps the synthesizer
   * understand when this template applies.
   */
  readonly description: string;

  /**
   * Default acceptance-gate skeletons (commands are project-tooling specific
   * and parameterized at synthesis time).
   *
   * Phase A ships empty arrays as stubs; Phase B fills them.
   */
  readonly defaultGateSkeletons: AcceptanceGate[];
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add server/src/domains/meta-workflow/phase-templates/types.ts
git commit -m "feat(meta-workflow): phase template contract"
```

---

## Task 6: Six Phase Template Stubs

**Files:**
- Create: `server/src/domains/meta-workflow/phase-templates/code-implement.ts`
- Create: `server/src/domains/meta-workflow/phase-templates/code-refactor.ts`
- Create: `server/src/domains/meta-workflow/phase-templates/code-test-write.ts`
- Create: `server/src/domains/meta-workflow/phase-templates/design-doc.ts`
- Create: `server/src/domains/meta-workflow/phase-templates/dep-update.ts`
- Create: `server/src/domains/meta-workflow/phase-templates/investigation.ts`

Each stub is a single `export const` matching the `PhaseTemplate` interface. Defaults follow the table in the spec (`§6.4 6 类 phaseType 模板`).

No per-file test — the registry test in Task 7 verifies all six stubs are picked up correctly.

- [ ] **Step 1: Write `code-implement.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/code-implement.ts
import type { PhaseTemplate } from './types.js';

export const codeImplementTemplate: PhaseTemplate = {
  phaseType: 'code-implement',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Implement a new feature, interface, or class in code.',
  defaultGateSkeletons: [],
};
```

- [ ] **Step 2: Write `code-refactor.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/code-refactor.ts
import type { PhaseTemplate } from './types.js';

export const codeRefactorTemplate: PhaseTemplate = {
  phaseType: 'code-refactor',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Refactor existing code while preserving behavior (tests unchanged).',
  defaultGateSkeletons: [],
};
```

- [ ] **Step 3: Write `code-test-write.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/code-test-write.ts
import type { PhaseTemplate } from './types.js';

export const codeTestWriteTemplate: PhaseTemplate = {
  phaseType: 'code-test-write',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'multi-step',
  defaultPlanRequired: false,
  description: 'Write tests for code that is already implemented.',
  defaultGateSkeletons: [],
};
```

- [ ] **Step 4: Write `design-doc.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/design-doc.ts
import type { PhaseTemplate } from './types.js';

export const designDocTemplate: PhaseTemplate = {
  phaseType: 'design-doc',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'single-shot',
  defaultPlanRequired: false,
  description: 'Author a design document, API spec, or interface contract — no code produced.',
  defaultGateSkeletons: [],
};
```

- [ ] **Step 5: Write `dep-update.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/dep-update.ts
import type { PhaseTemplate } from './types.js';

export const depUpdateTemplate: PhaseTemplate = {
  phaseType: 'dep-update',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Upgrade dependencies, modify build scripts, or change project configuration.',
  defaultGateSkeletons: [],
};
```

- [ ] **Step 6: Write `investigation.ts`**

```typescript
// server/src/domains/meta-workflow/phase-templates/investigation.ts
import type { PhaseTemplate } from './types.js';

export const investigationTemplate: PhaseTemplate = {
  phaseType: 'investigation',
  defaultExecuteEntity: 'subagent',
  defaultExecutePattern: undefined,    // subagent doesn't use workflow patterns
  defaultPlanRequired: false,
  description: 'Investigate, research, or analyze — produces a written report, no code change.',
  defaultGateSkeletons: [],
};
```

- [ ] **Step 7: Verify all six files compile**

Run: `pnpm --filter @my-claudia/server exec tsc --noEmit`

Expected: success.

- [ ] **Step 8: Commit**

```bash
git add server/src/domains/meta-workflow/phase-templates/code-implement.ts \
        server/src/domains/meta-workflow/phase-templates/code-refactor.ts \
        server/src/domains/meta-workflow/phase-templates/code-test-write.ts \
        server/src/domains/meta-workflow/phase-templates/design-doc.ts \
        server/src/domains/meta-workflow/phase-templates/dep-update.ts \
        server/src/domains/meta-workflow/phase-templates/investigation.ts
git commit -m "feat(meta-workflow): add 6 phaseType template stubs"
```

---

## Task 7: Phase Template Registry + Domain Index

**Files:**
- Create: `server/src/domains/meta-workflow/phase-templates/index.ts`
- Create: `server/src/domains/meta-workflow/index.ts`
- Test: `server/src/domains/meta-workflow/__tests__/phase-templates.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domains/meta-workflow/__tests__/phase-templates.test.ts
import { describe, it, expect } from 'vitest';
import { PHASE_TYPES } from '@my-claudia/shared/features/meta-workflow';
import {
  PHASE_TEMPLATES,
  getPhaseTemplate,
} from '../phase-templates/index.js';

describe('phase template registry', () => {
  it('registers exactly 6 templates', () => {
    expect(PHASE_TEMPLATES).toHaveLength(6);
  });

  it('covers every PhaseType in the shared enum', () => {
    const registered = new Set(PHASE_TEMPLATES.map((t) => t.phaseType));
    for (const pt of PHASE_TYPES) {
      expect(registered).toContain(pt);
    }
  });

  it('investigation defaults to subagent', () => {
    expect(getPhaseTemplate('investigation').defaultExecuteEntity).toBe('subagent');
  });

  it('code-implement defaults to workflow + self-healing + planRequired', () => {
    const t = getPhaseTemplate('code-implement');
    expect(t.defaultExecuteEntity).toBe('workflow');
    expect(t.defaultExecutePattern).toBe('self-healing');
    expect(t.defaultPlanRequired).toBe(true);
  });

  it('design-doc defaults to single-shot, plan off', () => {
    const t = getPhaseTemplate('design-doc');
    expect(t.defaultExecutePattern).toBe('single-shot');
    expect(t.defaultPlanRequired).toBe(false);
  });

  it('getPhaseTemplate throws on unknown phaseType', () => {
    // @ts-expect-error — intentionally pass an invalid value at runtime
    expect(() => getPhaseTemplate('nonexistent')).toThrow(/Unknown phaseType/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-claudia/server exec vitest run server/src/domains/meta-workflow/__tests__/phase-templates.test.ts`

Expected: FAIL with "Cannot find module '../phase-templates/index.js'".

- [ ] **Step 3: Write the registry**

```typescript
// server/src/domains/meta-workflow/phase-templates/index.ts
import type { PhaseType } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

import { codeImplementTemplate } from './code-implement.js';
import { codeRefactorTemplate } from './code-refactor.js';
import { codeTestWriteTemplate } from './code-test-write.js';
import { designDocTemplate } from './design-doc.js';
import { depUpdateTemplate } from './dep-update.js';
import { investigationTemplate } from './investigation.js';

export { PhaseTemplate };

export const PHASE_TEMPLATES: readonly PhaseTemplate[] = [
  codeImplementTemplate,
  codeRefactorTemplate,
  codeTestWriteTemplate,
  designDocTemplate,
  depUpdateTemplate,
  investigationTemplate,
];

const TEMPLATE_BY_TYPE = new Map<PhaseType, PhaseTemplate>(
  PHASE_TEMPLATES.map((t) => [t.phaseType, t]),
);

export function getPhaseTemplate(phaseType: PhaseType): PhaseTemplate {
  const template = TEMPLATE_BY_TYPE.get(phaseType);
  if (!template) {
    throw new Error(`Unknown phaseType: ${phaseType}`);
  }
  return template;
}
```

- [ ] **Step 4: Write the domain index**

```typescript
// server/src/domains/meta-workflow/index.ts
/**
 * Meta Workflow domain — public surface.
 *
 * Phase A: only phase templates are exposed. Subsequent phases will export
 * aggregates, synthesizers, executors, and a register() factory.
 */
export * from './phase-templates/index.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @my-claudia/server exec vitest run server/src/domains/meta-workflow/__tests__/phase-templates.test.ts`

Expected: PASS (all 6 assertions).

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/meta-workflow/phase-templates/index.ts \
        server/src/domains/meta-workflow/index.ts \
        server/src/domains/meta-workflow/__tests__/phase-templates.test.ts
git commit -m "feat(meta-workflow): add phase template registry"
```

---

## Task 8: Full Build + Test Smoke Verification

**Goal:** Prove the entire workspace still builds and all tests pass after Phase A lands.

- [ ] **Step 1: Build all packages**

Run: `pnpm build`

Expected: all packages build successfully (shared → server / gateway / desktop). No type errors.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`

Expected: all tests pass — including the 4 new test files added in Tasks 1, 3, 4, and 7.

- [ ] **Step 3: Manually verify the migration applies on a clean db**

Run this throwaway script (do not commit it):

```bash
node -e "
const Database = require('better-sqlite3');
const { migrations } = require('./server/dist/infrastructure/storage/migrations/index.js');
const db = new Database(':memory:');
for (const m of migrations) {
  try { db.exec(m.sql); } catch (e) {
    if (m.idempotent && /duplicate column|already exists/i.test(e.message)) continue;
    throw new Error('Migration ' + m.name + ' failed: ' + e.message);
  }
}
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all();
const metaTables = tables.filter(t => t.name.startsWith('meta_'));
console.log('Meta tables present:', metaTables.map(t => t.name));
if (metaTables.length !== 5) { process.exit(1); }
"
```

Expected output:
```
Meta tables present: [ 'meta_subagent_templates', 'meta_workflow_artifacts', 'meta_workflow_phases', 'meta_workflow_reuse_pool', 'meta_workflow_runs' ]
```

- [ ] **Step 4: Tag the Phase A completion commit**

```bash
git tag -a meta-workflow/phase-a-complete -m "Meta Workflow Phase A foundation landed"
```

(No commit needed — Task 8 is verification only.)

---

## Phase A Acceptance Criteria

- [ ] Migration 069 is registered and applies cleanly on an empty database.
- [ ] All 5 `meta_*` tables exist with the columns specified in the spec's `§8 数据模型`.
- [ ] `shared/src/features/meta-workflow.ts` exports the full type vocabulary plus 5 runtime enum arrays.
- [ ] `shared/src/protocol/messages/meta-workflow.ts` exports 2 Server→Client message interfaces, both included in the `ServerMessage` union.
- [ ] All 6 phaseType templates exist; the registry lookup is type-safe and exhaustive.
- [ ] `pnpm build` and `pnpm test` are both green.

---

## What Phase A Deliberately Leaves to Later Phases

| Item | Where it lands |
|------|---------------|
| Repositories (`MetaWorkflowRunRepository`, etc.) | Phase B |
| Aggregates and state-machine guards | Phase B |
| `workflow-synthesizer.ts` / `subagent-synthesizer.ts` | Phase B |
| `phases.json` validator (zod schema + DAG + smoke-path checks) | Phase B |
| `MetaPhaseExecutor` driving the workflow engine | Phase B |
| Phase-template `buildSynthesizerPrompt()` and `defaultAcceptanceGates()` filled out | Phase B |
| Reuse-pool search + promotion flow | Phase C |
| Stale propagator + four user actions + artifact versioning | Phase D |
| All UI (Supervisor "New ▾" entry, requirements / phase-graph / phase-board / phase-detail screens) | Phase E |
| End-to-end smoke on a real Java/TS project | Phase F |
| CRUD `ClientMessage`s (`AddMetaWorkflowRunMessage`, ...) | Phase B |

These are explicit non-goals for Phase A. Implementing them here would either be dead code (no callers yet) or duplicate effort once Phase B lands.

---

*Plan version: 1 / 2026-05-18*
*Spec reference: `docs/design/supervisor-meta-workflow.zh-CN.md`*
