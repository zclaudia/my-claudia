# Phase 1: Data Model + Context Management (MVP)

> **Goal**: Establish the foundation — new shared types, DB schema, ContextManager, and serial task execution with manual review.
>
> **Constraint**: `maxConcurrentTasks` forced to 1. No git worktrees. `approved` = `integrated` in serial mode.

---

## 1. Shared Types (`shared/src/index.ts`)

### 1.1 New Types to Add

Add after the existing `Supervision` types block (around line 230). The old v1 types remain temporarily for backward compatibility.

```typescript
// ============================================
// Supervision v2 Types
// ============================================

export type AgentType = 'supervisor';

export type SupervisionPhase =
  | 'initializing'
  | 'setup'
  | 'active'
  | 'paused'
  | 'idle'
  | 'archived';

export type TrustLevel = 'low' | 'medium' | 'high';

export interface SupervisorConfig {
  maxConcurrentTasks: number;
  trustLevel: TrustLevel;
  autoDiscoverTasks: boolean;
  maxTotalTasks?: number;
  maxTokenBudget?: number;
}

export interface ProjectAgent {
  type: AgentType;
  phase: SupervisionPhase;
  config: SupervisorConfig;
  mainSessionId?: string;
  pausedReason?: 'user' | 'budget' | 'sync_error';
  pausedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | 'proposed'
  | 'pending'
  | 'queued'
  | 'running'
  | 'reviewing'
  | 'approved'
  | 'integrated'
  | 'rejected'
  | 'merge_conflict'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface TaskResult {
  summary: string;
  filesChanged: string[];
  workflowOutputs?: Array<{
    action: string;
    output: string;
    success: boolean;
  }>;
  reviewNotes?: string;
}

export interface SupervisionTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  source: 'user' | 'agent_discovered';
  sessionId?: string;
  status: TaskStatus;
  priority: number;
  dependencies: string[];
  dependencyMode: 'all' | 'any';
  relevantDocIds?: string[];
  taskSpecificContext?: string;
  scope?: string[];
  acceptanceCriteria: string[];
  maxRetries: number;
  attempt: number;
  result?: TaskResult;
  baseCommit?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export type SupervisionV2LogEvent =
  | 'agent_initialized'
  | 'phase_changed'
  | 'task_created'
  | 'task_status_changed'
  | 'checkpoint_started'
  | 'checkpoint_completed'
  | 'context_updated'
  | 'context_sync_error';

export interface SupervisionV2Log {
  id: string;
  projectId: string;
  taskId?: string;
  event: SupervisionV2LogEvent;
  detail?: Record<string, unknown>;
  createdAt: number;
}
```

### 1.2 Extend Existing Types

**Project** — add optional fields:

```typescript
export interface Project {
  // ... all existing fields unchanged ...

  // Supervision v2
  agent?: ProjectAgent;
  contextSyncStatus?: 'synced' | 'error';
}
```

**Session** — add optional fields:

```typescript
export interface Session {
  // ... all existing fields unchanged ...

  // Supervision v2
  projectRole?: 'main' | 'task' | 'review' | 'checkpoint';
  taskId?: string;
}
```

### 1.3 New WebSocket Message Types

```typescript
// Server → Client: supervision v2 task update
export interface SupervisionTaskUpdateMessage {
  type: 'supervision_task_update';
  task: SupervisionTask;
  projectId: string;
}

// Server → Client: supervision v2 agent phase change
export interface SupervisionAgentUpdateMessage {
  type: 'supervision_agent_update';
  projectId: string;
  agent: ProjectAgent;
}

// Server → Client: supervision v2 checkpoint summary
export interface SupervisionCheckpointMessage {
  type: 'supervision_checkpoint';
  projectId: string;
  summary: string;
}
```

Add these to the `ServerMessage` union type.

### 1.4 New Client → Server Message Types

```typescript
// Supervision v2 task CRUD
export interface GetSupervisionTasksMessage {
  type: 'get_supervision_tasks';
  projectId: string;
}

export interface AddSupervisionTaskMessage {
  type: 'add_supervision_task';
  projectId: string;
  task: {
    title: string;
    description: string;
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    priority?: number;
    acceptanceCriteria?: string[];
    relevantDocIds?: string[];
    scope?: string[];
  };
}

export interface UpdateSupervisionTaskMessage {
  type: 'update_supervision_task';
  taskId: string;
  updates: Partial<Pick<SupervisionTask, 'title' | 'description' | 'priority' | 'status' | 'acceptanceCriteria' | 'dependencies' | 'dependencyMode'>>;
}

// Agent lifecycle
export interface InitSupervisionAgentMessage {
  type: 'init_supervision_agent';
  projectId: string;
  config?: Partial<SupervisorConfig>;
}

export interface UpdateSupervisionAgentMessage {
  type: 'update_supervision_agent';
  projectId: string;
  action: 'pause' | 'resume' | 'archive' | 'approve_setup';
}

export interface ReloadSupervisionContextMessage {
  type: 'reload_supervision_context';
  projectId: string;
}
```

