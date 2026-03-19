# Agent Assistant 系统设计方案（v2 — 参考 OpenClaw）

> **状态**: 草案，多轮讨论中
> **更新**: 2026-03-19
> **参考**: [OpenClaw](https://github.com/openclaw/openclaw) — 开源自主 AI Agent

---

## Context

### 背景

当前 my-claudia 的 agent 执行完全依赖外部 provider CLI（Claude Code、OpenCode 等），我们只做消息转发和权限控制。之前的 Agent Assistant 定位为「插件运行时平台」，但存在以下问题：

1. 需要额外配置 OpenAI-compatible API（配置负担）
2. 能力太弱 — 只能管理/搜索，不能独立执行复杂任务
3. 和主会话功能重复
4. 缺乏差异化价值

### 新方向

参考 OpenClaw 的设计理念，在**不改动现有 provider coding 体系**的前提下，构建一个并行的 **Agent Assistant 系统**，赋予它：

- **自主任务分解**：Sub-agent 编排（spawn/steer/kill）
- **自定义工具**：不依赖底层 provider 的独立工具体系
- **动态技能加载**：Markdown prompt 包（Skills）
- **可插拔上下文管理**：Slot 系统

这是一个**独立的旁路系统**，与现有 coding flow 并行运行。

### 用户的核心期望（延续 v1）

- 不只是内置功能，而是一个可以扩展插件的入口
- 插件可以帮用户做各种事情：整理笔记、归档文档、定时提醒、读 Jira、监控任务进程等
- 定义一套通用且可扩展的协议
- 使用 JavaScript 开发插件
- 渐进式发现机制（先本地文件，后续商店）

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Frontend (WebSocket)                              │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────────────┐
│                     server.ts (Message Router)                           │
│                                                                          │
│  ┌──── run_start ─────┐         ┌──── agent_start ────────────────────┐ │
│  │ 现有 Coding Flow    │         │ Agent Assistant Flow                │ │
│  │ (Provider Adapters) │         │                                     │ │
│  │ Claude/OpenCode/    │         │  ┌─────────────────────────────┐   │ │
│  │ Kimi/Cursor/Codex   │         │  │      AgentRuntime           │   │ │
│  │                     │         │  │  (Direct Anthropic API)     │   │ │
│  │                     │         │  │  + Custom Tools             │   │ │
│  │                     │         │  │  + Skills                   │   │ │
│  │                     │         │  │  + Sub-agents               │   │ │
│  │                     │         │  │  + Context Engine            │   │ │
│  │                     │         │  └─────────────────────────────┘   │ │
│  │                     │         │               │                     │ │
│  │                     │         │       ┌───────┼───────┐             │ │
│  │                     │         │       ▼       ▼       ▼             │ │
│  │                     │         │   Built-in  Plugin  External        │ │
│  │                     │         │   Tools     Tools   Services        │ │
│  └─────────────────────┘         └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键区别**：Coding Flow 通过 provider adapter 调用外部 CLI 子进程；Agent Assistant 通过 Anthropic SDK **直接调用 API**，在服务端进程内运行自己的 tool-call loop。

---

## 1. Agent Runtime（核心执行引擎）

**文件**: `server/src/agent-assistant/runtime.ts`

### 执行流程

标准 LLM tool-call loop，直接调用 Anthropic Messages API：

```
用户输入 → 组装上下文(ContextEngine) → API 调用 →
  ├─ 无 tool_use → 返回文本，结束
  └─ 有 tool_use → 执行工具 → 结果追加到对话 → 循环
```

### 核心接口

```typescript
class AgentRuntime {
  // AsyncGenerator 产出事件，复用现有 DeltaMessage/ToolUseMessage 等消息类型
  async *run(input: string): AsyncGenerator<AgentEvent>;
  async abort(): void;
}

interface AgentRuntimeConfig {
  agentId: string;
  sessionId: string;
  parentAgentId?: string;
  model: string;                 // e.g. 'claude-sonnet-4-20250514'
  tools: AgentToolDefinition[];
  maxTurns: number;              // 安全上限，默认 50
  contextEngine: ContextEngine;
}
```

### 为什么直接调 API 而不走 provider adapter

我们需要在自己的层面定义和执行自定义工具（浏览器、邮件、HTTP 等），而 provider adapter 封装的是外部 CLI 的工具体系，无法注入我们的工具。直接调 API 让我们完全控制 tool-call loop。

---

## 2. 自定义工具系统

**文件**: `server/src/agent-assistant/tools/`

### 工具定义接口

```typescript
interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  requiresPermission?: boolean;
  timeout?: number;                     // ms, 默认 30000
}

interface ToolContext {
  agentId: string;
  sessionId: string;
  projectId: string;
  cwd: string;
  agentManager: AgentManager;
  db: Database;
  broadcastFn: (msg: ServerMessage) => void;
}

type ToolResult =
  | { type: 'text'; content: string }
  | { type: 'json'; data: unknown }
  | { type: 'file'; path: string; content: string };
```

### 工具注册

复用现有 `toolRegistry`（已有 `agent-assistant` scope），`AgentToolRegistry` 作为包装层：

- 合并内置 agent 工具 + 插件注册的工具
- 按 scope 过滤：`toolRegistry.getDefinitionsByScope('agent-assistant')`
- 转换为 Anthropic API 的 tool schema 格式

**关键文件**: `server/src/plugins/tool-registry.ts`（已有 `ToolScope = 'agent-assistant'`，无需修改）

### 内置工具清单

| 工具 | 文件 | 说明 | 阶段 |
|------|------|------|------|
| shell | `tools/shell.ts` | 执行 shell 命令 | Phase 1 |
| file-ops | `tools/file-ops.ts` | 文件读写/搜索（沙箱限制在项目目录） | Phase 1 |
| http-request | `tools/http-request.ts` | HTTP/API 调用 | Phase 1 |
| memory | `tools/memory.ts` | 持久化键值记忆（跨 session） | Phase 1 |
| spawn/steer/kill/list_agent | `tools/sub-agents.ts` | Sub-agent 编排 | Phase 2 |
| browser | `tools/browser.ts` | 网页浏览（Playwright） | Phase 3 |
| email | `tools/email.ts` | 邮件收发（SMTP/IMAP） | Phase 3 |
| code-search | `tools/code-search.ts` | 语义代码搜索 | Phase 3 |

### 插件贡献工具

插件通过现有 `toolRegistry` 注册工具（`scope: ['agent-assistant']`），Agent Assistant 自动发现并可使用。

```typescript
// 插件中注册工具
toolRegistry.register({
  id: 'jira_search',
  definition: { type: 'function', function: { name: 'jira_search', ... } },
  handler: async (args) => { /* ... */ },
  source: 'plugin',
  pluginId: 'jira-integration',
  scope: ['agent-assistant'],
});
```

---

## 3. Sub-Agent 编排

**文件**: `server/src/agent-assistant/agent-manager.ts`

参考 OpenClaw 的 spawn/steer/kill 模式。OpenClaw 没有独立的 workflow 引擎，信任模型自己分解任务 — 我们采用同样策略。

### AgentManager

```typescript
class AgentManager {
  private agents = new Map<string, AgentInfo>();

  async spawn(parentAgentId: string | null, config: SpawnConfig): Promise<string>;
  async steer(agentId: string, instruction: string): Promise<void>;
  async kill(agentId: string): Promise<void>;
  list(parentAgentId?: string): AgentInfo[];
  getOutput(agentId: string): Promise<string>;
}

interface AgentInfo {
  agentId: string;
  sessionId: string;
  parentAgentId: string | null;
  status: 'running' | 'paused' | 'completed' | 'failed';
  task: string;
  runtime: AgentRuntime;
  createdAt: number;
}
```

### Sub-Agent 工具

以 LLM 工具的形式暴露编排能力：

- **spawn_agent**: 创建子 agent，独立 session（`parentSessionId` 关联），独立 tool-call loop
- **steer_agent**: 向运行中的子 agent 注入新指令（追加到其对话历史）
- **kill_agent**: 终止子 agent
- **list_agents**: 列出子 agent 及状态
- **get_agent_output**: 获取已完成子 agent 的输出

### 生命周期示例

```
Parent Agent
  │
  ├── spawn_agent("Research competitor X")
  │     └── Sub-Agent A (session_id: abc, parent_session_id: parent)
  │           ├── Uses browser, http_request tools
  │           └── Completes → status: 'completed'
  │
  ├── spawn_agent("Implement feature Y")
  │     └── Sub-Agent B (session_id: def, parent_session_id: parent)
  │           ├── Uses file_ops, shell tools
  │           ├── steer_agent(B, "Focus on the API layer first")
  │           └── Running...
  │
  └── get_agent_output(A) → "Here are the findings..."
```

### 并发控制

- 子 agent 并行执行
- `maxConcurrentAgents` 限制（默认 5）
- 子 agent 共享父 agent 的权限策略
- 每个子 agent 创建独立 `Session`（`type: 'agent'`, `parentSessionId` 指向父 session）

---

## 4. Skills 系统

**文件**: `server/src/agent-assistant/skills/`

参考 OpenClaw 的 52 个 skill 包设计 — skills 是 **markdown prompt 内容**，不是可执行代码。

### Skill 格式（Markdown + YAML frontmatter）

```yaml
---
id: code-review
name: Code Review
description: Code review guidelines and best practices
triggers:
  keywords: ["review", "PR", "code quality"]
  projectType: ["code"]
requires:
  os: ["darwin", "linux"]
  binaries: ["git"]
  env: ["GITHUB_TOKEN"]
priority: 10
---

# Code Review Guidelines

When reviewing code, follow these principles:
...（prompt 内容，注入到 agent 系统 prompt）
```

### 加载流程

```
发现(discover) → 解析(parse) → 匹配(match) → 注入(inject)
```

1. **Discover**: 扫描 `skills/packages/` 目录 + 插件注册的 skills
2. **Parse**: 解析 YAML frontmatter + markdown body
3. **Match**: 根据 `triggers`（关键词、项目类型）和 `requires`（OS、环境变量、二进制）筛选
4. **Inject**: 匹配的 skills 内容通过 ContextEngine 的 `active-skills` slot 注入系统 prompt

### 插件扩展

插件通过 `contributes.skills` 注册自定义 skill：

```json
{ "contributes": { "skills": [{ "path": "skills/my-skill.md" }] } }
```

---

## 5. 可插拔上下文引擎

**文件**: `server/src/agent-assistant/context/`

参考 OpenClaw 的 `bootstrap → ingest → assemble → compact` 生命周期和 slot 替换机制。

### Slot 系统

```typescript
interface ContextSlot {
  id: string;           // e.g. 'system-base', 'active-skills', 'memory'
  priority: number;     // 组装顺序（越小越靠前）
  maxTokens?: number;   // Token 预算
  provider: ContextSlotProvider;
}

interface ContextSlotProvider {
  getContent(ctx: AssemblyInput): Promise<string>;
  compact?(content: string, targetTokens: number): Promise<string>;
}
```

### 生命周期

`bootstrap → assemble → compact`

1. **Bootstrap**: 注册默认 slots
2. **Assemble**: 按 priority 排序，依次调用 provider.getContent()，拼接系统 prompt
3. **Compact**: 超出 token 预算时，按 priority 倒序压缩（低优先级先压缩）

### 默认 Slots

| Slot ID | Priority | 内容 |
|---------|----------|------|
| system-base | 0 | Agent Assistant 基础 prompt |
| project-info | 10 | 项目信息 + CLAUDE.md |
| active-skills | 20 | 匹配的 skill 内容 |
| memory | 30 | 持久记忆检索结果 |
| conversation-summary | 40 | 长对话摘要 |

### 插件替换

插件可通过 `registerSlot()` 替换同 ID 的 slot（last-write-wins）：

```typescript
contextEngine.registerSlot({
  id: 'project-info',  // 替换内置的 project-info
  priority: 10,
  provider: new MyCustomProvider(),
});
```

---

## 6. 插件协议（延续 v1）

### 插件接口

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  permissions: Permission[];
  tools: ToolDefinition[];
  skills?: { path: string }[];
  executionMode: 'main' | 'sandbox';
}

