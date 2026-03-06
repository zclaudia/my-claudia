# Supervision v2 Design

## 1. Product Positioning

Supervision is a **project-level AI orchestration layer** — an AI project manager for MyClaudia Projects.

- Does not execute code tasks directly; instead splits, schedules, monitors, and reviews
- Manages project specs, guidelines, and knowledge that evolve over time
- Long-lived project container, not a one-shot task executor
- Inspired by OpenSpec (spec-driven development) and superpowers (workflow discipline)

## 2. Conceptual Model

```
┌──────────────────────────────────────────────────────┐
│                      Project                          │
│  (Persistent container: goal, specs, knowledge, tasks)│
│                                                       │
│  ┌──────────────┐                                    │
│  │    Agent      │  (Orchestration: split, schedule,  │
│  │ (Supervisor)  │   review, update knowledge)        │
│  └──────┬───────┘                                    │
│         │ creates & manages                           │
│  ┌──────┴───────────────────────────────────┐        │
│  │              Sessions                     │        │
│  │  ┌──────┐  ┌───────┐  ┌───────┐  ┌────┐ │        │
│  │  │ main │  │task #1│  │task #2│  │ rv │ │        │
│  │  └──┬───┘  └──┬────┘  └──┬────┘  └──┬─┘ │        │
│  └─────┼─────────┼──────────┼───────────┼───┘        │
│        │         │          │           │             │
│        ▼         ▼          ▼           ▼             │
│     Provider  Provider   Provider    Provider         │
│    (Claude)  (Claude)   (Codex)    (Claude)           │
└──────────────────────────────────────────────────────┘

Standalone (unchanged):
┌────────────────┐
│ Normal Session  │  ← not part of any supervision
└────────────────┘
```

### Core Concepts

| Concept | Responsibility | Persistence |
|---------|---------------|-------------|
| **Project** | Data container (goal, specs, knowledge, task state) | Long-lived |
| **Agent** | Behavior strategy (how to orchestrate, schedule, review) | Attached to Project |
| **Session** | Interaction channel (main conversation, task execution, review) | Can be created/destroyed/replaced |
| **Provider** | Execution engine (Claude/OpenCode/Codex/Cursor CLI adapter) | Existing, unchanged |

Layer relationship: `Project → Agent → Session(s) → Provider.run()`

## 3. Data Model

### 3.1 Project (extend existing)

```typescript
export interface Project {
  // --- Existing fields, all preserved ---
  id: string;
  name: string;
  type: ProjectType;
  providerId?: string;
  rootPath?: string;
  systemPrompt?: string;
  permissionPolicy?: PermissionPolicy;
  agentPermissionOverride?: Partial<AgentPermissionPolicy>;
  isInternal?: boolean;
  createdAt: number;
  updatedAt: number;

  // --- New ---
  agent?: ProjectAgent;       // Optional; present = supervised project
  contextSyncStatus?: 'synced' | 'error'; // Error state if .supervision files are corrupted/unparseable
}
```

### 3.2 ProjectAgent (new)