Add these to the `ClientMessage` union type.

---

## 2. DB Schema (`server/src/storage/db.ts`)

### Migration `025_supervision_v2`

Add after the existing `024_session_working_directory` migration:

```typescript
{
  name: '025_supervision_v2',
  sql: `
    -- supervision_tasks: v2 task management
    CREATE TABLE IF NOT EXISTS supervision_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent_discovered')),
      session_id TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      dependencies TEXT,
      dependency_mode TEXT DEFAULT 'all',
      relevant_doc_ids TEXT,
      task_specific_context TEXT,
      scope TEXT,
      acceptance_criteria TEXT,
      max_retries INTEGER DEFAULT 2,
      attempt INTEGER NOT NULL DEFAULT 1,
      base_commit TEXT,
      result TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_supervision_tasks_project ON supervision_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_supervision_tasks_status ON supervision_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_supervision_tasks_session ON supervision_tasks(session_id);

    -- supervision_v2_logs: structured event log
    CREATE TABLE IF NOT EXISTS supervision_v2_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sv2_logs_project ON supervision_v2_logs(project_id);
    CREATE INDEX IF NOT EXISTS idx_sv2_logs_task ON supervision_v2_logs(task_id);

    -- Extend projects table
    ALTER TABLE projects ADD COLUMN agent TEXT;
    ALTER TABLE projects ADD COLUMN context_sync_status TEXT NOT NULL DEFAULT 'synced';

    -- Extend sessions table
    ALTER TABLE sessions ADD COLUMN project_role TEXT;
    ALTER TABLE sessions ADD COLUMN task_id TEXT;
  `
}
```

---

## 3. Repository Changes

### 3.1 `server/src/repositories/project.ts`

**`mapRow`** — add `agent` and `contextSyncStatus` fields:

```typescript
mapRow(row: any): Project {
  return {
    // ... existing fields ...
    agent: row.agent ? JSON.parse(row.agent) : undefined,
    contextSyncStatus: row.context_sync_status === 'error' ? 'error' : undefined,
  };
}
```

**`createQuery`** — add `agent` column (null for new projects).

**`updateQuery`** — handle `agent` and `contextSyncStatus`:

```typescript
if (data.agent !== undefined) {
  updates.push('agent = ?');
  params.push(data.agent ? JSON.stringify(data.agent) : null);
}
if (data.contextSyncStatus !== undefined) {
  updates.push('context_sync_status = ?');
  params.push(data.contextSyncStatus || 'synced');
}
```

### 3.2 `server/src/repositories/session.ts`

**`mapRow`** — add:

```typescript
projectRole: row.project_role || undefined,
taskId: row.task_id || undefined,
```

**`createQuery`** — add `project_role` and `task_id` columns.

**`updateQuery`** — handle `projectRole` and `taskId`.

### 3.3 New: `server/src/repositories/supervision-task.ts`

