# Phase 4: Resilience, Checkpoint Engine & Advanced Features

> **Goal**: Production-grade robustness — state recovery, checkpoint-driven knowledge evolution, auto task discovery, cost control enforcement, and v1 deprecation cleanup.
>
> **Prerequisite**: Phase 1 + Phase 2 + Phase 3 completed.
>
> **Value delivered**: Supervision survives service restarts, actively evolves project knowledge, discovers new tasks, and enforces budget limits.

---

## 1. Overview

Phase 4 addresses:

1. **CheckpointEngine** — periodic evaluation, knowledge update, task discovery
2. **State Recovery** — re-hydrate in-progress tasks and orphaned worktrees on restart
3. **Cost Control Enforcement** — token budget and task count limits
4. **Main Session Overflow** — auto-create new main session when context is full
5. **Auto Task Discovery** — agent-initiated research sessions to find new tasks
6. **v1 Supervision Deprecation** — remove old code, clean up DB
7. **Frontend integration** — Supervision v2 UI components

---

## 2. CheckpointEngine (`server/src/services/checkpoint-engine.ts`)

New file. Implements periodic or event-driven project evaluation.

### Public API

```typescript
export class CheckpointEngine {
  constructor(
    private db: Database.Database,
    private supervisorService: SupervisorV2Service,
    private contextManager: ContextManager,
    private sessionRepo: SessionRepository,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private broadcastFn: (msg: ServerMessage) => void,
  ) {}

  // Evaluate whether a checkpoint should trigger
  shouldTrigger(projectId: string, event: 'task_complete' | 'idle' | 'interval'): boolean;

  // Run a checkpoint: create checkpoint session, evaluate, update context
  async runCheckpoint(projectId: string): Promise<void>;

  // Start interval-based trigger (if configured)
  startInterval(projectId: string): void;

  // Stop interval
  stopInterval(projectId: string): void;
}
```

### Checkpoint Flow

```
Trigger detected (task_complete / idle / interval timer)
    │
    ▼
CheckpointEngine.shouldTrigger()
    │ (checks: not paused, no checkpoint already running, trigger config matches)
    │
    ▼
CheckpointEngine.runCheckpoint()
    │
    ├── 1. Create checkpoint session (background, projectRole: 'checkpoint')
    │
    ├── 2. Build checkpoint prompt with:
    │       - project-summary.md
    │       - Recently completed tasks and their results
    │       - Current task queue status
    │       - Current specs/guidelines
    │
    ├── 3. Trigger Provider run
    │
    ▼
Checkpoint session completes
    │
    ├── 4. Parse checkpoint output:
    │       [CHECKPOINT_RESULT]
    │       progress_assessment: |
    │         <assessment text>
    │       knowledge_updates:
    │         - file: knowledge/decisions.md
    │           action: append
    │           content: |
    │             <content to append>
    │       discovered_tasks:
    │         - title: <title>
    │           description: <description>
    │           dependencies: [<task_id>, ...]
    │           priority: <number>
    │       updated_summary: |
    │         <new project-summary.md content>
    │       [/CHECKPOINT_RESULT]
    │
    ├── 5. Apply knowledge updates via ContextManager
    ├── 6. Update project-summary.md
    ├── 7. Create discovered tasks (status: proposed or pending per trust rules)
    ├── 8. Post summary to main session for user visibility
    └── 9. Archive checkpoint session
```

### Checkpoint System Prompt

```
[PROJECT CHECKPOINT]

You are conducting a periodic checkpoint review for a supervised project.

== Project Summary ==
{project-summary.md content}

== Recently Completed Tasks ==
{foreach recently completed tasks}
Task: {title}
Result: {summary}
Files: {filesChanged}
{endforeach}

== Current Task Queue ==
{foreach pending/queued/running tasks}
- [{status}] {title} (priority: {priority})
{endforeach}

== Instructions ==
1. Assess overall progress toward the project goal
2. Identify any knowledge or decisions worth recording
3. Suggest any new tasks that should be created
4. Write an updated project summary

Output in this format:
[CHECKPOINT_RESULT]
progress_assessment: |
  <your assessment>
knowledge_updates:
  - file: <relative path in .supervision/>
    action: append|replace
    content: |
      <content>
discovered_tasks:
  - title: <title>
    description: <description>
    dependencies: []
    priority: 0
updated_summary: |
  <new project-summary.md>
[/CHECKPOINT_RESULT]
```

