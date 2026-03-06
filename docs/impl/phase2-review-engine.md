# Phase 2: AI Review Engine

> **Goal**: Replace manual review with independent AI review sessions. Implement structured summary parsing, deterministic objective evidence injection, and auto-retry on rejection.
>
> **Prerequisite**: Phase 1 completed.
>
> **Value delivered**: True autonomous task iteration — tasks run, get reviewed by an independent AI session, and retry automatically on rejection.

---

## 1. Overview

Phase 1 leaves the `reviewing` → `approved`/`rejected` transition to human API calls. Phase 2 automates this by:

1. Creating a temporary **review session** after task completion
2. Injecting **objective evidence** (git diff or snapshot diff) alongside the task's self-reported summary
3. Parsing the review session's structured verdict
4. Auto-retrying on rejection (with `reviewNotes` injection into the next attempt)
5. Auto-archiving review sessions after completion

---

## 2. ReviewEngine (`server/src/services/review-engine.ts`)

New file. Handles review session lifecycle.

### Public API

```typescript
export interface ReviewVerdict {
  approved: boolean;
  notes: string;
  suggestedChanges?: string[];
}

export class ReviewEngine {
  constructor(
    private db: Database.Database,
    private sessionRepo: SessionRepository,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private contextManager: ContextManager,
    private broadcastFn: (msg: ServerMessage) => void,
  ) {}

  // Create review session, inject context, trigger Provider run
  async createReview(task: SupervisionTask): Promise<void>;

  // Parse review session output → ReviewVerdict
  parseVerdict(sessionId: string): ReviewVerdict | null;

  // Handle review completion: approve/reject → update task, archive session
  async handleReviewComplete(task: SupervisionTask, verdict: ReviewVerdict): Promise<void>;
}
```

### Review Flow

```
Task run completes
    │
    ▼
TaskRunner.onTaskComplete()
    │
    ├── 1. Parse structured [TASK_RESULT] from session output
    ├── 2. Run workflow actions (onTaskComplete: test, lint)
    ├── 3. Auto-commit remaining changes
    ├── 4. Write result to .supervision/results/task-{id}.md
    ├── 5. Update task status → 'reviewing'
    │
    ▼
ReviewEngine.createReview(task)
    │
    ├── 1. Create review session (type: 'background', projectRole: 'review', taskId)
    ├── 2. Collect objective evidence:
    │       Git:     git diff <baseCommit>..HEAD
    │       Non-git: snapshot diff + hash delta
    ├── 3. Build review system prompt (see below)
    ├── 4. Trigger Provider run with review prompt
    │
    ▼
Review session completes
    │
    ├── ReviewEngine.parseVerdict(sessionId)
    │       Parse [REVIEW_VERDICT] block from output
    │
    ▼
ReviewEngine.handleReviewComplete(task, verdict)
    │
    ├── verdict.approved = true:
    │       task → 'approved' → 'integrated' (Phase 2, still serial)
    │       Write .supervision/results/task-{id}.review.md
    │       Archive review session
    │
    └── verdict.approved = false:
            task → 'rejected'
            if attempt <= maxRetries + 1:
                task.attempt++
                task → 'queued' (reviewNotes injected into next run)
            else:
                task → 'failed'
            Write .supervision/results/task-{id}.review.md
            Archive review session
```

---

## 3. Review System Prompt

```
[INDEPENDENT CODE REVIEW]

You are reviewing the output of an automated coding task. You must evaluate whether the task was completed correctly based on the acceptance criteria and the actual code changes.

CRITICAL: Do NOT trust the task's self-reported summary blindly. Base your review primarily on the OBJECTIVE EVIDENCE (diff) below.

== Task ==
Title: {task.title}
Description: {task.description}
Attempt: {task.attempt}

== Acceptance Criteria ==
{task.acceptanceCriteria, one per line}

== Task Self-Reported Summary ==
{task.result.summary}

== Workflow Action Results ==
{foreach task.result.workflowOutputs}
Action: {action}
Success: {success}
Output:
{output}
{endforeach}

== Objective Evidence (Code Diff) ==
```diff
{git diff <baseCommit>..HEAD OR snapshot diff}
```

== Instructions ==
Evaluate the changes against the acceptance criteria. Consider:
1. Do the code changes actually implement what the task requires?
2. Did all workflow actions (tests, lint) pass?
3. Are there any obvious bugs, regressions, or missing pieces?
4. Is the code quality acceptable?

Output your verdict in this exact format:

[REVIEW_VERDICT]
approved: true/false
notes: |
  <your detailed review notes>
suggested_changes:
  - <suggestion 1 if rejected>
  - <suggestion 2 if rejected>
[/REVIEW_VERDICT]
```

---

## 4. TaskRunner Enhancement (`server/src/services/task-runner.ts`)

Extracted from `supervisor-v2-service.ts` in Phase 1, or added as new methods.

### `onTaskComplete(task, sessionId)`

Called when a Provider run finishes for a task session.