```typescript
export type AgentType = 'supervisor';

export type SupervisionPhase =
  | 'initializing'   // Interacting with user, understanding goal
  | 'setup'          // Forming specs/guidelines/knowledge/workflow
  | 'active'         // Tasks are executing
  | 'paused'         // Paused by user or guardrails (budget/sync errors)
  | 'idle'           // No active tasks, waiting for new tasks
  | 'archived';      // User archived the project

export interface ProjectAgent {
  type: AgentType;
  phase: SupervisionPhase;
  config: SupervisorConfig;
  mainSessionId?: string;     // Current main session (can be replaced when full)
  pausedReason?: 'user' | 'budget' | 'sync_error';
  pausedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SupervisorConfig {
  maxConcurrentTasks: number;         // Default 2
  trustLevel: TrustLevel;
  autoDiscoverTasks: boolean;

  // Budget / safety limits
  maxTotalTasks?: number;             // Hard cap on total tasks (including retries). On hit: phase -> paused, pausedReason='budget'.
  maxTokenBudget?: number;            // Optional cumulative token limit across all sessions. On hit: phase -> paused, pausedReason='budget'.
}
// Note: checkpointTrigger and onTaskComplete/onCheckpoint workflow actions
// are defined in .supervision/workflow.yaml (the file-based source of truth).
// On startup / reload, ContextManager parses workflow.yaml and provides it
// to CheckpointEngine and TaskRunner at runtime.

// Defined in workflow.yaml, parsed at runtime (not stored in DB/SupervisorConfig)
export type CheckpointTrigger =
  | { type: 'on_task_complete' }
  | { type: 'on_idle' }
  | { type: 'interval'; minutes: number }
  | { type: 'combined'; triggers: CheckpointTrigger[] };

// Progressive trust mechanism
export type TrustLevel =
  | 'low'       // Task creation + review results both need user approval
  | 'medium'    // Task creation needs approval, review auto-executes
  | 'high';     // Fully automatic, only checkpoint summaries notify user
```

### 3.3 ProjectContext (filesystem, not in DB)

Stored in the project's `.supervision/` directory. Each file uses YAML frontmatter.

```
.supervision/
├── project-summary.md          # Rolling summary (auto-maintained by CheckpointEngine)
├── goal.md                     # Project goal
├── specs/
│   ├── requirements.md         # Requirements spec
│   └── architecture.md         # Architecture design
├── guidelines/
│   ├── coding-style.md         # Coding standards
│   └── testing-strategy.md     # Testing strategy
├── knowledge/
│   ├── codebase-overview.md    # Existing codebase analysis
│   └── decisions.md            # Decision log, lessons learned
├── workflow.yaml               # Automation workflow config
└── results/
    ├── task-{id}.md            # Task execution results
    └── task-{id}.review.md     # Review notes
```

File format example:

```markdown
---
category: guideline
source: agent
version: 3
updated: 2026-03-05
---

# Coding Style

- Use Result type for error handling
- ...
```

Workflow config (`workflow.yaml`):

```yaml
onTaskComplete:
  # Executed in the task's working directory (worktree or main dir)
  # BEFORE review, so results are included in the review context.
  - type: run_command
    command: pnpm test
    description: Run tests
  - type: run_command
    command: pnpm lint
    description: Run linter

onCheckpoint:
  - type: review_changes
    scope: all
  - type: update_knowledge
    prompt: Update knowledge base based on recently completed tasks

checkpointTrigger:
  type: on_task_complete
```

**Workflow action execution context**: `onTaskComplete` actions run in the task's working directory (its worktree if parallel, or the main directory if serial). They execute **after the task run completes but before review**, so their outputs (test results, lint errors) are included in the review session's context as objective evidence.

**Context sync guardrail**: if `.supervision/` files are corrupted/unparseable, `contextSyncStatus` must be set to `error` and the project should transition to `paused` with `pausedReason = 'sync_error'` until the user fixes files and reloads.

Key properties:

- **Git-hostable** — team can share specs via version control
- **Provider-agnostic** — any AI tool can read these files
- **Context Injection & Token Limits** — `relevantDocIds` are kept minimal. A rolling `project-summary.md` is always injected into task/review system prompts as the lightweight baseline context. Detailed specs are accessed via `Read` tool on demand to prevent "Lost in the Middle" token bloat. `project-summary.md` is auto-maintained by the CheckpointEngine after each checkpoint cycle.
- **Sync mechanism** — auto-scan on startup + manual reload button in UI

### 3.4 SupervisionTask (new)