```typescript
import type Database from 'better-sqlite3';
import type { SupervisionTask, TaskStatus } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

export class SupervisionTaskRepository {
  constructor(private db: Database.Database) {}

  mapRow(row: any): SupervisionTask {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      source: row.source,
      sessionId: row.session_id || undefined,
      status: row.status as TaskStatus,
      priority: row.priority,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      dependencyMode: row.dependency_mode || 'all',
      relevantDocIds: row.relevant_doc_ids ? JSON.parse(row.relevant_doc_ids) : undefined,
      taskSpecificContext: row.task_specific_context || undefined,
      scope: row.scope ? JSON.parse(row.scope) : undefined,
      acceptanceCriteria: row.acceptance_criteria ? JSON.parse(row.acceptance_criteria) : [],
      maxRetries: row.max_retries,
      attempt: row.attempt,
      result: row.result ? JSON.parse(row.result) : undefined,
      baseCommit: row.base_commit || undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
    };
  }

  create(data: {
    projectId: string;
    title: string;
    description: string;
    source: 'user' | 'agent_discovered';
    status: TaskStatus;           // Must be set explicitly (no default)
    priority?: number;
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    relevantDocIds?: string[];
    taskSpecificContext?: string;
    scope?: string[];
    acceptanceCriteria?: string[];
    maxRetries?: number;
  }): SupervisionTask {
    const id = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO supervision_tasks
        (id, project_id, title, description, source, status, priority,
         dependencies, dependency_mode, relevant_doc_ids, task_specific_context,
         scope, acceptance_criteria, max_retries, attempt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      data.projectId,
      data.title,
      data.description,
      data.source,
      data.status,
      data.priority ?? 0,
      data.dependencies?.length ? JSON.stringify(data.dependencies) : null,
      data.dependencyMode ?? 'all',
      data.relevantDocIds?.length ? JSON.stringify(data.relevantDocIds) : null,
      data.taskSpecificContext ?? null,
      data.scope?.length ? JSON.stringify(data.scope) : null,
      data.acceptanceCriteria?.length ? JSON.stringify(data.acceptanceCriteria) : null,
      data.maxRetries ?? 2,
      now,
    );

    return this.findById(id)!;
  }

  findById(id: string): SupervisionTask | undefined {
    const row = this.db.prepare('SELECT * FROM supervision_tasks WHERE id = ?').get(id);
    return row ? this.mapRow(row) : undefined;
  }

  findByProjectId(projectId: string): SupervisionTask[] {
    const rows = this.db.prepare(
      'SELECT * FROM supervision_tasks WHERE project_id = ? ORDER BY priority ASC, created_at ASC'
    ).all(projectId);
    return rows.map(r => this.mapRow(r));
  }

  findByStatus(projectId: string, ...statuses: TaskStatus[]): SupervisionTask[] {
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM supervision_tasks WHERE project_id = ? AND status IN (${placeholders}) ORDER BY priority ASC, created_at ASC`
    ).all(projectId, ...statuses);
    return rows.map(r => this.mapRow(r));
  }

  updateStatus(id: string, status: TaskStatus, extra?: Record<string, any>): void {
    const updates = ['status = ?', 'updated_at = ?'];
    const params: any[] = [status, Date.now()];

    if (status === 'running' && !extra?.startedAt) {
      updates.push('started_at = ?');
      params.push(Date.now());
    }
    if (['integrated', 'failed', 'cancelled'].includes(status)) {
      updates.push('completed_at = ?');
      params.push(Date.now());
    }
    if (extra?.result) {
      updates.push('result = ?');
      params.push(JSON.stringify(extra.result));
    }
    if (extra?.sessionId !== undefined) {
      updates.push('session_id = ?');
      params.push(extra.sessionId);
    }
    if (extra?.attempt !== undefined) {
      updates.push('attempt = ?');
      params.push(extra.attempt);
    }
    if (extra?.baseCommit !== undefined) {
      updates.push('base_commit = ?');
      params.push(extra.baseCommit);
    }

    params.push(id);
    this.db.prepare(
      `UPDATE supervision_tasks SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);
  }

  update(id: string, data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode' |
    'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
  >>): SupervisionTask | undefined {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.title !== undefined) { updates.push('title = ?'); params.push(data.title); }
    if (data.description !== undefined) { updates.push('description = ?'); params.push(data.description); }
    if (data.priority !== undefined) { updates.push('priority = ?'); params.push(data.priority); }
    if (data.dependencies !== undefined) { updates.push('dependencies = ?'); params.push(JSON.stringify(data.dependencies)); }
    if (data.dependencyMode !== undefined) { updates.push('dependency_mode = ?'); params.push(data.dependencyMode); }
    if (data.acceptanceCriteria !== undefined) { updates.push('acceptance_criteria = ?'); params.push(JSON.stringify(data.acceptanceCriteria)); }

    if (updates.length === 0) return this.findById(id);

    params.push(id);
    this.db.prepare(
      `UPDATE supervision_tasks SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);

    return this.findById(id);
  }

  countByProject(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM supervision_tasks WHERE project_id = ?'
    ).get(projectId) as { count: number };
    return row.count;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM supervision_tasks WHERE id = ?').run(id);
  }
}
```

---

## 4. ContextManager (`server/src/services/context-manager.ts`)

New file. Manages the `.supervision/` directory I/O.

### Public API

```typescript
export interface ContextDocument {
  id: string;              // relative path, e.g. "specs/requirements.md"
  category: string;        // from YAML frontmatter
  source: string;          // 'user' | 'agent'
  version: number;
  updated: string;         // ISO date
  content: string;         // markdown body (without frontmatter)
}

