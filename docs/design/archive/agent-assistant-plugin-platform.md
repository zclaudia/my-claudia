# Agent Assistant 系统设计方案（v3 — PCP + TaskOrchestrator）

> **状态**: 设计完成，待实施
> **更新**: 2026-03-21
> **前序**: v2 参考 OpenClaw 设计，v3 在 PCP 协议和 Supervision 合并基础上重新定位

---

## Context

### v2 → v3 关键决策

经过讨论，v2 的以下假设已调整：

| v2 假设 | v3 结论 | 原因 |
|---------|---------|------|
| 直接调 Anthropic API | **复用 PCP provider** | PCP `tool.inject` 已解决自定义工具注入问题，不需要自建 tool-call loop |
| 独立 `AgentRuntime` | **复用 `ProviderAdapter.run()`** | 不需要用户额外配置 API key，自动支持所有 provider |
| 独立 `AgentManager` | **合并为 `TaskOrchestrator`** | 与 Supervision v2 的编排能力重叠，底层应共享 |
| 自建 Context Engine | **先定义接口 + 固定模板** | Context Engine 定位为 system prompt 内容管理器，与注入机制正交 |

### 背景（延续 v2）

当前 my-claudia 的 agent 执行完全依赖外部 provider CLI（Claude Code、OpenCode 等），我们只做消息转发和权限控制。

Agent Assistant 的目标是在**不改动现有 provider coding 体系**的前提下，赋予系统：

- **自主任务分解**：通过 TaskOrchestrator 的 spawn/steer/kill
- **自定义工具**：通过 PCP `tool.inject` 注入 agent 专属工具集
- **动态技能加载**：Skills（Markdown prompt 包）
- **可插拔上下文管理**：Context Engine slot 系统

### 现有代码库存

当前已有一套**客户端侧 meta-agent** 实现，以 OpenAI-compatible API 为执行引擎，在浏览器中跑 tool-call loop：

| 模块 | 文件 | 说明 |
|---|---|---|
| **Agent Loop** | `apps/desktop/src/services/agentLoop.ts` | 客户端 tool-call loop，调 OpenAI-compatible API |
| **Agent Tools** | `apps/desktop/src/services/agentTools.ts` | 工具定义（管理 project/session/search），支持多 backend 路由 |
| **Agent Storage** | `apps/desktop/src/services/agentStorage.ts` | IndexedDB 持久化对话消息 |
| **Client AI** | `apps/desktop/src/services/clientAI.ts` | OpenAI-compatible API 调用和流式解析 |
| **Agent Panel** | `apps/desktop/src/components/agent/AgentPanel.tsx` | 侧边面板 UI（消息列表 + 输入） |
| **Agent Side Panel** | `apps/desktop/src/components/agent/AgentSidePanel.tsx` | 可拖拽宽度的面板容器 |
| **Agent Store** | `apps/desktop/src/stores/agentStore.ts` | UI 状态（展开/未读/加载中） |
| **Agent Config Route** | `server/src/routes/agent.ts` | 服务端配置 API（GET/PUT /api/agent/config） |
| **Permission Evaluator** | `server/src/agent/permission-evaluator.ts` | 信任级别权限评估（conservative → full_trust） |
| **Tool Registry Scope** | `server/src/plugins/tool-registry.ts` | 已有 `'agent-assistant'` scope 支持 |
| **DB Schema** | `server/src/storage/db.ts` | `agent_config` 表（migration 012-016），项目级 `agent_permission_override` |
| **Plugins** | `plugins/{echo,timer,note-keeper,weather}/` | 多个插件已声明 `scope: ['agent-assistant']` |
| **E2E Tests** | `e2e/tests/agent-assistant.spec.ts` | Agent bubble/panel 可见性和配置测试 |

**当前问题**：

1. 依赖外部 OpenAI-compatible API（需要用户额外配置 key + endpoint）
2. Tool-call loop 跑在客户端（受浏览器环境限制，不能执行 shell/文件等重操作）
3. 工具能力弱（只能管理 project/session/search，不能执行代码修改）
4. 消息存 IndexedDB（与服务端 session 体系割裂）

### 迁移路径

v3 需要把执行引擎从客户端迁到服务端，复用 PCP provider：

| 现有组件 | 迁移方式 |
|---|---|
| `agentLoop.ts`（客户端 tool-call loop） | **废弃** → 改为发 `agent_start` 消息给服务端，服务端通过 PCP provider 执行 |
| `clientAI.ts`（OpenAI API 调用） | **废弃** → 不再需要用户配置外部 API |
| `agentTools.ts`（客户端工具定义） | **迁移到服务端** → 注册到 `toolRegistry`（scope: `agent-assistant`），通过 MCP bridge 注入 |
| `agentStorage.ts`（IndexedDB） | **废弃** → 改用服务端 `sessions` + `messages` 表，agent session 类型为 `'agent'` |
| `AgentPanel.tsx`（UI） | **保留 + 适配** → 从客户端 loop 回调改为消费 WebSocket message handler 的统一事件流 |
| `AgentSidePanel.tsx`（容器） | **保留** → 不变 |
| `agentStore.ts`（UI 状态） | **保留 + 扩展** → 追加 agent session 管理状态 |
| `agent.ts`（配置 route） | **保留 + 扩展** → 可能扩展 agent 模式配置 |
| `permission-evaluator.ts` | **保留** → 直接复用 |
| `agent_config` 表 | **保留** → 扩展字段（context 模板选择等） |
| `toolRegistry` agent-assistant scope | **保留** → agent 工具注册到此 scope |
| 已有 agent-assistant 插件 | **保留** → 自动在 agent mode 可用 |