```typescript
export type TaskStatus =
  | 'proposed'    // Suggested by agent, awaits user approval (if trustLevel < high)
  | 'pending'     // Waiting for dependencies
  | 'queued'      // Dependencies met, awaiting scheduling
  | 'running'     // Child session executing
  | 'reviewing'   // Supervisor reviewing
  | 'approved'    // Review passed, awaiting integration
  | 'integrated'  // Integrated into project baseline — the true "done"
  | 'rejected'    // Review failed, pending retry
  | 'merge_conflict' // Git merge conflict needs resolution
  | 'blocked'     // Waiting for manual intervention
  | 'failed'      // Failed or exceeded max retries
  | 'cancelled';

export interface SupervisionTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  source: 'user' | 'agent_discovered';

  // Execution
  sessionId?: string;
  status: TaskStatus;
  priority: number;                 // Lower = higher priority

  // Dependencies
  dependencies: string[];           // Prerequisite task IDs
  dependencyMode: 'all' | 'any';

  // Context
  relevantDocIds?: string[];        // Required context documents (empty = all)
  taskSpecificContext?: string;     // Supplementary context
  scope?: string[];                 // Predicted files/dirs (informational only)

  // Acceptance
  acceptanceCriteria: string[];
  maxRetries: number;               // Default 2
  attempt: number;                  // Monotonic run attempt (1 = first run, 2 = first retry, ...). Failed when attempt > maxRetries + 1.

  // Results (also written to .supervision/results/task-{id}.md)
  result?: TaskResult;
  baseCommit?: string;              // Git: baseline commit for deterministic review/integration

  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

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
```

### 3.5 Session (minimal extension)

```typescript
export interface Session {
  // --- All existing fields unchanged ---
  id: string;
  projectId: string;
  name?: string;
  providerId?: string;
  sdkSessionId?: string;
  type: SessionType;                // 'regular' | 'background'
  parentSessionId?: string;
  workingDirectory?: string;
  createdAt: number;
  updatedAt: number;
  isActive?: boolean;
  archivedAt?: number;

  // --- New ---
  projectRole?: 'main' | 'task' | 'review' | 'checkpoint';
  taskId?: string;                  // Associated task (for task/review sessions)
}
```

## 4. Lifecycle

```
┌───────────────────────────────────────────────────────────────────┐
│                      PROJECT LIFECYCLE                             │
│                                                                    │
│  ┌────────────┐   ┌──────────┐   ┌────────┐                      │
│  │INITIALIZING│──▶│  SETUP   │──▶│ ACTIVE │                      │
│  │ User dialog │   │ Form specs│   │Executing│                      │
│  │ Define goal │   │User approve│  │        │                      │
│  └────────────┘   └──────────┘   └───┬────┘                      │
│                                      │                             │
│                    ┌─────────────────┼──────────────┐             │
│                    ▼                 ▼              ▼             │
│               All tasks         New task /      User archive      │
│               done              user chat                         │
│                    │                 │              │             │
│                    ▼                 │              ▼             │
│               ┌────────┐            │        ┌──────────┐        │
│               │  IDLE  │◀───────────┘        │ ARCHIVED │        │
│               └───┬────┘                     └──────────┘        │
│                   │                                ▲              │
│               New task                          Unarchive         │
│                   │                                               │
│                   ▼                                               │
│               ┌────────┐                                          │
│               │ ACTIVE │                                          │
│               └────────┘                                          │
│                                                                    │
│   ┌────────────────────────────────────────────────────────┐      │
│   │ PAUSED (can be entered from ACTIVE or IDLE)            │      │
│   │                                                        │      │
│   │ Triggers: user action / budget limit / sync error      │      │
│   │ Resume:   user action (+ fix cause if guardrail)       │      │
│   │ Resumes back to: ACTIVE                                │      │
│   └────────────────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────────┘
```

### Phase Behaviors

**Initializing**
- Create main session with initialization system prompt
- Supervisor asks user about: goal, scope, constraints, testing strategy (2-3 rounds)
- User confirms → move to Setup

**Setup**
- Supervisor generates draft context documents in `.supervision/`
- Frontend displays structured drafts for user review/editing
- User approves → files persisted, move to Active/Idle

