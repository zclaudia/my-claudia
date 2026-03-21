# Agent Assistant v3 — Phase 1 Implementation Plan

## Overview

Phase 1 目标：把 Agent Assistant 的执行引擎从客户端迁到服务端，通过 PCP provider 执行，建立 Context Engine 和 Memory 基础。

**原则**：增量叠加，不破坏现有 coding flow。现有 `run_start` 路径不动，新增 `agent_start` 路径并行。

---

## 依赖关系

```
Step 1 (类型 + DB)
    │
    ├──→ Step 2 (Context Engine)
    │        │
    │        └──→ Step 4 (agent_start 消息处理)
    │                 │
    │                 └──→ Step 6 (前端 AgentPanel 适配)
    │
    ├──→ Step 3 (Agent 工具)
    │        │
    │        └──→ Step 4
    │
    └──→ Step 5 (Memory)
             │
             └──→ Step 4
```

Step 1 先行，Step 2/3/5 可并行，Step 4 依赖 2+3+5，Step 6 依赖 4。

---

## Step 1: 类型定义 + DB Migration

**目标**：定义 Agent Assistant 新增类型，创建数据库表。

### 1.1 扩展 shared 类型

`shared/src/core/session.ts` 或 `shared/src/index.ts`：

```ts
// 扩展 SessionType
export type SessionType = 'regular' | 'background' | 'agent';
```

`shared/src/protocol/messages.ts`：

```ts
// 新增 client 消息
export interface AgentStartMessage {
  type: 'agent_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  providerId?: string;
  model?: string;
  tools?: string[];           // 额外工具白名单
}

export interface AgentCancelMessage {
  type: 'agent_cancel';
  sessionId: string;
}
```

### 1.2 DB Migration

`server/src/storage/migrations/0xx_agent_assistant.ts`：

```sql
-- Layer 1: 活动流水账
CREATE TABLE IF NOT EXISTS agent_activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_project ON agent_activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_created ON agent_activity_log(created_at);

-- Layer 2: 衍生知识
CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_task_id TEXT,
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  author_scope TEXT NOT NULL DEFAULT 'project',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(COALESCE(project_id, ''), namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_namespace ON agent_memory(namespace);
```

### 验证

- `pnpm build` 通过
- migration 在 dev DB 上运行成功

---

## Step 2: Context Engine

**目标**：把 run-handler 的 hardcoded prompt 拼接提取为 Context Engine，支持 coding 和 agent 两套模板。

### 2.1 新建 `server/src/context/types.ts`

```ts
export interface AssemblyInput {
  projectId?: string;
  sessionId: string;
  mode?: string;
  model?: string;
  cwd?: string;
  userInput?: string;
  // 现有 run-handler 传入的各种 prompt 片段
  workspacePrompt?: string;
  skillDirectoryHint?: string;
  systemContext?: string;
  nonNativePlanPrompt?: string;
  planDocumentPrompt?: string;
  filePushContext?: string;
  interactionToolPrompt?: string;
  sessionSystemPrompt?: string;
}

export interface ContextEngine {
  assemble(template: 'coding' | 'agent', input: AssemblyInput): string;
}
```

### 2.2 新建 `server/src/context/engine.ts`

```ts
export function createContextEngine(): ContextEngine {
  return {
    assemble(template, input) {
      if (template === 'agent') {
        return assembleAgentTemplate(input);
      }
      return assembleCodingTemplate(input);
    }
  };
}

function assembleCodingTemplate(input: AssemblyInput): string {
  // 把现有 run-handler 的 prompt 拼接逻辑搬过来
  return [
    input.workspacePrompt,
    input.skillDirectoryHint,
    input.systemContext,
    input.nonNativePlanPrompt,
    input.planDocumentPrompt,
    input.filePushContext,
    input.interactionToolPrompt,
    input.sessionSystemPrompt,
  ].filter(Boolean).join('\n\n');
}

function assembleAgentTemplate(input: AssemblyInput): string {
  return [
    AGENT_SYSTEM_PROMPT,          // Agent 角色 prompt
    input.workspacePrompt,        // 项目信息
    input.skillDirectoryHint,     // 可用 skill
    input.filePushContext,        // 文件推送能力
    input.interactionToolPrompt,  // 交互工具
    input.sessionSystemPrompt,    // session 级自定义
  ].filter(Boolean).join('\n\n');
}
```

### 2.3 重构 run-handler

在 `run-handler.ts` 中，把现有 systemPrompt 拼接替换为：