type Permission =
  | 'fs.read' | 'fs.write'
  | 'network.fetch'
  | 'notification'
  | 'storage'
  | 'timer'
  | 'session.read' | 'session.write';

interface PluginContext {
  fs: FileSystemAPI;
  network: NetworkAPI;
  storage: StorageAPI;
  notification: NotificationAPI;
  timer: TimerAPI;
  session: SessionAPI;
  // Agent Assistant 新增
  agentContext?: {
    registerSlot(slot: ContextSlot): void;
    registerSkill(skill: Skill): void;
  };
  reportResult(result: ToolResult): void;
  reportError(error: Error): void;
}
```

### 内置插件（MVP）

| 插件 | 工具 | 权限 |
|------|------|------|
| Timer & Reminder | set_reminder, list_reminders, cancel_reminder | timer, notification, storage |
| Session Monitor | get_session_status, monitor_sessions, analyze_session_health | session.read, notification |
| Message Search | search_messages, summarize_session, export_session | session.read, fs.write |

---

## 7. 集成点

### WebSocket 消息（shared/src/index.ts）

新增 Client 消息：
- `agent_start`: 启动 agent（sessionId, input, model?, skills?, tools?）
- `agent_cancel`: 取消 agent
- `agent_steer`: 向子 agent 注入指令

新增 Server 消息：
- `agent_started`: agent 已启动（agentId, sessionId）
- `agent_status`: agent 状态更新（含子 agent 列表）

**复用现有消息类型**：`DeltaMessage`, `ToolUseMessage`, `ToolResultMessage`, `RunCompletedMessage` 等，`runId` 设为 `agentId`，前端无需修改渲染逻辑。

### Session（shared/src/index.ts:346）

扩展 `SessionType = 'regular' | 'background' | 'agent'`

Agent session 使用现有 `parentSessionId` 字段表示层级关系。

### 权限（server/src/agent/permission-evaluator.ts）

Agent 工具调用复用现有 `PermissionEvaluator`，高危工具（shell, browser）走 `PermissionRequestMessage` 流程请求用户确认。

### 插件事件（server/src/events/）

新增事件：`agent.started`, `agent.toolCall`, `agent.completed`, `agent.subAgentSpawned`

### server.ts 集成

在 `handleClientMessage` switch 中��增 case：
- `agent_start` → `handleAgentStart()`
- `agent_cancel` → `agentManager.kill()`
- `agent_steer` → `agentManager.steer()`

---

## 8. 数据库变更

**迁移文件**: `server/src/storage/migrations/042_agent_assistant.ts`

```sql
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_agent_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  task TEXT NOT NULL,
  total_turns INTEGER DEFAULT 0,
  total_tokens_in INTEGER DEFAULT 0,
  total_tokens_out INTEGER DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE agent_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, namespace, key)
);