### Checkpoint Trigger Configuration

Parsed from `.supervision/workflow.yaml` by `ContextManager`:

```yaml
checkpointTrigger:
  type: combined
  triggers:
    - type: on_task_complete
    - type: interval
      minutes: 30
```

Implementation:

```typescript
shouldTrigger(projectId: string, event: 'task_complete' | 'idle' | 'interval'): boolean {
  const agent = this.supervisorService.getAgent(projectId);
  if (!agent || agent.phase === 'paused') return false;

  // Don't run if a checkpoint is already in progress
  const activeCheckpoints = this.sessionRepo.findByProjectRole(projectId, 'checkpoint');
  if (activeCheckpoints.some(s => !s.archivedAt)) return false;

  const workflow = this.contextManager.getWorkflow();
  return this.matchesTrigger(workflow.checkpointTrigger, event);
}

private matchesTrigger(trigger: CheckpointTrigger, event: string): boolean {
  if (trigger.type === event) return true;
  if (trigger.type === 'on_task_complete' && event === 'task_complete') return true;
  if (trigger.type === 'on_idle' && event === 'idle') return true;
  if (trigger.type === 'combined') {
    return trigger.triggers.some(t => this.matchesTrigger(t, event));
  }
  return false;
}
```

---

## 3. State Recovery (`server/src/services/state-recovery.ts`)

New file. Re-hydrates supervision state on service startup.

### Scenarios

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Task was `running` but no active Provider run | `status = 'running'` + no matching `activeRuns` entry | Mark `failed` with `reason: 'service_restart'`, increment attempt, re-queue if retries left |
| Task was `reviewing` but review session gone | `status = 'reviewing'` + review session archived/missing | Re-create review session |
| Worktree in use but task not running | WorktreePool slot has `taskId` but task is `failed`/`cancelled` | Release worktree slot |
| Agent was `active` but all tasks done | `phase = 'active'` + no pending/queued/running tasks | Transition to `idle` |
| Orphaned checkpoint session | Checkpoint session not archived | Archive it |

### Implementation

```typescript
export class StateRecovery {
  constructor(
    private db: Database.Database,
    private supervisorService: SupervisorV2Service,
    private taskRepo: SupervisionTaskRepository,
    private sessionRepo: SessionRepository,
    private projectRepo: ProjectRepository,
  ) {}

  async recover(): Promise<RecoveryReport> {
    const report: RecoveryReport = {
      tasksRecovered: 0,
      worktreesReleased: 0,
      sessionsArchived: 0,
      agentsTransitioned: 0,
    };

    // Get all projects with agents
    const projects = this.projectRepo.findAll().filter(p => p.agent);

    for (const project of projects) {
      // Recover running tasks
      const running = this.taskRepo.findByStatus(project.id, 'running');
      for (const task of running) {
        if (!this.isProviderRunActive(task.sessionId)) {
          await this.recoverStuckTask(task);
          report.tasksRecovered++;
        }
      }

      // Recover reviewing tasks
      const reviewing = this.taskRepo.findByStatus(project.id, 'reviewing');
      for (const task of reviewing) {
        const reviewSession = this.findReviewSession(task.id);
        if (!reviewSession || reviewSession.archivedAt) {
          await this.recreateReview(task);
          report.tasksRecovered++;
        }
      }

      // Release orphaned worktrees
      if (this.supervisorService.hasWorktreePool(project.id)) {
        const pool = this.supervisorService.getWorktreePool(project.id);
        const status = pool.getStatus();
        for (const slot of status.inUse) {
          if (slot.taskId) {
            const task = this.taskRepo.findById(slot.taskId);
            if (!task || ['failed', 'cancelled', 'integrated'].includes(task.status)) {
              pool.release(slot.path);
              report.worktreesReleased++;
            }
          }
        }
      }

      // Archive orphaned sessions
      const orphanedSessions = this.findOrphanedSupervisionSessions(project.id);
      for (const session of orphanedSessions) {
        this.sessionRepo.update(session.id, { archivedAt: Date.now() });
        report.sessionsArchived++;
      }

      // Check idle transition
      const activeTasks = this.taskRepo.findByStatus(
        project.id, 'pending', 'queued', 'running', 'reviewing'
      );
      if (activeTasks.length === 0 && project.agent!.phase === 'active') {
        this.supervisorService.updateAgentPhase(project.id, 'idle');
        report.agentsTransitioned++;
      }
    }

    return report;
  }

  private async recoverStuckTask(task: SupervisionTask): Promise<void> {
    if (task.attempt <= task.maxRetries + 1) {
      this.taskRepo.updateStatus(task.id, 'queued', {
        attempt: task.attempt + 1,
        result: {
          ...task.result,
          reviewNotes: 'Task was interrupted by service restart. Retrying.',
        },
      });
    } else {
      this.taskRepo.updateStatus(task.id, 'failed', {
        result: {
          ...task.result,
          reviewNotes: 'Task was interrupted by service restart and has no retries left.',
        },
      });
    }
  }
}
```