```ts
const contextEngine = createContextEngine();
const systemPrompt = contextEngine.assemble('coding', {
  workspacePrompt,
  skillDirectoryHint,
  systemContext: message.systemContext,
  nonNativePlanPrompt,
  planDocumentPrompt,
  filePushContext,
  interactionToolPrompt,
  sessionSystemPrompt: session.system_prompt,
});
```

行为完全不变，只是提取了拼接逻辑。

### 验证

- 现有 coding flow 不受影响（所有现有测试通过）
- Context Engine 单元测试：coding 模板输出与原拼接结果一致

---

## Step 3: Agent 工具

**目标**：在服务端注册 agent 专属工具，通过 MCP bridge 注入。

### 3.1 新建 `server/src/agent-tools/`

4 个工具文件，注册到 `toolRegistry`（scope: `agent-assistant`）：

**`shell.ts`** — 执行 shell 命令
- 限制在项目 cwd 下执行
- 复用现有 `PermissionEvaluator` 做权限检查
- 输入：`{ command: string, cwd?: string }`
- 输出：`{ stdout, stderr, exitCode }`

**`file-ops.ts`** — 文件读写搜索
- 读/写/列表/搜索，限制在项目目录
- 输入：`{ operation: 'read'|'write'|'list'|'search', path: string, content?: string, pattern?: string }`
- 输出：文件内容或搜索结果

**`http-request.ts`** — HTTP 调用
- 输入：`{ url: string, method?: string, headers?: Record, body?: string }`
- 输出：`{ status, headers, body }`

**`memory.ts`** — 持久化记忆（读写 agent_memory Layer 2）
- 输入：`{ operation: 'get'|'set'|'list'|'delete', namespace?: string, key?: string, value?: string }`
- 输出：记忆内容

### 3.2 注册逻辑

`server/src/agent-tools/index.ts`：

```ts
export function registerAgentTools(config: { db: Database }): void {
  // 注册到 toolRegistry，scope: ['agent-assistant']
  // 这些工具只对 agent mode session 可见（通过 ToolExposureProfile 控制）
}
```

在 `server-setup.ts` 中调用 `registerAgentTools()`。

### 3.3 工具可见性控制

扩展现有 PCP `shouldExposeInteractionTool` 机制，加入 agent 工具的 scope 过滤：

- coding session：只暴露 interaction 工具 + skill 工具
- agent session：暴露 interaction 工具 + skill 工具 + agent 工具

通过 session type 或 Context Engine 模板类型判断。

### 验证

- 工具注册成功（`toolRegistry.getAll()` 能看到）
- 工具通过 MCP bridge 可调用（手动测试）
- coding session 看不到 agent 工具

---

## Step 4: `agent_start` 消息处理

**目标**：服务端接收 `agent_start` 消息，创建 agent session，通过 PCP provider 执行。

### 4.1 新建 `server/src/ws/agent-handler.ts`

```ts
export async function handleAgentStart(
  client: ConnectedClient,
  message: AgentStartMessage,
  db: Database,
  ctx: RunHandlerContext,
): Promise<void> {
  // 1. 查找或创建 agent session（type: 'agent'）
  // 2. 选择 PCP provider
  // 3. Context Engine 组装 agent 模板 system prompt
  // 4. 构建 RunOptions（注入 agent 工具集）
  // 5. 调用 handleRunStart()（复用现有 run 流程）
}
```

关键：`handleAgentStart` 不重新实现 run 逻辑，而是构造好参数后调用 `handleRunStart`。区别只在于：

- `contextTemplate = 'agent'`（不同的 system prompt）
- `sessionType = 'agent'`（不同的 session 类型）
- 工具集不同（agent 工具可见）

### 4.2 集成到 server.ts

在 `handleClientMessage` switch 中新增：

```ts
case 'agent_start':
  await handleAgentStart(client, message, db, ctx);
  break;
case 'agent_cancel':
  // 复用现有 cancelRun 逻辑
  break;
```

### 4.3 agent session 管理

- agent session 创建时 `type = 'agent'`
- 使用现有 `parentSessionId` 关联到主 session（如果是从主 session 发起的）
- 消息存入 `messages` 表（与 regular session 完全相同）

### 验证

- 发送 `agent_start` 消息后，服务端创建 agent session 并执行
- 收到 `run_started`、`delta`、`tool_use`、`run_completed` 等标准消息
- agent 能调用 shell / file-ops / memory 工具
- coding session 不受影响