export interface WorkflowConfig {
  onTaskComplete: WorkflowAction[];
  onCheckpoint: WorkflowAction[];
  checkpointTrigger: CheckpointTrigger;
}

export interface WorkflowAction {
  type: string;
  command?: string;
  description?: string;
  scope?: string;
  prompt?: string;
}

export class ContextManager {
  constructor(private projectRootPath: string) {}

  // Checks if .supervision/ exists
  isInitialized(): boolean;

  // Scans and parses all files in .supervision/
  // Returns ContextDocument[] + WorkflowConfig
  // On parse error: throws with details (caller should set contextSyncStatus='error')
  loadAll(): { documents: ContextDocument[]; workflow: WorkflowConfig };

  // Reads a single document by relative path
  getDocument(docId: string): ContextDocument | undefined;

  // Writes/updates a single document (auto-increments version)
  updateDocument(docId: string, content: string, meta?: Partial<{ category: string; source: string }>): void;

  // Returns the rolling project-summary.md content
  getProjectSummary(): string | undefined;

  // Writes project-summary.md
  updateProjectSummary(content: string): void;

  // Scaffolds the initial .supervision/ directory with template files
  scaffold(goal: string): void;

  // Gets context to inject into task system prompt (project-summary + relevantDocIds)
  getContextForTask(relevantDocIds?: string[]): string;

  // Gets workflow config (parsed from workflow.yaml)
  getWorkflow(): WorkflowConfig;

  // Writes task result to .supervision/results/task-{id}.md
  writeTaskResult(taskId: string, content: string): void;

  // Writes review notes to .supervision/results/task-{id}.review.md
  writeReviewResult(taskId: string, content: string): void;

  // Reads task result
  getTaskResult(taskId: string): string | undefined;
}
```

### Implementation Notes

- Use `fs` + `path` — no external deps needed
- Parse YAML frontmatter with a lightweight parser (e.g. `gray-matter` or manual regex: `---\n...---\n`)
- Parse `workflow.yaml` with `js-yaml` (already available as transitive dep, or add it)
- `scaffold()` creates the directory structure from the design doc, populating `goal.md`, empty spec/guideline/knowledge stubs, and a default `workflow.yaml`
- `loadAll()` uses `fs.readdirSync` recursively, skipping `results/` directory for performance

### Dependencies to Add

```bash
pnpm add --filter server gray-matter js-yaml
pnpm add --filter server -D @types/js-yaml
```

---

## 5. SupervisorService v2 (`server/src/services/supervisor-v2-service.ts`)

New file. **Does not replace v1** in Phase 1 — coexists. v1 is deprecated but functional.

### Responsibilities in Phase 1

- Agent lifecycle (init → setup → active → idle → paused → archived)
- Serial task scheduling (DAG with `maxConcurrentTasks = 1`)
- Task creation with explicit status rules
- Manual review (no AI review engine yet — user approves/rejects via API)
- Context reload coordination
- Budget limit checking

### Public API

```typescript
export class SupervisorV2Service {
  constructor(
    private db: Database.Database,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private sessionRepo: SessionRepository,
    private broadcastFn: (msg: ServerMessage) => void,
  ) {}

  // Initialize agent on a project
  initAgent(projectId: string, config?: Partial<SupervisorConfig>): ProjectAgent;

  // Update agent phase (pause/resume/archive/approve_setup)
  updateAgentPhase(projectId: string, action: 'pause' | 'resume' | 'archive' | 'approve_setup'): ProjectAgent;

  // Get agent for a project
  getAgent(projectId: string): ProjectAgent | undefined;

  // Create a task (sets status based on source + trustLevel rules)
  createTask(projectId: string, data: {
    title: string;
    description: string;
    source?: 'user' | 'agent_discovered';
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    priority?: number;
    acceptanceCriteria?: string[];
    relevantDocIds?: string[];
    scope?: string[];
  }): SupervisionTask;

  // Approve a proposed task (transitions proposed → pending)
  approveTask(taskId: string): SupervisionTask;

  // Reject a proposed task (transitions proposed → cancelled)
  rejectTask(taskId: string): SupervisionTask;

  // Manual review: approve a completed task (Phase 1 only — no AI review)
  approveTaskResult(taskId: string): SupervisionTask;

  // Manual review: reject a completed task with notes
  rejectTaskResult(taskId: string, reviewNotes: string): SupervisionTask;