```typescript
async onTaskComplete(task: SupervisionTask, sessionId: string): Promise<void> {
  const project = this.projectRepo.findById(task.projectId)!;
  const cwd = project.rootPath!;

  // 1. Parse [TASK_RESULT] from session messages
  const result = this.parseTaskResult(sessionId);

  // 2. Execute workflow actions (onTaskComplete)
  const workflow = this.contextManager.getWorkflow();
  const workflowOutputs = await this.executeWorkflowActions(
    workflow.onTaskComplete,
    cwd,
  );
  if (result) {
    result.workflowOutputs = workflowOutputs;
  }

  // 3. Auto-commit remaining changes (git only)
  if (await this.isGitRepo(cwd)) {
    await this.autoCommitRemainingChanges(cwd, task.id);
  }

  // 4. Write result to .supervision/results/task-{id}.md
  this.contextManager.writeTaskResult(task.id, this.formatTaskResult(result));

  // 5. Update task
  this.taskRepo.updateStatus(task.id, 'reviewing', { result });

  // 6. Trigger review
  await this.reviewEngine.createReview(
    this.taskRepo.findById(task.id)!,
  );
}
```

### `parseTaskResult(sessionId)`

Reads recent assistant messages and extracts the `[TASK_RESULT]...[/TASK_RESULT]` block.

```typescript
parseTaskResult(sessionId: string): TaskResult | null {
  const messages = this.db.prepare(`
    SELECT content FROM messages
    WHERE session_id = ? AND role = 'assistant'
    ORDER BY created_at DESC LIMIT 5
  `).all(sessionId) as { content: string }[];

  const combined = messages.map(m => m.content).join('\n');
  const match = combined.match(/\[TASK_RESULT\]([\s\S]*?)\[\/TASK_RESULT\]/);
  if (!match) return null;

  // Parse the YAML-like content
  const lines = match[1].trim().split('\n');
  const result: TaskResult = { summary: '', filesChanged: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- summary:')) {
      result.summary = trimmed.replace('- summary:', '').trim();
    } else if (trimmed.startsWith('- files_changed:')) {
      result.filesChanged = trimmed.replace('- files_changed:', '').trim().split(',').map(f => f.trim());
    }
  }

  return result;
}
```

### `executeWorkflowActions(actions, cwd)`

```typescript
async executeWorkflowActions(
  actions: WorkflowAction[],
  cwd: string,
): Promise<Array<{ action: string; output: string; success: boolean }>> {
  const results = [];

  for (const action of actions) {
    if (action.type === 'run_command' && action.command) {
      try {
        const { stdout, stderr } = await execAsync(action.command, { cwd, timeout: 120_000 });
        results.push({
          action: action.description || action.command,
          output: (stdout + stderr).slice(0, 10_000),
          success: true,
        });
      } catch (err: any) {
        results.push({
          action: action.description || action.command,
          output: (err.stdout + err.stderr).slice(0, 10_000),
          success: false,
        });
      }
    }
  }

  return results;
}
```

### `autoCommitRemainingChanges(cwd, taskId)`

```typescript
async autoCommitRemainingChanges(cwd: string, taskId: string): Promise<void> {
  const { stdout } = await execAsync('git status --porcelain', { cwd });
  if (!stdout.trim()) return;

  await execAsync('git add -A', { cwd });
  await execAsync(
    `git commit -m "chore(supervision): auto-commit remaining changes for task ${taskId}"`,
    { cwd },
  );
}
```

---

## 5. Objective Evidence Collection

### Git Projects

```typescript
async collectGitEvidence(cwd: string, baseCommit: string): Promise<string> {
  const { stdout } = await execAsync(
    `git diff ${baseCommit}..HEAD`,
    { cwd, maxBuffer: 1024 * 1024 },
  );
  // Truncate if too large
  if (stdout.length > 50_000) {
    return stdout.slice(0, 50_000) + '\n\n[... diff truncated at 50KB ...]';
  }
  return stdout;
}
```

### Non-Git Projects (Deferred)

For Phase 2, non-git projects use a simplified approach:
- Capture `find . -newer <timestamp_file> -type f` to list changed files
- Include the content of changed files (truncated)
- Full snapshot-based diff is deferred to Phase 4

---

## 6. Verdict Parsing

```typescript
parseVerdict(sessionId: string): ReviewVerdict | null {
  const messages = this.db.prepare(`
    SELECT content FROM messages
    WHERE session_id = ? AND role = 'assistant'
    ORDER BY created_at DESC LIMIT 3
  `).all(sessionId) as { content: string }[];

  const combined = messages.map(m => m.content).join('\n');
  const match = combined.match(/\[REVIEW_VERDICT\]([\s\S]*?)\[\/REVIEW_VERDICT\]/);
  if (!match) return null;

  const block = match[1].trim();
  const approved = /approved:\s*true/i.test(block);

  const notesMatch = block.match(/notes:\s*\|?\s*\n([\s\S]*?)(?=suggested_changes:|$)/);
  const notes = notesMatch ? notesMatch[1].trim() : '';

  const suggestionsMatch = block.match(/suggested_changes:\s*\n([\s\S]*?)$/);
  const suggestedChanges = suggestionsMatch
    ? suggestionsMatch[1].split('\n')
        .map(l => l.trim().replace(/^-\s*/, ''))
        .filter(Boolean)
    : undefined;

  return { approved, notes, suggestedChanges };
}
```