**关键原则**：UI 层（AgentPanel）和配置层（agent_config、permission）保留复用，执行层（agentLoop、clientAI、agentStorage）从客户端迁到服务端。

---

## 架构总览

### 核心认知：Supervisor = Project-level Agent Assistant

现有的 `SupervisorService` 本质上是一个配了特定角色和工具的 project-level Agent Assistant 实例。它不应该是一个独立系统，而是 Agent Assistant Runtime + supervision 预设配置。

```
Agent Assistant Runtime（通用 runtime）
    │
    ├── Global Agent（现有 meta-agent 的演进）
    │   - scope: global（跨 project）
    │   - context template: 'agent'
    │   - tools: project 管理, session 管理, search, memory, spawn_task
    │   - 用途: 跨项目管理、用户偏好、全局编排、Memory 定期摘要
    │
    └── Project Agent（现有 Supervisor 的演进）
        - scope: project
        - context template: 'supervision'
        - tools: git, worktree, code-review, spawn_task, memory
        - 用途: 项目内代码任务管理
        - 预设 workflow: plan→execute→review→merge
```

### 系统全景

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Trigger Layer（触发层）                             │
│   cron │ interval │ event │ manual │ workflow step                      │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────────────┐
│                     server.ts (Message Router)                           │
│                                                                          │
│  ┌── run_start ───┐  ┌── agent_start ──┐  ┌── trigger ───────────────┐ │
│  │ Coding Mode     │  │ Global Agent    │  │ Scheduled / Event       │ │
│  │ (用户编码)       │  │ (跨项目管理)    │  │ (定时/事件触发)          │ │
│  └──────┬──────────┘  └──────┬──────────┘  └──────┬──────────────────┘ │
│         │                    │                     │                     │
│  ┌──────┴────────────────────┴─────────────────────┴──────────────────┐ │
│  │                    Agent Assistant Runtime                         │ │
│  │                                                                    │ │
│  │  PCP Provider + Context Engine + tool.inject + Memory              │ │
│  │                         │                                          │ │
│  │              ┌──────────┴──────────┐                               │ │
│  │              │  TaskOrchestrator   │                               │ │
│  │              │  + Session 管理     │                               │ │
│  │              │  + WorktreePool     │                               │ │
│  │              │  + Checkpoint       │                               │ │
│  │              └─────────────────────┘                               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  共享基础设施：agent_memory │ agent_activity_log │ orchestrator_tasks │ sessions │ messages │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键区别**：Coding Mode、Global Agent、Project Agent 都通过 PCP provider 执行，区别在于注入的工具集��� Context Engine 模板不同。Supervisor 不再是独立系统，而是 Project Agent 的一种预设。

### Global Agent 与 Project Agent 的协作

两者**不直接通信**，通过共享基础设施协作（符合 PCP 的 hub-and-spoke 模型）：

| 场景 | 怎么做 | 谁发起 |
|---|---|---|
| Global Agent 查所有项目状态 | 读 DB（projects + supervision_tasks） | Global Agent 的工具 |
| Global Agent 给某项目派任务 | `TaskOrchestrator.spawnTask(projectId, ...)` | Global Agent 的 `spawn_task` 工具 |
| Project Agent 发现全局偏好 | 提交 global memory 候选项，由 Global Agent / 定时摘要任务确认写入 | Project Agent 的 `memory` 工具 |
| 跨项目配置同步 | Global Agent spawn 多个 project-level task | Global Agent |
| Memory 定期摘要 | 读所有 project 的 activity_log | TaskOrchestrator 定时触发 |

**数据边界**：

| 操作 | Global Agent | Project Agent |
|---|---|---|
| 读 global memory | ✅ | ✅ |
| 写 global memory | ✅ | ❌ |
| 读/写本项目 memory | ✅ | ✅ |
| 读其他项目 memory | ✅ | ❌ |
| 操作其他项目 | 通过 spawn_task 间接 | ❌ |

**约束**：

- Global memory 是跨项目共享输入，只有 Global Agent 和受信任的系统任务（如定期摘要）可以写入
- Project Agent 只能写本项目 memory；如果发现值得提升为全局偏好的信息，只能写入候选项或通过任务上报给 Global Agent
- Context Engine 注入 global memory 时，必须带来源元数据（who/when/why），避免“黑盒偏好”污染所有后续 session

---

## 1. 执行引擎（复用 PCP Provider）

### 不再自建 tool-call loop

v2 设计了独立的 `AgentRuntime` 类直接调 Anthropic API。v3 不需要 — PCP `tool.inject` capability 让我们可以向任何 provider 注入自定义工具。

**Agent Mode 的执行流程**：

```
agent_start 消息
    │
    ▼
选择 PCP provider（用户配置或默认）
    │
    ▼
Context Engine 组装 agent 模板 system prompt
    │
    ▼
注入 agent 工具集（shell, http, memory, sub-agent 等）
    │
    ▼
provider.run()（复用现有 adapter）
    │
    ▼
provider 通过 MCP bridge 调用 agent 工具
    │
    ▼
run 事件流复用现有 DeltaMessage / ToolUseMessage 等
```

