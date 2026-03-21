# Agent Assistant v3 — Phase 2 Implementation Plan

## Overview

Phase 2 目标：建立 TaskOrchestrator 编排层，先承载 agent task 的排队/依赖/等待能力，并为 Phase 3 合并现有 scheduler 做准备。

**策略**：Phase 2 明确 ownership 边界。

- TaskOrchestrator 只负责 `kind='agent'` 的任务
- 现有 `SupervisorService` / `WorkflowService` / `ScheduledTaskService` 继续保持各自 ticker
- Phase 2 不让 TaskOrchestrator 反向委托现有 service tickers，避免重复调度
- 对 Supervision 仅做最小接入点改造，补明确事件，再同步到 `orchestrator_tasks`

这样可以降低风险，保留现有测试和路由。

---

## 当前状态

三个独立 ticker 并行运行：

| Service | Ticker | Interval | 注册位置 |
|---|---|---|---|
| SupervisorService | `supervisorService.start(5000)` | 5s | `domains/supervision/register.ts` |
| WorkflowService | `setInterval(tick, 10000)` | 10s | `domains/workflows/register.ts` |
| ScheduledTaskService | `setInterval(tick, 10000)` | 10s | `domains/scheduled-tasks/register.ts` |

耦合度很低，各自 domain 隔离，无交叉 import。

---

## 依赖关系

```
Step 1 (类型 + TaskOrchestrator 接口)
    │
    ├──→ Step 2 (orchestrator_tasks 表 + repository)
    │
    ├──→ Step 3 (TaskOrchestrator 实现 + 统一 ticker)
    │        │
    │        └──→ Step 5 (Agent 编排工具: spawn_task 等)
    │
    └──→ Step 4 (Supervisor adapter + 显式事件接入)

Step 6 (Context Engine supervision 模板) — 可并行
```

---

## Step 1: 类型定义 + TaskOrchestrator 接口

**新建** `server/src/orchestration/types.ts`

```ts
export type TaskKind = 'agent' | 'supervision' | 'workflow' | 'scheduled';
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface OrchestratorTask {
  id: string;
  parentTaskId: string | null;
  rootTaskId: string | null;
  projectId: string | null;
  sessionId: string | null;
  kind: TaskKind;
  contextTemplate: string;
  status: TaskStatus;
  task: string;                    // 任务描述
  scheduleType?: string;
  scheduleConfig?: string;
  dependsOn?: string[];
  providerId?: string;
  retryCount: number;
  maxRetries: number;
  resultSummary?: string;
  errorSummary?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface SpawnTaskConfig {
  task: string;
  projectId?: string;
  providerId?: string;
  contextTemplate?: string;
  tools?: string[];
  worktree?: boolean;
  checkpoint?: boolean;
  maxTurns?: number;
  schedule?: {
    type: 'cron' | 'interval' | 'once';
    cron?: string;
    intervalMinutes?: number;
    onceAt?: number;
  };
  dependsOn?: string[];
}

export interface TaskResult {
  taskId: string;
  status: 'completed' | 'failed';
  summary?: string;
  artifact?: string;
  error?: string;
}

export interface ExternalTaskSync {
  externalId: string;
  kind: Exclude<TaskKind, 'agent'>;
  projectId: string | null;
  sessionId?: string | null;
  parentTaskId?: string | null;
  rootTaskId?: string | null;
  status: TaskStatus;
  task: string;
  resultSummary?: string;
  errorSummary?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskOrchestrator {
  // 核心操作
  spawnTask(parentId: string | null, config: SpawnTaskConfig): Promise<string>;
  steerTask(taskId: string, instruction: string): Promise<void>;
  killTask(taskId: string): Promise<void>;
  getTaskResult(taskId: string): Promise<TaskResult>;
  waitForTask(taskId: string, timeoutMs?: number): Promise<TaskResult>;
  listTasks(parentId?: string): OrchestratorTask[];
  syncExternalTask(task: ExternalTaskSync): Promise<void>;

  // 调度
  tick(): Promise<void>;

  // 管理
  start(intervalMs?: number): void;
  stop(): void;
}
```