**Active**
- TaskScheduler continuously schedules ready tasks
- Each task → create child session → Provider run → write results to `.supervision/results/task-{id}.md`
- On completion → execute workflow actions → create review session → Approve/Reject
- On checkpoint → evaluate progress, update context documents, discover new tasks (default to `proposed` unless `trustLevel == high`)
- User can chat in main session, add tasks, adjust priorities at any time

**Paused**
- Entered by user action, budget guardrails, or context sync errors.
- No new tasks are scheduled while paused.
- Resume requires user action (and for budget pause: raise/reset limits; for sync pause: fix files + reload).

**Idle**
- No active tasks, agent on standby
- New task added → back to Active
- `autoDiscoverTasks` enabled → periodically discover new needs

**Archived**
- Read-only; all `.supervision/` files preserved
- Can be unarchived to reactivate

## 5. Task Lifecycle

```
                         ┌─(trustLevel < high)─▶ awaits user approval
proposed ────────────────┤
                         └─(trustLevel == high)─▶ auto-approve
                                                      │
              user rejects proposed ──▶ cancelled      │
                                                       ▼
pending → queued → running → reviewing → approved → integrated
                                │          │            │
                                │          │            └─ dependency gate opens
                                │          ├─(git) merge conflict → merge_conflict → blocked/retry
                                │          └─(non-git) snapshot/apply failure → blocked/retry
                                ▼
                            rejected ─(retry < max)──▶ queued (injects reviewNotes to next run)
                                │
                                └─(retry == max)─▶ failed ──(cascades)──▶ downstream tasks become 'blocked'
```

**Proposed state rules**:
- Tasks created by the agent (`source: 'agent_discovered'`) enter `proposed` state first.
- Tasks created by the user (`source: 'user'`) skip `proposed` and enter `pending` directly.
- When `trustLevel == 'high'`, agent-discovered tasks also skip `proposed` and enter `pending` directly.
- User can reject a `proposed` task → it becomes `cancelled`.
- Service-layer invariant: task creation must set `status` explicitly based on (`source`, `trustLevel`) and must not rely on DB defaults.

**Dependency resolution rule**: a task moves from `pending` to `queued` when its dependency gate is satisfied:
- `dependencyMode = 'all'`: **every** dependency must be `integrated`.
- `dependencyMode = 'any'`: **at least one** dependency must be `integrated`.

**Cascading Failure** (respects `dependencyMode`):
- `all` mode: if **any** dependency becomes `failed`/`cancelled` → downstream task becomes `blocked`.
- `any` mode: only if **every** dependency becomes `failed`/`cancelled` → downstream task becomes `blocked`. As long as one dependency can still reach `integrated`, the task remains `pending`.

**Anti-Deadloop (Retry)**: When entering retry, the `reviewNotes` from the failed review MUST be injected into the next run's prompt. If `attempt` exceeds `maxRetries + 1` (i.e. initial run + N retries), the task enters `failed` state and awaits human intervention.

- **Git projects**: `integrated` means task branch successfully merged to base branch.
- **Non-git projects**: `integrated` means task is approved and its workspace changes are applied to the active baseline snapshot.

Task structured output convention:

```markdown
[TASK_RESULT]
- summary: Refactored auth module, extracted AuthService class
- files_changed: src/auth/service.ts, src/auth/types.ts
- tests: 12 passed, 0 failed
[/TASK_RESULT]
```

## 6. Parallel Task Strategy

**Rule: parallel = isolate (worktree), serial = share**

| Scenario | Strategy |
|----------|----------|
| `maxConcurrentTasks = 1` | All tasks share main directory, no worktree needed |
| `maxConcurrentTasks > 1` | Each parallel task gets its own worktree |
| Non-git project | Degrade to `maxConcurrentTasks = 1`; use snapshot-based integration instead of merge |

### Worktree Management