### Startup Integration

In `server/src/index.ts`, after DB init and service creation:

```typescript
const stateRecovery = new StateRecovery(db, supervisorV2, taskRepo, sessionRepo, projectRepo);
const report = await stateRecovery.recover();
if (report.tasksRecovered > 0 || report.worktreesReleased > 0) {
  console.log('[StateRecovery]', report);
}
```

---

## 4. Cost Control Enforcement

### Token Budget Tracking

Add cumulative token tracking to `SupervisorV2Service`:

```typescript
private getTokenUsage(projectId: string): number {
  const result = this.db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN m.metadata IS NOT NULL
        THEN json_extract(m.metadata, '$.usage.inputTokens') +
             json_extract(m.metadata, '$.usage.outputTokens')
        ELSE 0
      END
    ), 0) as total_tokens
    FROM messages m
    JOIN sessions s ON m.session_id = s.id
    WHERE s.project_id = ?
    AND s.project_role IS NOT NULL
  `).get(projectId) as { total_tokens: number };

  return result.total_tokens;
}
```

### Budget Check (in `tick()`)

```typescript
private checkBudgetLimits(projectId: string): boolean {
  const agent = this.getAgent(projectId)!;
  const config = agent.config;

  // Check task count limit
  if (config.maxTotalTasks) {
    const count = this.taskRepo.countByProject(projectId);
    if (count >= config.maxTotalTasks) {
      this.pauseAgent(projectId, 'budget');
      return false;
    }
  }

  // Check token budget
  if (config.maxTokenBudget) {
    const usage = this.getTokenUsage(projectId);
    if (usage >= config.maxTokenBudget) {
      this.pauseAgent(projectId, 'budget');
      return false;
    }
  }

  return true;
}
```

### Pause/Resume for Budget

```typescript
private pauseAgent(projectId: string, reason: 'user' | 'budget' | 'sync_error'): void {
  const project = this.projectRepo.findById(projectId)!;
  const agent = { ...project.agent! };
  agent.phase = 'paused';
  agent.pausedReason = reason;
  agent.pausedAt = Date.now();
  agent.updatedAt = Date.now();

  this.projectRepo.update(projectId, { agent });
  this.broadcastAgentUpdate(projectId, agent);
  this.log(projectId, 'phase_changed', { phase: 'paused', reason });
}
```

---

## 5. Main Session Overflow

### Detection

After each main session Provider run, check if context is approaching limits:

```typescript
async checkMainSessionOverflow(projectId: string): Promise<void> {
  const agent = this.getAgent(projectId);
  if (!agent?.mainSessionId) return;

  const messages = this.db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ?'
  ).get(agent.mainSessionId) as { count: number };

  // Heuristic: if message count exceeds threshold, rotate
  if (messages.count > 200) {
    await this.rotateMainSession(projectId);
  }
}
```

### Rotation

```typescript
async rotateMainSession(projectId: string): Promise<void> {
  const agent = this.getAgent(projectId)!;
  const oldSessionId = agent.mainSessionId;

  // Archive old main session
  if (oldSessionId) {
    this.sessionRepo.update(oldSessionId, { archivedAt: Date.now() });
  }

  // Create new main session
  const project = this.projectRepo.findById(projectId)!;
  const newSession = this.sessionRepo.create({
    projectId,
    name: 'Supervision Main',
    type: 'regular',
    projectRole: 'main',
    providerId: project.providerId,
    workingDirectory: project.rootPath,
  });

  // Update agent
  agent.mainSessionId = newSession.id;
  agent.updatedAt = Date.now();
  this.projectRepo.update(projectId, { agent });

  this.broadcastAgentUpdate(projectId, agent);
}
```

The new session auto-recovers context from `.supervision/` files on the next interaction.

---

## 6. Auto Task Discovery

When `autoDiscoverTasks` is enabled:

```typescript
async discoverTasks(projectId: string): Promise<void> {
  const agent = this.getAgent(projectId)!;
  if (!agent.config.autoDiscoverTasks) return;

  // Create a research session
  const session = this.sessionRepo.create({
    projectId,
    name: 'Task Discovery',
    type: 'background',
    projectRole: 'checkpoint',
    providerId: project.providerId,
  });

  const prompt = this.buildDiscoveryPrompt(projectId);
  this.triggerProviderRun(session, prompt);
}
```

Discovery is triggered during checkpoints (included in checkpoint prompt). Discovered tasks enter `proposed` state (unless `trustLevel == high`).

---

## 7. v1 Deprecation & Cleanup

### Migration `026_deprecate_supervision_v1`

```typescript
{
  name: '026_deprecate_supervision_v1',
  sql: `
    -- Move v1 supervisions data to archive (don't delete, in case rollback is needed)
    ALTER TABLE supervisions RENAME TO supervisions_v1_archived;
    ALTER TABLE supervision_logs RENAME TO supervision_logs_v1_archived;
  `
}
```

### Code Removal

| File | Action |
|------|--------|
| `server/src/services/supervisor-service.ts` | Delete (v1) |
| `server/src/routes/supervisions.ts` | Delete (v1 routes) |
| `server/src/__tests__/supervisor-service.test.ts` | Delete |
| `server/src/routes/__tests__/supervisions.test.ts` | Delete |
| `server/src/server.ts` | Remove v1 SupervisorService wiring |
| `shared/src/index.ts` | Remove v1 types: `Supervision`, `SupervisionSubtask`, `SupervisionStatus`, `SupervisionPlan`, `SupervisionLogEvent`, `SupervisionLog`, `SupervisionUpdateMessage` |
| `apps/desktop/src/stores/supervisionStore.ts` | Replace with v2 store |
| `apps/desktop/src/stores/__tests__/supervisionStore.test.ts` | Replace with v2 tests |

### Shared Types Cleanup

Remove from `shared/src/index.ts`:
- `SupervisionStatus`
- `SupervisionSubtask`
- `Supervision`
- `SupervisionPlan`
- `SupervisionLogEvent`
- `SupervisionLog`
- `SupervisionUpdateMessage`

Remove `SupervisionUpdateMessage` from the `ServerMessage` union (replaced by v2 message types).

---

## 8. Frontend Integration (Overview)

This section outlines the frontend changes needed. Detailed component specs are beyond the scope of this backend-focused doc.

### New Zustand Stores

| Store | Purpose |
|-------|---------|
| `supervisionV2Store.ts` | Agent state, task list, context documents |

### Key UI Components

| Component | Location | Description |
|-----------|----------|-------------|
| `SupervisionPanel` | Project settings or sidebar | Agent init, config, phase control |
| `TaskBoard` | Main content area | Task list with status badges, DAG visualization |
| `TaskDetail` | Drawer/modal | Task description, acceptance criteria, result, review notes |
| `ContextBrowser` | Tab/panel | Browse `.supervision/` documents |
| `CheckpointFeed` | Timeline | Checkpoint summaries and knowledge updates |

### WebSocket Message Handling

```typescript
// In messageHandler.ts
case 'supervision_task_update':
  supervisionV2Store.getState().updateTask(msg.task);
  break;