---

## Step 2: orchestrator_tasks 表 + Repository

**DB Migration** `045_orchestrator_tasks`

```sql
CREATE TABLE orchestrator_tasks (
  id TEXT PRIMARY KEY,
  parent_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
  root_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  context_template TEXT NOT NULL DEFAULT 'coding',
  status TEXT NOT NULL DEFAULT 'queued',
  task TEXT NOT NULL,
  schedule_type TEXT,
  schedule_config TEXT,
  depends_on TEXT,
  provider_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 0,
  result_summary TEXT,
  error_summary TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_orch_tasks_project ON orchestrator_tasks(project_id);
CREATE INDEX idx_orch_tasks_status ON orchestrator_tasks(status);
CREATE INDEX idx_orch_tasks_parent ON orchestrator_tasks(parent_task_id);
```

**新建** `server/src/orchestration/repository.ts`

基础 CRUD：create / update / findByStatus / findByParent / findById / findByExternalRef。

额外建议字段：

```sql
ALTER TABLE orchestrator_tasks ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_orch_tasks_external
  ON orchestrator_tasks(kind, external_id)
  WHERE external_id IS NOT NULL;
```

说明：

- `waiting` 明确表示“依赖未满足，不可执行”
- `queued` 明确表示“依赖已满足，等待 runner 拉取”
- `external_id` 用于 Supervision/Workflow/Scheduled Task 的镜像同步，避免重复插入

---

## Step 3: TaskOrchestrator 实现 + 统一 Ticker

**新建** `server/src/orchestration/task-orchestrator.ts`

核心逻辑：

```ts
class TaskOrchestratorImpl implements TaskOrchestrator {
  private interval: NodeJS.Timeout | null = null;
  private waiters = new Map<string, Set<(result: TaskResult) => void>>();

  async spawnTask(parentId, config): Promise<string> {
    // 1. 创建 orchestrator_tasks 记录
    // 2. 如果是 agent 类型：创建 background session + 调 handleRunStart
    // 3. 如果有 schedule：记录调度配置，等 tick 触发
    // 4. 如果有 dependsOn：标记为 waiting，等依赖完成后转 queued
    // 5. 否则立即执行
  }

  async tick(): Promise<void> {
    // 1. 检查 agent task 的 schedule（cron/interval/once 到期）
    // 2. 检查 waiting -> queued（dependsOn 的所有任务已完成）
    // 3. 检查超时任务 / 卡死任务
    // 4. 拉起当前可执行的 agent task
  }

  start(intervalMs = 10000): void {
    this.interval = setInterval(() => this.tick(), intervalMs);
  }
}
```

**Phase 2 的 ticker ownership**：在 `server-setup.ts` 中新增一个 TaskOrchestrator ticker，但它只处理 agent task。现有三个 service 的 ticker 继续各管各的，不做委托，不做替代。

```ts
// 新增：只负责 orchestrator(kind='agent')
const orchestrator = createTaskOrchestrator({ db, handleRunStart, ... });
orchestrator.start(10000);

// 现有 service tickers 原样保留；Phase 3 再统一 ownership
```

---

## Step 4: Supervisor Adapter

**目的**：让 SupervisorService 的任务也记录到 orchestrator_tasks，为后续 Phase 3 合并做准备。

**方式**：先补明确的 supervision 领域事件，再监听这些事件，同步写入 orchestrator_tasks。

```ts
// 1. 在 SupervisorService 内部的任务创建/状态变更点 emit 明确事件
await pluginEvents.emit('supervision.task_created', {
  taskId,
  projectId,
  title,
  status: 'queued',
  createdAt,
});

await pluginEvents.emit('supervision.task_updated', {
  taskId,
  projectId,
  status,
  startedAt,
  completedAt,
  resultSummary,
  errorSummary,
});

// 2. 在 register.ts 中监听并同步
pluginEvents.on('supervision.task_created', (event) => {
  orchestrator.syncExternalTask({
    externalId: event.taskId,
    kind: 'supervision',
    projectId: event.projectId,
    status: 'queued',
    task: event.title,
    createdAt: event.createdAt,
  });
});
```