### 好处

- 不需要用户额外配置 API key（复用 provider CLI 的 auth）
- 自动支持所有 PCP provider（不只 Claude）
- 复用权限评估、trace、session、message persistence 等现有基础设施
- 前端不需要新消息类型，复用现有渲染逻辑

### 后续扩展

如果未来需要自建 agent runtime（直接调 API），可以在 PCP 基础上新增一种 `runtime: 'sdk'` 的 provider 类型，不影响上层。

---

## 2. TaskOrchestrator（统一编排层）

### 问题

当前有三套编排/调度机制并行运行：

| 系统 | 现有实现 | 调度方式 | Scope |
|---|---|---|---|
| **Supervisor** | `SupervisorService` + `TaskRunner` + `ReviewEngine` | 5s ticker + 状态机 | Project |
| **Workflow** | `WorkflowService` + `WorkflowEngine` | 10s ticker + DAG 执行 | Project |
| **Scheduled Task** | `ScheduledTaskService` | 10s ticker + cron/interval | Project + Global |

三者的核心循环本质一样：检查触发条件 → spawn session → 执行 → 收集结果。Supervisor 就是一个 project-level Agent Assistant，不应该是独立系统。

### 方案

统一为 `TaskOrchestrator`，三个 ticker 合一，上层通过不同编排模式使用：

**文件**: `server/src/orchestration/task-orchestrator.ts`

```typescript
interface TaskOrchestrator {
  // 核心操作
  spawnTask(parentId: string | null, config: SpawnTaskConfig): Promise<string>;
  steerTask(taskId: string, instruction: string): Promise<void>;
  killTask(taskId: string): Promise<void>;
  getTaskResult(taskId: string): Promise<TaskResult>;
  listTasks(parentId?: string): TaskInfo[];

  // 调度
  tick(): Promise<void>;  // 统一 ticker，替代现有三个独立 ticker

  // 生命周期
  onTaskCompleted(taskId: string, callback: (result: TaskResult) => void): void;
  onTaskFailed(taskId: string, callback: (error: Error) => void): void;
}

interface SpawnTaskConfig {
  task: string;                  // 任务描述
  projectId?: string;            // NULL = global task
  providerId?: string;           // PCP provider（可选，默认继承父任务）
  contextTemplate?: string;      // Context Engine 模板（'coding' | 'agent' | 'supervision' | 'review' | ...）
  tools?: string[];              // 额外注入的工具集
  worktree?: boolean;            // 是否使用 git worktree 隔离
  checkpoint?: boolean;          // 是否启用 checkpoint
  maxTurns?: number;             // 安全上限
  // 调度配置（可选）
  schedule?: {
    type: 'cron' | 'interval' | 'once';
    cron?: string;
    intervalMinutes?: number;
    onceAt?: number;
  };
}
```

### 任务状态真相源

`sessions` / `messages` 继续承担“对话与运行日志”的角色，但**不再承担统一任务状态真相源**。  
TaskOrchestrator 需要自己的 task record，负责跨 supervision / workflow / scheduled / agent task 统一管理：

- 调度元数据：schedule、next_run_at、retry_count、depends_on
- 生命周期：queued / running / waiting / completed / failed / cancelled
- 拓扑关系：parent_task_id、root_task_id、project_id
- 执行绑定：session_id、provider_id、worktree_path、checkpoint_id
- 结果索引：result_summary、result_artifact、error_summary

**建议表**：`orchestrator_tasks`

```sql
CREATE TABLE orchestrator_tasks (
  id TEXT PRIMARY KEY,
  parent_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
  root_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,            -- 'agent' | 'supervision' | 'workflow' | 'scheduled'
  context_template TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  schedule_type TEXT,            -- 'cron' | 'interval' | 'once' | NULL
  schedule_config TEXT,          -- JSON
  depends_on TEXT,               -- JSON array of task ids
  provider_id TEXT,
  worktree_path TEXT,
  checkpoint_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 0,
  result_summary TEXT,
  result_artifact TEXT,
  error_summary TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
```

`sessions` 只保存 provider 运行产生的消息；`orchestrator_tasks` 才是 `listTasks/getTaskResult/killTask/recovery` 的唯一真相源。

### 统一 Ticker

```
TaskOrchestrator.tick() — 10s（替代 3 个独立 ticker）
    ├── 检查 scheduled tasks（cron/interval/once 触发）
    ├── 检查 workflow triggers（cron/interval/event 触发）
    ├── 检查 supervision 任务队列（依赖解析、并发控制）
    ├── 检查 Memory 定期摘要任务
    └── 执行到期的任务 → spawnTask()
```

### 三种编排模式

**Supervision Mode**（人类编排 — 现有 Supervisor 的演进）：

```typescript
// SupervisorService 变成 "supervision preset" 的初始化逻辑
// 底层调 TaskOrchestrator
const planTaskId = await orchestrator.spawnTask(null, {
  task: planPrompt,
  projectId: project.id,
  contextTemplate: 'supervision',
  tools: ['file-ops', 'code-search'],
});
const planResult = await orchestrator.getTaskResult(planTaskId);

const execTaskId = await orchestrator.spawnTask(null, {
  task: execPrompt + planResult.content,
  projectId: project.id,
  contextTemplate: 'coding',
  worktree: true,
  checkpoint: true,
});
// ... review 阶段类似
```