  // Scheduler tick — moves pending → queued → running (serial only in Phase 1)
  tick(): void;

  // Reload context from .supervision/ files
  reloadContext(projectId: string): void;

  // Get all tasks for a project
  getTasks(projectId: string): SupervisionTask[];

  // Get context documents for a project
  getContextDocuments(projectId: string): ContextDocument[];
}
```

### Task Status Rules (Phase 1)

```
createTask(source='user')                     → status = 'pending'
createTask(source='agent_discovered', low/med) → status = 'proposed'
createTask(source='agent_discovered', high)    → status = 'pending'

approveTask(proposed)  → 'pending'
rejectTask(proposed)   → 'cancelled'

tick():
  pending + all deps integrated → 'queued'
  queued + no running tasks     → 'running' (create task session, start Provider run)

task run completes → status = 'reviewing' (wait for manual review)

approveTaskResult(reviewing) → 'approved' → 'integrated' (Phase 1: same step in serial mode)
rejectTaskResult(reviewing)  → 'rejected' → 'queued' (if attempt <= maxRetries+1, inject reviewNotes)
                              → 'failed' (if attempt > maxRetries+1)
```

### Scheduler Logic (Serial, Phase 1)

```typescript
tick(): void {
  // 1. Check pending tasks — promote to queued if dependencies met
  const pending = this.taskRepo.findByStatus(projectId, 'pending');
  for (const task of pending) {
    if (this.areDependenciesMet(task)) {
      this.taskRepo.updateStatus(task.id, 'queued');
      this.broadcast(task);
    }
  }

  // 2. If no task is running, pick highest-priority queued task
  const running = this.taskRepo.findByStatus(projectId, 'running');
  if (running.length > 0) return;

  const queued = this.taskRepo.findByStatus(projectId, 'queued');
  if (queued.length === 0) {
    // Check if all tasks done → move agent to idle
    this.checkIdleTransition(projectId);
    return;
  }

  const next = queued[0]; // already sorted by priority
  this.startTask(next);
}

private areDependenciesMet(task: SupervisionTask): boolean {
  if (task.dependencies.length === 0) return true;
  const deps = task.dependencies.map(id => this.taskRepo.findById(id)).filter(Boolean);

  if (task.dependencyMode === 'all') {
    return deps.every(d => d!.status === 'integrated');
  } else {
    // 'any' mode
    const anyIntegrated = deps.some(d => d!.status === 'integrated');
    const allTerminal = deps.every(d => ['integrated', 'failed', 'cancelled'].includes(d!.status));
    if (anyIntegrated) return true;
    if (allTerminal) {
      // All deps are terminal but none integrated — block this task
      this.taskRepo.updateStatus(task.id, 'blocked');
      return false;
    }
    return false;
  }
}
```

---

## 6. API Routes (`server/src/routes/supervision-v2.ts`)

New Express router, mounted at `/api/v2/supervision`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/projects/:projectId/agent/init` | Initialize agent |
| `POST` | `/projects/:projectId/agent/action` | Pause/resume/archive/approve_setup |
| `GET` | `/projects/:projectId/agent` | Get agent state |
| `GET` | `/projects/:projectId/tasks` | List tasks |
| `POST` | `/projects/:projectId/tasks` | Create task |
| `PUT` | `/tasks/:taskId` | Update task |
| `POST` | `/tasks/:taskId/approve` | Approve proposed task |
| `POST` | `/tasks/:taskId/reject` | Reject proposed task |
| `POST` | `/tasks/:taskId/review/approve` | Manual review: approve |
| `POST` | `/tasks/:taskId/review/reject` | Manual review: reject (body: `{ notes }`) |
| `POST` | `/projects/:projectId/context/reload` | Reload .supervision/ |
| `GET` | `/projects/:projectId/context` | Get context documents |
| `GET` | `/projects/:projectId/logs` | Get supervision v2 logs |

---

## 7. WebSocket Handler Registration

In `server/src/server.ts`, register new WS message handlers:

```typescript
// In the message router setup:
router.register('get_supervision_tasks', supervisionV2Handlers.getTasks);
router.register('add_supervision_task', supervisionV2Handlers.addTask);
router.register('update_supervision_task', supervisionV2Handlers.updateTask);
router.register('init_supervision_agent', supervisionV2Handlers.initAgent);
router.register('update_supervision_agent', supervisionV2Handlers.updateAgent);
router.register('reload_supervision_context', supervisionV2Handlers.reloadContext);
```

---

## 8. Task Session Integration