- Pre-create `maxConcurrentTasks` worktrees as a pool
- Tasks acquire from pool, release on completion; worktrees are reused, not destroyed
- pnpm global store is shared across worktrees, reducing install overhead

### Worktree Allocation Flow

```
1. All dependencies have status = integrated
2. Task moves to queued
3. Scheduler assigns worktree → reset to latest main
4. Create task branch (task/{task-id}) → start execution
5. Complete → review → approved → merge back to main → integrated
```

```typescript
class WorktreePool {
  private mergeLock = new Mutex(); // Serialize all merge operations on mainPath

  async acquire(taskId: string, attempt: number): Promise<string> {
    const wt = this.getAvailable();

    // Reset to latest main — includes all integrated dependency changes
    await git('checkout', 'main', { cwd: wt.path });
    await git('reset', '--hard', 'main', { cwd: wt.path });
    await git('clean', '-fd', { cwd: wt.path }); // Remove untracked files from previous tasks

    // Create isolated task branch
    await git('checkout', '-b', `task/${taskId}/r${attempt}`, { cwd: wt.path });

    return wt.path;
  }

  async mergeBack(taskId: string, attempt: number, wtPath: string): Promise<MergeResult> {
    // Critical: acquire merge lock to prevent race conditions when
    // multiple parallel tasks complete near-simultaneously.
    return this.mergeLock.runExclusive(async () => {
      const branch = `task/${taskId}/r${attempt}`;

      await git('checkout', 'main', { cwd: mainPath });
      const result = await git('merge', branch, { cwd: mainPath });

      if (result.conflicts) {
        return { success: false, conflicts: result.conflicts };
      }

      // Branch cannot be deleted while checked out in its worktree.
      await git('checkout', 'main', { cwd: wtPath });
      await git('branch', '-d', branch, { cwd: mainPath });
      return { success: true };
    });
  }
}
```

### Task Commit Responsibility

Claude (via Provider) is expected to make commits during task execution as part of its normal workflow. After the Provider run completes, `TaskRunner.onTaskComplete()` ensures all remaining uncommitted changes are auto-committed with a standardized message (e.g. `chore(supervision): auto-commit remaining changes for task {id}`). This guarantees the task branch always has a clean, mergeable state before review.

### Merge Flow

- Task completes in worktree, all changes committed to task branch
- Review passes → merge task branch back to main
- No conflicts → task becomes `integrated`
- Conflicts → task becomes `merge_conflict` then `blocked` until resolved

## 7. Review & Inter-Session Communication

### Review Method: Independent Review Sessions

Each completed task gets a temporary review session. The reviewer receives the task description, acceptance criteria, execution summary, workflow check results, AND objective factual changes:
- Git projects: `git diff <baseCommit>..HEAD`
- Non-git projects: snapshot diff (`baselineSnapshotId -> currentSnapshotId`) + changed file hash delta + command outputs

**Crucially, the reviewer must not blindly trust the task's self-reported summary.**

**Review session lifecycle**: review sessions are auto-archived (`archivedAt = now`) once the review conclusion is parsed and the task status is updated. They are retained for audit trail but hidden from the sidebar's active session list. Checkpoint sessions follow the same cleanup policy.

### Communication Model

Sessions do not communicate directly. **SupervisorService acts as the hub**, with files as the persistent intermediary:

```
Task session ── outputs structured summary on completion
      │
      ▼
SupervisorService ── parses summary ── writes .supervision/results/task-{id}.md
      │
      ▼
Review session ── system prompt includes summary + deterministic objective evidence (git diff or snapshot diff) + can read result files
      │
      ▼
SupervisorService ── parses review conclusion ── writes task-{id}.review.md
      │
      ├── approved → update task status, trigger merge, trigger checkpoint
      └── rejected → retry (inject review notes into new task run)
```

## 8. Main Session Context Overflow