**Agent Mode**（模型编排）：

模型通过工具调用 TaskOrchestrator：

```typescript
// spawn_task 工具（注入给 agent）
{
  name: 'spawn_task',
  description: 'Create a sub-task that runs in a separate session',
  parameters: {
    task: { type: 'string', description: 'Task description' },
    projectId: { type: 'string', description: 'Target project (omit for current)' },
    tools: { type: 'array', items: { type: 'string' } },
    wait: { type: 'boolean', description: 'Wait for completion' },
  },
  execute: async (args, ctx) => {
    const taskId = await orchestrator.spawnTask(ctx.currentTaskId, {
      task: args.task,
      projectId: args.projectId || ctx.projectId,
      contextTemplate: 'agent',
      tools: args.tools,
    });
    if (args.wait) {
      const result = await orchestrator.getTaskResult(taskId);
      return { type: 'text', content: result.content };
    }
    return { type: 'text', content: `Task spawned: ${taskId}` };
  },
}
```

**Scheduled Mode**（定时/事件触发）：

统一 workflow trigger 和 scheduled task：

```typescript
// 定时任务注册
await orchestrator.spawnTask(null, {
  task: 'Run e2e tests',
  projectId: project.id,
  contextTemplate: 'coding',
  tools: ['shell'],
  schedule: { type: 'cron', cron: '0 2 * * *' },
});

// Global 定时任务（Memory 定期摘要）
await orchestrator.spawnTask(null, {
  task: 'Summarize activity logs and update memory',
  projectId: null,  // global
  contextTemplate: 'agent',
  tools: ['memory'],
  schedule: { type: 'cron', cron: '0 0 * * *' },
});
```

### Workflow 和 Scheduled Task 的定位

| 现有系统 | 新架构中的定位 |
|---|---|
| `ScheduledTask` | TaskOrchestrator 的定时触发配置（`SpawnTaskConfig.schedule`） |
| `Workflow` trigger | TaskOrchestrator 的定时/事件触发配置 |
| `Workflow` DAG 执行 | 多个 spawnTask 的编排（可通过 agent mode 或预定义 workflow 模板） |
| `Supervisor` ticker | TaskOrchestrator.tick() 的一部分 |

### Global vs Project Scope

| | Global | Project |
|---|---|---|
| workflow | ✅（需扩展，`project_id` 改 NULLABLE） | ✅（现有） |
| scheduled task | ✅（现有） | ✅（现有） |
| supervision task | ❌ 不需要 | ✅（现有） |
| agent task | ✅ Global Agent 的子任务 | ✅ Project Agent 的子任务 |

### 底层复用

TaskOrchestrator 底层复用现有基础设施：

| 功能 | 现有组件 | 复用方式 |
|---|---|---|
| Session 管理 | `sessions` 表 + `handleRunStart` | 每个 task spawn 一个 session |
| PCP provider | `ProviderAdapter.run()` | 通过 `tool.inject` 注入任务专属工具 |
| Git 隔离 | `WorktreePool` | `SpawnTaskConfig.worktree` 启用 |
| 持久化恢复 | `CheckpointEngine` | `SpawnTaskConfig.checkpoint` 启用 |
| 权限控制 | `PermissionEvaluator` | 子任务继承父任务权限策略 |

### 对现有代码的影响

- `SupervisorService` 不再是独立系统，变成 "supervision preset" 的初始化逻辑，底层调 TaskOrchestrator
- `TaskRunner` 和 `ReviewEngine` 变成 Context Engine 的 supervision 模板 + 编排 skill
- `WorkflowService.tick()` 和 `ScheduledTaskService.tick()` 合并到 `TaskOrchestrator.tick()`
- `ProjectAgent` 变成 agent config 的一种预设（supervision 模板 + 工具集 + 权限）
- `workflows.project_id` 改为 NULLABLE，支持 global workflow
- 不再需要独立的 `AgentManager` 类

---

## 3. Context Engine（System Prompt 内容管理器）

### 定位

Context Engine 是 system prompt 的**内容管理器**，决定"注入什么"。与 run-handler 的注入机制（"怎么注入"）正交。

```
Context Engine (决定内容)          run-handler (执行注入)

哪些 slot 要激活？                  systemPrompt 字段拼接
每个 slot 的优先级？                 传给 RunOptions
token 预算怎么分配？                 provider.run() 接收
超预算了哪个先压缩？
插件想替换哪个 slot？
```

**文件**: `server/src/context/engine.ts`

### 接口演进

**Phase 1（当前）**：固定模板

```typescript
interface ContextEngine {
  assemble(template: 'coding' | 'agent', ctx: AssemblyInput): string;
}
```

**Phase 2**：模板 + 场景覆盖

```typescript
interface ContextEngine {
  assemble(template: string, ctx: AssemblyInput): string;
  registerTemplate(name: string, slots: SlotConfig[]): void;
}
```

**Phase 3**：动态组装

```typescript
interface ContextEngine {
  assemble(template: string, ctx: AssemblyInput): string;
  registerTemplate(name: string, slots: SlotConfig[]): void;
  setSlot(id: string, provider: SlotProvider): void;
  removeSlot(id: string): void;
}
```