CREATE TABLE agent_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,          -- 'builtin' | 'plugin' | 'user'
  plugin_id TEXT,
  file_path TEXT,
  metadata TEXT,                 -- JSON: triggers, requires, priority
  is_enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## 9. 文件结构

```
server/src/agent-assistant/
├── index.ts                    # 导出入口
├── runtime.ts                  # AgentRuntime: tool-call loop
├── agent-manager.ts            # AgentManager: spawn/steer/kill
├── types.ts                    # 所有接口定义
├── repository.ts               # agent_runs 表 CRUD
│
├── tools/
│   ├── types.ts                # 工具接口
│   ├── registry.ts             # AgentToolRegistry（包装现有 toolRegistry）
│   ├── shell.ts
│   ├── file-ops.ts
│   ├── http-request.ts
│   ├── memory.ts
│   ├── sub-agents.ts
│   ├── browser.ts
│   ├── email.ts
│   └── code-search.ts
│
├── context/
│   ├── engine.ts               # ContextEngine: slot 系统
│   ├── types.ts
│   └── providers/
│       ├── system-base.ts
│       ├── project-info.ts
│       ├── skills.ts
│       ├── memory.ts
│       └── summary.ts
│
└── skills/
    ├── loader.ts               # SkillLoader
    ├── types.ts
    └── packages/               # 内置 skill markdown
        ├── code-review/skill.md
        ├── git-workflow/skill.md
        ├── debugging/skill.md
        └── api-design/skill.md
```