- Project context lives in `.supervision/` files, independent of any session
- When main session context is full → create new main session, update `agent.mainSessionId`
- New session reads `.supervision/` files to recover context on startup
- Old main session archived for reference

## 9. Backend Service Architecture

```
SupervisorService
├── ContextManager          # .supervision/ file I/O and reload
│   ├── loadContext()       → scan directory, parse frontmatter
│   ├── updateDocument()    → write file, increment version
│   ├── getContextForTask() → filter by relevantDocIds
│   └── reload()            → manual reload entry point
│
├── TaskScheduler           # DAG scheduler
│   ├── tick()              → check dependencies, schedule ready tasks
│   ├── addTask()
│   └── getDependencyGraph()
│
├── TaskRunner              # Child session lifecycle
│   ├── startTask()         → create session (assign worktree if needed)
│   ├── onTaskComplete()    → parse results, write result file, trigger review
│   └── retryTask()         → re-execute with review notes
│
├── ReviewEngine            # Independent review
│   ├── createReview()      → create review session, inject context
│   └── parseResult()       → parse approved/rejected
│
├── CheckpointEngine        # Progress calibration
│   ├── shouldTrigger()
│   ├── runCheckpoint()     → trigger in dedicated checkpoint session (not main, to avoid interrupting user chat)
│   ├── applyResult()       → update context, create proposed tasks (or pending if trustLevel == high), regenerate project-summary.md
│   └── notifyMain()        → post a summary message to main session for user visibility
│
└── WorktreePool            # Worktree management
    ├── acquire()           → get available worktree, reset to main
    ├── release()           → return to pool
    └── mergeBack()         → merge task branch back to main
```

## 10. DB Schema Changes

```sql
-- New: supervision tasks
CREATE TABLE supervision_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent_discovered')),
  session_id TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  dependencies TEXT,              -- JSON: string[]
  dependency_mode TEXT DEFAULT 'all',
  relevant_doc_ids TEXT,          -- JSON: string[]
  task_specific_context TEXT,
  scope TEXT,                     -- JSON: string[] (informational only)
  acceptance_criteria TEXT,       -- JSON: string[]
  max_retries INTEGER DEFAULT 2,
  attempt INTEGER NOT NULL DEFAULT 1,
  base_commit TEXT,
  result TEXT,                    -- JSON: TaskResult
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- New: supervision logs
CREATE TABLE supervision_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  event TEXT NOT NULL,
  detail TEXT,                    -- JSON
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Extend projects table
ALTER TABLE projects ADD COLUMN agent TEXT;    -- JSON: ProjectAgent
ALTER TABLE projects ADD COLUMN context_sync_status TEXT NOT NULL DEFAULT 'synced';

-- Extend sessions table
ALTER TABLE sessions ADD COLUMN project_role TEXT;  -- 'main' | 'task' | 'review' | 'checkpoint'
ALTER TABLE sessions ADD COLUMN task_id TEXT;

-- Deprecate old tables
-- supervisions → drop after migration
```

Task creation must set `status` explicitly in application logic:
- `source = 'user'` → `pending`
- `source = 'agent_discovered'` + `trustLevel < high` → `proposed`
- `source = 'agent_discovered'` + `trustLevel == high` → `pending`

## 11. Integration with Existing Systems

| Existing Capability | Impact |
|---------------------|--------|
| Project | Add `agent` field |
| Session | Add `projectRole` / `taskId` fields |
| Provider / ProviderAdapter | **No changes** |
| Background session | Task sessions are background sessions — reuse |
| Permission system | Task sessions inherit project's permissionPolicy |
| WebSocket broadcast | Add task/checkpoint message types |
| Notification (ntfy) | Push on task complete/fail/needs approval — reuse |
| State heartbeat | Extend to include task run status |
| Supervision v1 | **Full replacement** |

## 12. Design Decisions Summary