**注意**：这里不是“零改动接入”。需要在 `SupervisorService` 中补最小事件发射点，但不改变其调度状态机和数据源。

---

## Step 5: Agent 编排工具

在 `server/src/agent-tools/` 新增 task 编排工具，注册到 toolRegistry：

| 工具 | 行为 |
|---|---|
| `spawn_task` | 调 `orchestrator.spawnTask()`，创建子任务。`wait: true` 时阻塞到完成 |
| `steer_task` | 调 `orchestrator.steerTask()`，向运行中任务注入指令 |
| `kill_task` | 调 `orchestrator.killTask()` |
| `list_tasks` | 调 `orchestrator.listTasks()` |
| `get_task_result` | 默认调 `orchestrator.getTaskResult()`；`wait: true` 时调 `orchestrator.waitForTask()` |

这些工具 scope = `['agent-assistant']`，只在 agent session 中可见。

**`spawn_task` 的 `wait: true` 实现**：

```ts
if (args.wait) {
  const result = await orchestrator.waitForTask(taskId, 10 * 60 * 1000);
  return JSON.stringify(result);
}
```

`waitForTask()` 由 orchestrator 内部维护一次性 waiter map，并在任务 settle 后自动清理；不要把长生命周期 callback 暴露给 tool handler。

---

## Step 6: Context Engine supervision 模板

在 `server/src/context/engine.ts` 新增 `supervision` 模板：

```ts
function assembleSupervisionTemplate(input: AssemblyInput): string {
  return [
    SUPERVISION_SYSTEM_PROMPT,   // Supervisor 角色 prompt
    input.workspacePrompt,
    input.memoryContext,
    input.sessionSystemPrompt,   // task-specific context
  ].filter(Boolean).join('\n\n');
}
```

在 `ContextTemplate` 类型中加 `'supervision'`。

同时补 `AssemblyInput.memoryContext?: string`，避免模板和类型定义脱节。

---

## 实施顺序

| Step | 内容 | 依赖 | 预估 |
|---|---|---|---|
| 1 | 类型 + 接口 | 无 | 0.5 天 |
| 2 | orchestrator_tasks 表 + repository | Step 1 | 1 天 |
| 3 | TaskOrchestrator 实现 + 统一 ticker | Step 1+2 | 2-3 天 |
| 4 | Supervisor adapter（事件同步） | Step 3 | 1 天 |
| 5 | Agent 编排工具 | Step 3 | 1-2 天 |
| 6 | Context Engine supervision 模板 | Step 1 | 0.5 天 |

**总计约 6-8 天**。Step 4 和 6 可与 Step 3 并行。

---

## 验证标准

1. TaskOrchestrator ticker 只处理 agent task，不会重复触发现有 supervision/workflow/scheduled-task ticker
2. Agent session 中可以调用 `spawn_task` 创建子任务
3. 有依赖的子任务先落为 `waiting`，依赖满足后才进入 `queued`
4. 子任务创建 background session 并执行
5. `spawn_task(wait: true)` / `get_task_result(wait: true)` 阻塞直到子任务完成或超时
6. Supervisor task 生命周期事件可以镜像到 orchestrator_tasks
7. `list_tasks` 返回当前任务树
8. orchestrator_tasks 表记录所有 agent 创建的任务，以及已接入的 supervision 镜像任务
9. 现有所有测试通过

---

## 风险和缓解

| 风险 | 缓解 |
|---|---|
| 统一 ticker 影响现有调度 | Phase 2 不合并 ownership；TaskOrchestrator 只管 agent task，不委托现有 service tickers |
| spawn_task 的 wait: true 死锁 | 加超时（默认 10 分钟），超时返回 failed |
| orchestrator_tasks 与 supervision_tasks 数据不一致 | Phase 2 只做事件同步（单向），并用 `kind + external_id` 做幂等 upsert |
| 子任务太多导致资源耗尽 | maxConcurrentTasks 限制（默认 3） |