When a task transitions to `running`, the supervisor creates a background session:

```typescript
private async startTask(task: SupervisionTask): Promise<void> {
  const project = this.projectRepo.findById(task.projectId);
  if (!project?.rootPath) throw new Error('Project has no root path');

  // Create task session
  const session = this.sessionRepo.create({
    projectId: task.projectId,
    name: `Task: ${task.title}`,
    type: 'background',
    projectRole: 'task',
    taskId: task.id,
    providerId: project.providerId,
    workingDirectory: project.rootPath, // Phase 1: always main directory
  });

  // Update task status
  this.taskRepo.updateStatus(task.id, 'running', { sessionId: session.id });

  // Build system prompt with context injection
  const contextManager = new ContextManager(project.rootPath);
  const contextInjection = contextManager.getContextForTask(task.relevantDocIds);
  const systemPrompt = this.buildTaskSystemPrompt(task, contextInjection);

  // Trigger Provider run (reuse existing handleRunStart)
  this.triggerProviderRun(session, systemPrompt + '\n\n' + task.description);
}
```

### Task System Prompt Template

```
[SUPERVISED TASK]
Project: {projectName}
Task: {task.title}
Attempt: {task.attempt}

== Project Context ==
{project-summary.md content}

== Task Description ==
{task.description}

== Acceptance Criteria ==
{task.acceptanceCriteria joined by newline}

{if task.attempt > 1}
== Previous Review Feedback ==
{task.result.reviewNotes}
{endif}

== Instructions ==
When complete, output your results in this format:
[TASK_RESULT]
- summary: <brief summary>
- files_changed: <comma-separated list>
- tests: <test results if applicable>
[/TASK_RESULT]
```

---

## 9. File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `server/src/services/context-manager.ts` | `.supervision/` file I/O |
| `server/src/services/supervisor-v2-service.ts` | Supervisor v2 orchestrator |
| `server/src/repositories/supervision-task.ts` | Task CRUD repository |
| `server/src/routes/supervision-v2.ts` | REST API routes |

### Modified Files

| File | Changes |
|------|---------|
| `shared/src/index.ts` | Add v2 types, extend Project/Session, add WS messages |
| `server/src/storage/db.ts` | Add migration `025_supervision_v2` |
| `server/src/repositories/project.ts` | Map `agent`, `contextSyncStatus` fields |
| `server/src/repositories/session.ts` | Map `projectRole`, `taskId` fields |
| `server/src/server.ts` | Wire up v2 service, register WS handlers, mount routes |
| `server/src/routes/supervisions.ts` | Add deprecation header to v1 endpoints |

### NPM Dependencies

| Package | Workspace | Purpose |
|---------|-----------|---------|
| `gray-matter` | server | Parse YAML frontmatter |
| `js-yaml` | server | Parse workflow.yaml |
| `@types/js-yaml` | server (dev) | TypeScript types |

---

## 10. Testing Strategy

### Unit Tests

| Test File | Covers |
|-----------|--------|
| `server/src/repositories/__tests__/supervision-task.test.ts` | CRUD, status transitions, filtering |
| `server/src/services/__tests__/context-manager.test.ts` | Scaffold, load, parse, write, error handling |
| `server/src/services/__tests__/supervisor-v2-service.test.ts` | Agent lifecycle, task creation rules, scheduler tick, dependency resolution |

### Key Test Scenarios

1. **Task status rules**: verify `source` + `trustLevel` → correct initial status
2. **Dependency resolution**: `all` mode, `any` mode, cascading failure
3. **Budget limits**: `maxTotalTasks` triggers pause
4. **Context sync error**: corrupted file → `contextSyncStatus = 'error'` → phase = `paused`
5. **Serial scheduling**: only one task runs at a time
6. **Retry logic**: `attempt` increments, `reviewNotes` injected, max retries → `failed`

---

## 11. Acceptance Criteria

- [ ] `shared` types compile cleanly, existing code unaffected
- [ ] DB migration runs without error on existing databases
- [ ] Agent can be initialized on a project via API
- [ ] `.supervision/` directory scaffolded with correct structure on init
- [ ] Tasks created with correct status based on `source` + `trustLevel`
- [ ] Serial scheduler runs one task at a time
- [ ] Task sessions created as background sessions with context injection
- [ ] Manual review approve/reject works via API
- [ ] Context reload reads `.supervision/` files and updates state
- [ ] Budget limit (`maxTotalTasks`) pauses agent when exceeded
- [ ] v1 supervision endpoints still work (backward compat)