| # | Question | Decision |
|---|----------|----------|
| 1 | Supervision scope | **Project-level**, long-lived |
| 2 | Agent vs Provider relationship | Agent orchestrates above; Provider executes below; independent |
| 3 | Context document storage | **`.supervision/` directory**, .md files with YAML frontmatter |
| 4 | External edit sync | Auto-scan on startup + **manual reload button** |
| 5 | Parallel task file conflicts | **Parallel = worktree isolation**, serial = shared directory |
| 6 | Worktree management | **Worktree pool**, reuse without destroying |
| 7 | Review method | **Independent temporary review sessions** |
| 8 | Inter-session communication | No direct communication; **SupervisorService hub + file intermediary** |
| 9 | Main session context overflow | Create new main session; `.supervision/` files are independent |
| 10 | Dependency resolution | Task unblocks only when all dependencies are **integrated** (`merged` in git, snapshot-integrated in non-git) |
| 11 | Non-git project support | Degrade to `maxConcurrentTasks = 1`; all other features unchanged |
| 12 | Merge concurrency | **Mutex lock** on `mergeBack()`; parallel execution, serial merge |
| 13 | Proposed task rules | Agent-discovered tasks require user approval unless `trustLevel == high` |
| 14 | Checkpoint execution | Dedicated checkpoint session (not main) to avoid interrupting user chat |
| 15 | Workflow action context | `onTaskComplete` runs in task's working dir, **before review**, outputs feed into review |
| 16 | Cost control | `maxTotalTasks` and `maxTokenBudget` caps; on hit set phase to `paused` with `pausedReason='budget'` |
| 17 | Ephemeral session cleanup | Review and checkpoint sessions auto-archived after completion |
| 18 | Non-git review evidence | Use snapshot diff + hash delta + command outputs as deterministic objective evidence |
| 19 | Context sync persistence | Persist `context_sync_status` in `projects` table and pause on sync errors |
| 20 | Task status safety | No DB default for `status`; service must set explicit status from (`source`, `trustLevel`) |
| 21 | Cascading failure vs dependencyMode | `all` mode: any dep failed → blocked. `any` mode: all deps failed → blocked |
| 22 | Retry counting | Single `attempt` field (1 = first run). Failed when `attempt > maxRetries + 1`. `retryCount` removed. |
| 23 | Workflow config source of truth | `workflow.yaml` is the single source; parsed at runtime by ContextManager, not stored in DB |
| 24 | Task commit responsibility | Claude commits during execution; TaskRunner auto-commits any remaining changes after run |

## 13. Implementation Phases (MVP Strategy)

To manage engineering complexity and risk, this architecture will be rolled out in phases:

### Phase 1: Context Management & Serial Execution (MVP)
- `maxConcurrentTasks` forced to 1 (No git worktrees, no branching/merging).
- Implement Init & Setup phases to generate and manage `.supervision/` documents.
- Manual task creation and DAG scheduling (serial only).
- **Manual Review**: User acts as the reviewer when a task finishes.
- **Task completion rule (MVP)**: `approved` is treated as `integrated` in serial mode.
- **Value delivered**: Claude gets consistent, structured project context for every task, eliminating the "blank slate" problem.

### Phase 2: AI Review Engine
- Introduce the independent temporary Review Session.
- Implement the structured summary parsing and deterministic objective evidence injection (`git diff <baseCommit>..HEAD` for git; snapshot diff + hash delta for non-git).
- Implement auto-retry on rejection.
- **Value delivered**: True autonomous iteration for single tasks.

### Phase 3: Parallel Execution & Git Workspaces
- Implement the `WorktreePool` (`git clean -fd`, `reset --hard`).
- Enable `maxConcurrentTasks > 1`.
- Implement background branch creation and auto-merging.
- **Value delivered**: Speed and multi-tasking for complex, multi-faceted projects.

### Phase 4: Resilience & State Recovery
- Implement robust DB state recovery on service startup (re-hydrating suspended tasks or orphaned worktrees).