需修改的现有文件：
- `shared/src/index.ts` — 新增消息类型，扩展 SessionType
- `server/src/server.ts` — 新增 agent_start/cancel/steer 消息处理
- `server/src/storage/db.ts` — 新增 migration 042
- `server/src/plugins/loader.ts` — 为插件提供 agentContext（注册 slot/skill）

---

## 10. 实施阶段

### Phase 1: 核心 Runtime + 基础工具
- types.ts + runtime.ts + agent-manager.ts（单 agent，无 sub-agent）
- DB migration 042
- shell + file-ops + http-request + memory 工具
- shared 消息类型扩展
- server.ts 集成 handleAgentStart

### Phase 2: Sub-Agent 编排
- sub-agents.ts 工具
- AgentManager 完整实现（spawn/steer/kill）
- Session 层级关系
- 前端 agent 状态展示

### Phase 3: Context Engine + Skills
- ContextEngine slot 系统 + 默认 providers
- SkillLoader + 内置 skill 包
- 插件集成（slot/skill 注册）

### Phase 4: 高级工具 + 打磨
- browser.ts（Playwright）
- email.ts, code-search.ts
- 前端 sub-agent 树可视化

### Phase 5: 用户插件支持
- 扫描 `~/.my-claudia/plugins/` 目录
- 热加载 + 沙箱模式
- 插件权限请求 UI