### 固定模板（Phase 1）

**Coding 模板**：

| Slot ID | Priority | 内容 |
|---------|----------|------|
| system-base | 0 | 基础 prompt |
| project-info | 10 | 项目信息 + CLAUDE.md / workspace prompt |
| skills | 20 | Skill 目录提示 |
| mode-prompt | 30 | 权限模式相关 prompt |
| tool-hints | 40 | 工具使用提示（file push, interaction tools） |
| session-prompt | 50 | Session 级自定义 prompt |

**Agent 模板**：

| Slot ID | Priority | 内容 |
|---------|----------|------|
| system-base | 0 | Agent 角色 prompt |
| project-info | 10 | 项目信息 |
| active-skills | 20 | 匹配的 skill 内容（主动注入） |
| memory | 30 | 持久记忆检索结果 |
| task-context | 40 | 当前任务描述 + 父任务上下文 |

### 与 Skills 的关系

Skills 有两种使用方式，不互斥：

| | Tool 模式（现有） | Prompt 模式（Context Engine） |
|---|---|---|
| 谁决定加载 | 模型自己 | Context Engine 匹配规则 |
| 加载时机 | 模型调用时 | run 启动前 |
| 占用 token | 按需，只在调用时 | 预先占用 system prompt 空间 |
| 适合场景 | 低频、大内容的 skill | 高频、核心的 skill |

Context Engine 的 `active-skills` slot 根据 trigger 规则决定哪些 skill 内容预热到 system prompt，不影响其他 skill 作为工具按需调用。

### 演进路径

TaskOrchestrator 创建子任务时，会根据任务类型选择不同模板：

```
Phase 1: 两套固定模板（coding / agent）
Phase 2: 新增场景模板（review / debug / ...）
Phase 3: 动态组装（spawnTask 时根据任务类型自动选 slot 组合）
```

上层始终只调 `contextEngine.assemble(template, ctx)`。

---

## 4. Agent 工具集

通过 PCP `tool.inject` + MCP bridge 注入，注册到现有 `toolRegistry`。

### 内置 Agent 工具

| 工具 | 说明 | 阶段 |
|------|------|------|
| shell | 执行 shell 命令（沙箱限制） | Phase 1 |
| file-ops | 文件读写/搜索（限制在项目目录） | Phase 1 |
| http-request | HTTP/API 调用 | Phase 1 |
| memory | 持久化键值记忆（跨 session） | Phase 1 |
| spawn_task | 创建子任务（调 TaskOrchestrator） | Phase 2 |
| steer_task | 向运行中的子任务注入指令 | Phase 2 |
| kill_task | 终止子任务 | Phase 2 |
| list_tasks | 列出子任务及状态 | Phase 2 |
| get_task_result | 获取已完成任务的输出 | Phase 2 |
| browser | 网页浏览（Playwright） | Phase 3 |

### 与现有交互工具的关系

现有交互工具（`ask_user_form`、`request_approval`、`update_todo_list`、`push_file`）已通过 MCP bridge 注入。Agent 工具使用相同机制，不需要新的注入通道。

### 工具可见性

不是所有工具对所有模式可见：

- Coding Mode：只看到交互工具 + skill 工具
- Agent Mode：看到交互工具 + skill 工具 + agent 工具

但这里不能只靠 PCP `EffectiveProfile`。`EffectiveProfile` 只描述 provider capability，**不描述当前 session 被授权看到哪些工具 scope**。

### Session-scoped Tool Exposure

工具暴露需要两层过滤同时成立：

1. **Provider capability filter**
   - 由 PCP `EffectiveProfile` 决定 provider 是否支持某类工具能力（如 interaction、tool.inject）
2. **Session scope filter**
   - 由 run/session 上下文决定当前 session 允许看到哪些 tool scope
   - 例如：`coding` → `interaction + skill`，`agent` → `interaction + skill + agent-assistant`

建议在 run 启动时生成 `ToolExposureProfile`：

```typescript
interface ToolExposureProfile {
  sessionId: string;
  template: 'coding' | 'agent' | 'supervision' | 'review';
  allowedScopes: Array<'interaction' | 'skill' | 'agent-assistant' | 'plugin'>;
  allowedToolIds?: string[];   // 可选白名单
}
```

MCP bridge 在 `tools/list` 时必须带 `sessionId`，服务端按 `ToolExposureProfile + PCPEffectiveProfile` 联合过滤：

- scope 不在 `allowedScopes` 的工具不暴露
- provider capability 不支持的工具不暴露
- 高危工具（如 `shell` / `browser`）即便暴露，也仍走现有权限链

这样才能保证：

- Coding Mode 不会“看到” agent 工具
- Agent Mode 可以安全复用同一条 MCP bridge
- 未来 plugin 贡献 agent tool 时，也能按 session 隔离，而不是全局裸暴露

---

## 5. 集成点

### WebSocket 消息

新增 Client 消息：
- `agent_start`: 启动 agent session（sessionId, input, model?, tools?）
- `agent_cancel`: 取消 agent

**复用现有消息类型**：`run_started`, `DeltaMessage`, `ToolUseMessage`, `ToolResultMessage`, `RunCompletedMessage` 等。`runId` 可继续复用现有 run 生命周期；task 级状态（队列、依赖、重试、父子关系）由 `orchestrator_tasks` 驱动，前端按需新增 task status 面板，而不是强行塞进 chat message 流。