---

## 7. Review Session Auto-Archive

After verdict is parsed and task status updated:

```typescript
async archiveReviewSession(sessionId: string): Promise<void> {
  this.sessionRepo.update(sessionId, { archivedAt: Date.now() });
}
```

Archived sessions are retained in DB for audit but hidden from active session lists (existing `archivedAt` filtering in the frontend sidebar).

---

## 8. Changes to SupervisorV2Service

### Modified Methods

**`tick()`** — after a task's run completes, instead of setting `reviewing` and waiting for manual API call, it now automatically calls `taskRunner.onTaskComplete()`.

**Listen for run completion** — register a callback in `handleRunMessage` for task sessions:

```typescript
// In server.ts or supervisor-v2-service.ts
onRunCompleted(sessionId: string): void {
  const session = this.sessionRepo.findById(sessionId);
  if (!session?.taskId || session.projectRole !== 'task') return;

  const task = this.taskRepo.findById(session.taskId);
  if (!task || task.status !== 'running') return;

  // Trigger the review pipeline
  this.taskRunner.onTaskComplete(task, sessionId);
}

onRunFailed(sessionId: string, error: string): void {
  const session = this.sessionRepo.findById(sessionId);
  if (!session?.taskId || session.projectRole !== 'task') return;

  const task = this.taskRepo.findById(session.taskId);
  if (!task || task.status !== 'running') return;

  // Mark task as failed directly (no review needed for runtime errors)
  this.taskRepo.updateStatus(task.id, 'failed', {
    result: { summary: `Run failed: ${error}`, filesChanged: [] },
  });
}
```

### TrustLevel Behavior for Reviews

| TrustLevel | Review Behavior |
|------------|----------------|
| `low` | AI review runs, but result requires user confirmation before applying |
| `medium` | AI review runs and auto-applies (approve → integrated, reject → retry) |
| `high` | Same as medium (fully automatic) |

For `low` trust: after AI review verdict is parsed, task moves to a `reviewing` state with the verdict attached, and waits for user to call `approveTaskResult` / `rejectTaskResult`. The manual review API from Phase 1 still works.

---

## 9. File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `server/src/services/review-engine.ts` | Review session creation, evidence collection, verdict parsing |
| `server/src/services/task-runner.ts` | Task completion handling, workflow actions, auto-commit |

### Modified Files

| File | Changes |
|------|---------|
| `server/src/services/supervisor-v2-service.ts` | Wire ReviewEngine, listen for run completion, TrustLevel routing |
| `server/src/services/context-manager.ts` | Add `writeTaskResult`, `writeReviewResult` |
| `server/src/server.ts` | Add run_completed/run_failed hooks for task sessions |

### No New Dependencies

Phase 2 uses `child_process.exec` for git commands and workflow action execution — no new npm packages required.

---

## 10. Testing Strategy

### Unit Tests

| Test File | Covers |
|-----------|--------|
| `server/src/services/__tests__/review-engine.test.ts` | Verdict parsing, evidence collection, session creation |
| `server/src/services/__tests__/task-runner.test.ts` | Result parsing, workflow execution, auto-commit |

### Key Test Scenarios

1. **Verdict parsing**: valid approved, valid rejected, missing block, malformed block
2. **Evidence truncation**: large diffs truncated at 50KB
3. **Auto-commit**: uncommitted changes → committed, clean state → no-op
4. **Workflow action failure**: test command fails → captured in `workflowOutputs`, review still proceeds
5. **Retry flow**: rejected → attempt increments → re-queued with `reviewNotes` → next run includes notes
6. **Max retries exceeded**: `attempt > maxRetries + 1` → `failed`
7. **TrustLevel low**: AI review verdict stored but not auto-applied; manual confirmation required
8. **Review session archived**: session gets `archivedAt` after verdict processing

---

## 11. Acceptance Criteria

- [ ] Task completion triggers automatic review (no manual API call needed for `medium`/`high` trust)
- [ ] Review session receives objective git diff evidence
- [ ] Review verdict correctly parsed from `[REVIEW_VERDICT]` block
- [ ] Approved tasks transition to `integrated` (serial mode)
- [ ] Rejected tasks retry with `reviewNotes` injected
- [ ] Max retries exceeded → task `failed`
- [ ] Workflow actions (test, lint) run before review and results included in review context
- [ ] Remaining uncommitted changes auto-committed before review
- [ ] Review sessions auto-archived after completion
- [ ] `low` trust level still requires manual confirmation after AI review
- [ ] Result files written to `.supervision/results/`