---

## 设计决策

| 决策点 | 选择 | 说明 |
|--------|------|------|
| Agent 执行方式 | 直接 Anthropic API | 不走 provider adapter，自己控制 tool-call loop |
| 任务规划 | 无独立 workflow 引擎 | 参考 OpenClaw，信任模型自己分解任务 |
| 工具注册 | 复用现有 toolRegistry | 已有 `agent-assistant` scope，无需另建 |
| Skills | Markdown prompt 包 | 非代码，安全、可审计、低门槛 |
| 上下文管理 | Slot 系统 + last-write-wins | 简单但够用，插件可替换核心 slot |
| 消息协议 | 复用现有 DeltaMessage 等 | 前端无需修改渲染逻辑 |
| 插件开发 | JavaScript/TypeScript | 延续 v1 决策 |
| 插件发现 | 渐进式（本地 → 商店） | 延续 v1 决策 |

---

## Open Questions（待讨论）

1. **API Key 管理**：Agent Assistant 直接调 Anthropic API 需要 key，如何获取？用 Claude CLI 的 OAuth？还是用户自行配置？
2. **模型选择**：默认用哪个模型？是否允许用户切换？（Agent 任务可能不需要最强模型）
3. **Token 成本控制**：Sub-agent 可能产生大量 API 调用，是否需要 budget 限制？
4. **与 Coding Flow 的协作**：Agent Assistant 是否能调用 Coding Flow？比如 agent 发现需要改代码时，能否 spawn 一个 coding session？
5. **插件安全**：第三方插件的沙箱边界？哪些 API 在沙箱中不可用？
6. **消息平台扩展**：未来 Telegram/Slack 等接入时，channel adapter 的设计（参考 OpenClaw 的 20+ 平台适配器模式）