### Session

扩展 `SessionType = 'regular' | 'background' | 'agent'`

Agent session 使用现有 `parentSessionId` 字段表示会话层级关系；真正的任务层级关系由 `orchestrator_tasks.parent_task_id/root_task_id` 表示。

### server.ts 集成

在 `handleClientMessage` switch 中新增 case：
- `agent_start` → 选择 provider + 注入 agent 工具集 + Context Engine agent 模板 + `handleRunStart()`
- `agent_cancel` → `TaskOrchestrator.killTask()`

### 权限

Agent 工具调用复用现有 `PermissionEvaluator`，高危工具（shell, browser）走 `PermissionRequestMessage` 流程请求用户确认。

---

## 6. Memory 系统

### 定位

Memory 是 agent 在执行任务过程中学到的、**跨 session 有价值的结构化知识**。

不是 session 历史（已有 `messages` 表），不是 provider 自带记忆（不可控），不是用户手写的 system prompt（已有 `projects.system_prompt`）。

### 两个维度

#### Scope 维度（空间）

| 层级 | 说明 | 来源 | 例子 |
|---|---|---|---|
| **Session** | 单次对话的消息记录 | `messages` 表（已有） | 不在 memory 系统范围内 |
| **Project** | 从 project 下所有 session 活动中提取的知识 | agent 写入 / 定期提炼 | "这个项目用 pnpm, 4 空格缩进, 跑 e2e 才能部署" |
| **Global** | 跨 project 的用户偏好 | agent 写入 / 定期提炼 | "用户偏好简洁回答，不要 emoji，时区 UTC+8" |

Project 和 Global 的区别只是 `project_id` 是否为 NULL，同一张表覆盖。

#### Time 维度（深度）

| 层级 | 说明 | 特点 | 用途 |
|---|---|---|---|
| **Layer 1: 元数据 / 流水账** | 每天通过 agent 做的事情的原始记录 | append-only，事实数据，量大 | 提炼的输入源 |
| **Layer 2: 衍生知识 / 偏好** | 从流水账中总结出的习惯、偏好、洞察 | 精炼、有价值、条目少 | Context Engine 消费 |

```
Layer 1 (流水账)                    Layer 2 (衍生知识)
─────────────────                   ─────────────────
对话记录                             "用户喜欢先写测试"
使用了哪些插件              ──提炼──→  "部署前必须跑 e2e"
执行的命令                           "项目依赖 pnpm"
任务完成/失败                        "代码风格: 4空格, 单引号"
```

### 数据源（Layer 1 怎么写入）

| 来源 | 写入时机 | 记录内容 |
|---|---|---|
| Run 完成 | `run.completed` 事件 | session 摘要、使用的工具、耗时、token 用量 |
| 工具调用 | 工具执行后 | 工具名、参数摘要、成功/失败 |
| 任务编排 | TaskOrchestrator 事件 | 任务创建、完成、失败、子任务关系 |
| 插件活动 | 插件事件 | 插件名、调用频次 |

### 提炼机制（Layer 1 → Layer 2）

| 方式 | 触发时机 | 说明 |
|---|---|---|
| **Agent 主动** | agent 执行过程中发现有价值的信息 | 通过 `memory` 工具写入 Layer 2 |
| **用户指令** | 用户说"记住 XXX" | agent 解析后写入 Layer 2 |
| **定期摘要** | 后台定时任务（每天/每周） | 从 Layer 1 中提炼习惯和偏好，写入 Layer 2 |

定期摘要可通过 TaskOrchestrator spawn 一个摘要任务，用 PCP provider 做总结。

### 与 Context Engine 的关系

Context Engine 的 `memory` slot 只读取 Layer 2（精炼知识），不读 Layer 1（量太大）：

- Project 级 memory → 注入当前 project 的 agent/coding 模板
- Global 级 memory → 注入所有模板

### Global Memory 写入门禁

为避免单个项目 agent 污染全局上下文：

- `memory.write(scope='global')` 只允许 Global Agent 或系统摘要任务调用
- Project Agent 若想提升一条全局偏好，只能写入 `agent_memory_candidate`，由 Global Agent 审核/合并
- Layer 2 的 global memory 记录需要保留 `source_task_id` / `source_session_id` / `author_scope`

### 淘汰策略

| 层级 | 策略 |
|---|---|
| **Layer 1** | 按时间保留（如 90 天），老数据归档或删除 |
| **Layer 2** | 不自动淘汰，由 agent 或定期摘要任务更新/合并/删除过时条目 |

### 数据库设计

```sql
-- Layer 1: 活动流水账（append-only）
CREATE TABLE agent_activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,     -- 'conversation' | 'tool_call' | 'task_completed' | 'error' | ...
  summary TEXT NOT NULL,  -- 一句话描述
  metadata TEXT,          -- JSON: 工具名、命令、耗时、token 等
  created_at INTEGER NOT NULL
);

-- Layer 2: 衍生知识（project + global）
CREATE TABLE agent_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = global
  namespace TEXT NOT NULL DEFAULT 'default',  -- 'habit' | 'preference' | 'insight' | ...
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  author_scope TEXT NOT NULL DEFAULT 'project',   -- 'global-agent' | 'system' | 'project'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(COALESCE(project_id, ''), namespace, key)
);

-- 可选：Project Agent 提交给 Global Agent 的候选项
CREATE TABLE agent_memory_candidate (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  source_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'accepted' | 'rejected'
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
```