case 'supervision_agent_update':
  supervisionV2Store.getState().updateAgent(msg.projectId, msg.agent);
  break;
case 'supervision_checkpoint':
  supervisionV2Store.getState().addCheckpointSummary(msg.projectId, msg.summary);
  break;
```

---

## 9. File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `server/src/services/checkpoint-engine.ts` | Checkpoint evaluation and execution |
| `server/src/services/state-recovery.ts` | Startup state re-hydration |

### Modified Files

| File | Changes |
|------|---------|
| `server/src/services/supervisor-v2-service.ts` | Budget check, main session rotation, task discovery integration |
| `server/src/services/review-engine.ts` | Trigger checkpoint after successful review |
| `server/src/storage/db.ts` | Add migration `026_deprecate_supervision_v1` |
| `server/src/index.ts` | Wire StateRecovery, CheckpointEngine startup |
| `server/src/server.ts` | Remove v1 wiring |
| `shared/src/index.ts` | Remove v1 types |

### Deleted Files

| File | Reason |
|------|--------|
| `server/src/services/supervisor-service.ts` | v1 replaced |
| `server/src/routes/supervisions.ts` | v1 routes replaced |
| `server/src/__tests__/supervisor-service.test.ts` | v1 tests |
| `server/src/routes/__tests__/supervisions.test.ts` | v1 tests |

### No New Dependencies

Phase 4 uses existing libraries. `async-mutex` was already added in Phase 3.

---

## 10. Testing Strategy

### Unit Tests

| Test File | Covers |
|-----------|--------|
| `server/src/services/__tests__/checkpoint-engine.test.ts` | Trigger logic, checkpoint output parsing, knowledge updates |
| `server/src/services/__tests__/state-recovery.test.ts` | All recovery scenarios |

### Integration / E2E Tests

| Test | Scenario |
|------|----------|
| Checkpoint flow | Task completes → checkpoint triggers → knowledge updated → new tasks proposed |
| Budget pause | Token usage exceeds `maxTokenBudget` → agent pauses |
| Task count limit | `maxTotalTasks` exceeded → agent pauses |
| Service restart recovery | Kill server mid-task → restart → task re-queued |
| Main session rotation | 200+ messages → new main session created, old archived |
| v1 migration | Old v1 supervisions table renamed, v2 tables created |

### Key Scenarios

1. **Checkpoint parsing**: valid output, malformed output (graceful failure), empty knowledge updates
2. **Budget edge cases**: exactly at limit, over limit, no limit configured (unlimited)
3. **Recovery idempotence**: calling `recover()` twice produces same result
4. **Concurrent checkpoint prevention**: two triggers fire simultaneously → only one checkpoint runs
5. **Discovery → proposed flow**: discovered task respects `trustLevel` for status assignment

---

## 11. Acceptance Criteria

- [ ] CheckpointEngine triggers based on `workflow.yaml` config
- [ ] Checkpoint sessions run in isolation (not in main session)
- [ ] Knowledge updates applied to `.supervision/` files
- [ ] `project-summary.md` auto-updated after each checkpoint
- [ ] Discovered tasks enter `proposed` state (or `pending` if `trustLevel == high`)
- [ ] Service restart recovers stuck tasks (re-queue or fail)
- [ ] Orphaned worktrees released on startup
- [ ] `maxTotalTasks` and `maxTokenBudget` pause agent when exceeded
- [ ] Main session rotates when overflow detected
- [ ] v1 supervision code removed, old DB tables archived
- [ ] Checkpoint summary posted to main session for user visibility
- [ ] Auto task discovery works when `autoDiscoverTasks` enabled

---

## 12. Implementation Order Within Phase 4

1. **State Recovery** — critical for production safety, should be first
2. **Cost Control** — simple budget checks, build confidence
3. **CheckpointEngine** — core feature, depends on stable task pipeline
4. **Main Session Overflow** — quality-of-life, relatively independent
5. **Auto Task Discovery** — built on top of CheckpointEngine
6. **v1 Deprecation** — cleanup, do last to ensure v2 is stable
7. **Frontend Integration** — can be done in parallel with backend work