---

## Step 5: Memory 系统

**目标**：实现 activity log 写入和 memory 工具的服务端支持。

### 5.1 新建 `server/src/memory/activity-log.ts`

```ts
export function recordActivity(db: Database, entry: {
  projectId?: string;
  sessionId?: string;
  type: string;
  summary: string;
  metadata?: Record<string, unknown>;
}): void {
  // INSERT INTO agent_activity_log
}
```

### 5.2 新建 `server/src/memory/memory-store.ts`

```ts
export class MemoryStore {
  constructor(private db: Database) {}

  get(projectId: string | null, namespace: string, key: string): string | undefined;
  set(projectId: string | null, namespace: string, key: string, value: string): void;
  list(projectId: string | null, namespace?: string): MemoryEntry[];
  delete(projectId: string | null, namespace: string, key: string): void;
  // For Context Engine memory slot
  getProjectAndGlobalMemories(projectId: string): MemoryEntry[];
}
```

### 5.3 接入事件

在 `run-handler.ts` 的 run 完成时记录 activity：

```ts
pluginEvents.on('run.completed', (event) => {
  recordActivity(db, {
    projectId: event.projectId,
    sessionId: event.sessionId,
    type: 'conversation',
    summary: `Session completed, ${event.usage?.outputTokens || 0} tokens used`,
    metadata: { runId: event.runId, usage: event.usage },
  });
});
```

### 验证

- `agent_memory` 表可读写
- `agent_activity_log` 在 run 完成后有记录
- memory 工具能 get/set/list/delete

---

## Step 6: 前端 AgentPanel 适配

**目标**：AgentPanel 从客户端 loop 改为消费 WebSocket 事件流。

### 6.1 修改 `AgentPanel.tsx`

核心改动：

```
之前：                              之后：
agentLoop.sendMessage()          →  socket.send({ type: 'agent_start', ... })
agentLoop callbacks (onDelta)    →  messageHandler 的现有事件处理
agentStorage (IndexedDB)         →  服务端 session messages（通过 API 加载）
```

AgentPanel 变成一个特殊的 ChatInterface — 使用 agent session 而非 regular session，但渲染逻辑复用。

### 6.2 修改 `agentStore.ts`

新增字段：

```ts
agentSessionId: string | null;     // 当前 agent session ID
```

AgentPanel 打开时，检查是否有现有 agent session，没有则通过 API 创建一个 `type: 'agent'` 的 session。

### 6.3 保留兼容

- 不立即删除 `agentLoop.ts` / `clientAI.ts` / `agentStorage.ts`
- 用 feature flag 或配置切换新旧模式（先跑通新模式再废弃旧模式）

### 验证

- AgentPanel 能发消息、看到流式响应
- agent 工具调用（shell/file-ops）正常工作
- 消息持久化在服务端（刷新页面后能恢复对话）

---

## 实施顺序总结

| Step | 内容 | 依赖 | 预估工作量 |
|------|------|------|-----------|
| 1 | 类型 + DB Migration | 无 | 0.5 天 |
| 2 | Context Engine | Step 1 | 1 天 |
| 3 | Agent 工具 | Step 1 | 1-2 天 |
| 4 | agent_start 消息处理 | Step 2 + 3 | 1-2 天 |
| 5 | Memory 系统 | Step 1 | 1 天 |
| 6 | 前端 AgentPanel 适配 | Step 4 | 1-2 天 |

**总计约 5-9 天**，Step 2/3/5 可并行。

---

## 验证标准

Phase 1 完成的标志：

1. 用户在 AgentPanel 输入"帮我看下这个项目的目录结构"
2. 服务端通过 PCP provider 执行，agent 调用 `shell` 工具（`ls -la`）
3. 结果流式显示在 AgentPanel 中
4. 对话记录存在服务端（刷新后可恢复）
5. coding flow 完全不受影响
6. `memory` 工具可以跨 session 存取信息

---

## 风险和缓解

| 风险 | 缓解 |
|---|---|
| agent 工具注入影响 coding session | 通过 scope + session type 隔离，coding session 看不到 agent 工具 |
| Context Engine 重构破坏现有 prompt | Step 2 先确保 coding 模板输出与原拼接完全一致 |
| AgentPanel 改动影响现有 UI | Step 6 用 feature flag 切换，新旧模式可并存 |
| PCP provider 不支持 agent 工具 | PCP v1 已确保所有 provider 支持 `tool.inject`，不存在此问题 |