### 实现说明

具体的存储引擎选型（SQLite / 向量数据库 / 其他）、检索方式（关键词 / 语义 / 混合）、提炼管线的技术方案在实施阶段再定。如果有成熟的开源项目或工具链可复用，优先复用而非自建。

注：不一定需要名为 `agent_runs` 的表，但需要一个统一的 task record（如 `orchestrator_tasks`）。仅复用 `sessions` + `supervision_tasks` 不足以支撑跨模式编排。

---

## 7. 文件结构

```
server/src/
├── orchestration/
│   ├── task-orchestrator.ts       # TaskOrchestrator: spawn/steer/kill/tick
│   ├── scheduler.ts              # 统一 ticker（替代 3 个独立 ticker）
│   ├── presets/
│   │   ├── supervision.ts        # Supervision 预设（plan→execute→review 编排策略）
│   │   └── agent.ts              # Agent 预设（模型自主分解）
│   └── types.ts                   # 编排类型定义
│
├── context/
│   ├── engine.ts                  # ContextEngine: slot 系统
│   ├── types.ts                   # Slot 接口定义
│   └── templates/
│       ├── coding.ts              # Coding 模板 slot 配置
│       ├── agent.ts               # Agent 模板 slot 配置
│       └── supervision.ts         # Supervision 模板 slot 配置
│
├── agent-tools/                   # Agent 专属工具（注入到 toolRegistry）
│   ├── shell.ts
│   ├── file-ops.ts
│   ├── http-request.ts
│   ├── memory.ts                  # 读写 agent_memory (Layer 2)
│   └── task-tools.ts              # spawn_task / steer_task / kill_task / list_tasks / get_task_result
│
├── memory/                        # Memory 系统
│   ├── activity-log.ts            # Layer 1: 活动流水账写入/查询
│   ├── memory-store.ts            # Layer 2: 衍生知识 CRUD
│   └── digest.ts                  # Layer 1 → Layer 2 提炼逻辑
│
├── services/supervision/          # 现有 Supervision（重构为 orchestration preset）
│   ├── supervisor-service.ts      # → 变成 orchestration/presets/supervision.ts 的薄包装
│   ├── task-runner.ts             # → 逻辑合并到 supervision preset
│   └── review-engine.ts           # → 逻辑合并到 supervision preset
│
├── domains/workflows/             # 现有 Workflow（tick 合并到统一 scheduler）
│   └── service.ts                 # WorkflowService.tick() → 调 TaskOrchestrator
│
├── domains/scheduled-tasks/       # 现有 Scheduled Task（tick 合并到统一 scheduler）
│   └── service.ts                 # ScheduledTaskService.tick() → 调 TaskOrchestrator
│
└── interactions/                   # 现有交互工具（不变）
    ├── interaction-tools.ts
    └── interaction-dispatcher.ts
```

需修改的现有文件：
- `shared/src/index.ts` — 扩展 SessionType
- `shared/src/features/workflows.ts` — `project_id` 改为 NULLABLE
- `server/src/server.ts` — 新增 `agent_start` / `agent_cancel` 消息处理，统一 ticker
- `server/src/ws/run-handler.ts` — 支持 agent 模式的工具注入和 context 模板选择
- `server/src/domains/plugins/tools-routes.ts` / `server/src/domains/plugins/mcp-bridge.ts` — 按 `sessionId` 应用 ToolExposureProfile + PCP 过滤
- `server/src/services/supervision/supervisor-service.ts` — 底层改为调 TaskOrchestrator
- `server/src/storage/db.ts` — 增加 `orchestrator_tasks` / `agent_memory_candidate` migration

需迁移/废弃的现有文件：
- `apps/desktop/src/services/agentLoop.ts` — **废弃**（执行引擎迁到服务端）
- `apps/desktop/src/services/clientAI.ts` — **废弃**（不再需要外部 API 配置）
- `apps/desktop/src/services/agentStorage.ts` — **废弃**（改用服务端 session 存储）
- `apps/desktop/src/services/agentTools.ts` — **迁移到服务端**（工具定义移到 `agent-tools/`，多 backend 路由逻辑保留在服务端）
- `apps/desktop/src/components/agent/AgentPanel.tsx` — **适配**（从客户端回调改为 WebSocket 事件消费）
- `apps/desktop/src/stores/agentStore.ts` — **扩展**（追加 agent session 状态管理）

---

## 8. 实施阶段

### Phase 1: 执行引擎迁移 + Context Engine + Agent 基础工具 + Memory

**执行引擎迁移（客户端 → 服务端）**：
- 服务端新增 `agent_start` / `agent_cancel` 消息处理（走 PCP provider + tool.inject）
- 迁移 `agentTools.ts` 的工具定义到服务端 `toolRegistry`（scope: `agent-assistant`）
- 废弃 `agentLoop.ts`（客户端 tool-call loop）和 `clientAI.ts`（OpenAI API 调用）
- 废弃 `agentStorage.ts`（IndexedDB）→ agent 对话存入服务端 `sessions` + `messages` 表
- 适配 `AgentPanel.tsx`：从客户端 loop 回调改为消费 WebSocket 统一事件流
- 保留 `agentStore.ts`、`permission-evaluator.ts`、`agent_config` 表、已有插件

**Context Engine**：
- Context Engine 接口 + 两套固定模板（coding / agent）
- 重构 run-handler 的 prompt 拼接为 `contextEngine.assemble()`

**Agent 工具**：
- shell + file-ops + http-request + memory 工具（注册到 toolRegistry）
- run 启动时生成 `ToolExposureProfile`，确保 coding / agent session 的 MCP 工具隔离

**Memory**：
- DB migration: `agent_activity_log` 表（Layer 1）+ `agent_memory` 表（Layer 2）
- Activity log 写入（run.completed 事件 → 记录活动）
- memory 工具（agent 主动读写 Layer 2）
- Project Agent 只能写 project memory；global memory 通过 candidate + 审核路径写入

### Phase 2: TaskOrchestrator + Supervisor 合并 + Scheduler 统一

**TaskOrchestrator**：
- TaskOrchestrator 核心实现（spawnTask / steerTask / killTask）
- 新增 `orchestrator_tasks` 作为统一任务状态真相源
- spawn_task / steer_task / kill_task / list_tasks / get_task_result 工具

**Supervisor 合并**：
- 创建 supervision preset（plan→execute→review 编排策略）
- SupervisorService 重构为 preset 的薄包装，底层调 TaskOrchestrator
- ProjectAgent 变为 agent config 预设
- Context Engine 新增 supervision 模板

**Scheduler 统一**：
- 统一 ticker（替代 WorkflowService.tick + ScheduledTaskService.tick + SupervisorService.tick）
- Workflow trigger 和 Scheduled Task 的 cron/interval 统一到 TaskOrchestrator.tick()
- `workflows.project_id` 改 NULLABLE，支持 global workflow

**前端**：
- agent 状态展示
- supervision dashboard 适配新架构

### Phase 3: Skills 增强 + 高级工具

- Context Engine 的 `active-skills` slot（trigger 匹配 + 主动注入）
- Skills requires 检查（OS、环境变量、二进制依赖）
- browser.ts（Playwright）
- 更多 Context Engine 模板（review / debug）

### Phase 4: 插件扩展

- 插件贡献 agent 工具（`scope: ['agent-assistant']`）
- 插件替换 Context Engine slot
- 插件注册自定义 skill

---

## 设计决策

| 决策点 | v2 选择 | v3 选择 | 原因 |
|--------|---------|---------|------|
| 执行方式 | 直接 Anthropic API | **复用 PCP provider** | `tool.inject` 解决了工具注入，不需要自建 loop |
| 编排机制 | 独立 AgentManager | **统一 TaskOrchestrator** | 与 Supervision 底层重叠，应共享 |
| Supervisor 定位 | 独立系统 | **Project-level Agent preset** | Supervisor 本质是配了特定工具和模板的 Agent |
| Scheduler | 3 个独立 ticker | **统一 ticker** | WorkflowService + ScheduledTaskService + SupervisorService 核心逻辑相同 |
| Workflow scope | Project only | **Project + Global** | Global workflow 支持跨项目编排（Memory 摘要、配置同步等） |
| Agent 协作 | — | **共享数据，不直接通信** | 通过 agent_memory + TaskOrchestrator 间接协作，不需要 A2A |
| Context 管理 | 独立 ContextEngine | **接口先定 + 固定模板** | 渐进式演进，不过度设计 |
| 工具注册 | 自定义 AgentToolDefinition | **复用 toolRegistry** | 已有 `agent-assistant` scope |
| Skills | 独立加载器 | **复用现有 + Context Engine 增强** | 基础已实现，只加 trigger 匹配 |
| 消息协议 | 新增 agent 消息类型 | **复用现有 run 消息** | chat 渲染大体复用，task/status UI 仍需扩展 |

---

## Open Questions

1. ~~**Memory 持久化**~~：已确定两层三级模型（Layer 1 流水账 + Layer 2 衍生知识，Session / Project / Global scope）
2. **Token 成本控制**：Sub-task 可能产生大量 API 调用，是否需要 budget 限制？
3. ~~**与 Coding Flow 的协作**~~：Agent 可通过 spawn_task 创建 coding 模板的子任务，contextTemplate 区分模式
4. **后续自建 agent runtime**：何时需要从 PCP provider 演进到自建 SDK 调用？判断标准是什么？
5. **Memory 技术选型**：Layer 2 的检索方式（关键词 / 语义向量 / 混合）、定期摘要的提炼管线、是否有可复用的开源项目？实施阶段再定。
6. ~~**Activity Log 写入粒度**~~：Phase 1 先只记 session 级别摘要（run.completed 时一条记录），不记每次工具调用。量小、schema 简单、够提炼用。后续按需加细粒度。
7. ~~**Workflow DAG 迁移**~~：Phase 2 保留 WorkflowEngine 的 DAG 执行，只把 ticker 合并到统一 scheduler。DAG → spawn_task 替代是 Phase 3+ 的事，当前 workflow 体系已稳定运行。
8. **Supervisor 存量数据迁移**：现有 `supervision_tasks` 表的数据如何映射到 `orchestrator_tasks` 的统一任务模型？
