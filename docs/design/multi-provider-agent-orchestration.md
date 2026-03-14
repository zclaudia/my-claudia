# Multi-Provider Agent Orchestration Draft

## Goal

在现有 `Supervision V2`、`WorkflowEngine`、`ProviderConfig` 和桌面端任务面板的基础上，收敛一套适合 `my-claudia` 的多 provider、多 agent 协作草图。

这份草图的目标不是一次性引入"通用 agent 平台"，而是先把下面这件事做稳：

- 用户发起一个开发任务
- 系统根据角色把任务分配给不同 agent
- agent 通过结构化工件协作，而不是靠自由聊天
- UI 能展示计划、执行、审查、裁决四个阶段
- 未来可以继续接入更多 provider，而不重写调度逻辑

## Design Principles

- `provider` 和 `agent` 分离：provider 只是模型接入层，agent 才是可调度角色。
- 协作以 `task + artifact` 为中心，而不是 `chat + transcript`。
- 内部先用最小协议跑通，未来如有需要再映射到 A2A。
- 先做状态机式编排，不做开放式多 agent 群聊。
- 所有阶段都要能被人类中断、审查、重试、降级。
- 从第一版就内建可观测性（tracing），不事后补。

## Industry Reference

在设计过程中调研了业内主流多 agent 架构，以下是关键参考及对本项目的影响。

### LangGraph — 图编排模式

- Agent 系统建模为有向图，节点是函数，边定义控制流
- 状态在节点间显式传递，支持 checkpoint 持久化
- Supervisor 节点评估状态，条件路由到 worker 节点
- **借鉴**：`plan-execute-review` 本质就是一个 3 节点有向图，LangGraph 验证了这种模式在生产环境可行

### CrewAI — 角色团队模式

- Agent = 团队成员，有 role、goal、backstory
- 任务声明依赖关系形成隐式排序；层级模式下用 manager agent 做协调
- 通过 task 输出传递，不共享完整对话
- **借鉴**：`AgentDefinition` 的 role-based 设计与 CrewAI 高度一致，验证了角色抽象的合理性

### AutoGen (Microsoft) — 对话驱动模式

- v0.4 重写为 actor 模型，异步事件驱动
- 分层：Core（底层事件内核）→ AgentChat（高层 API）→ Extensions（集成插件）
- Group Chat Manager 编排对话轮次，支持 round-robin 或 LLM 选择下一个发言者
- **教训**：自由对话模式在 coding 场景容易发散失控。本项目"不做开放式群聊"的原则与此一致

### OpenAI Agents SDK — 极简 Handoff 模式

- Agent = instructions + functions，通过 handoff 转移控制权
- Guardrails：输入/输出校验与 agent 执行并行运行，tripwire 触发立即中断
- 内置全链路 Tracing（LLM 调用、工具调用、handoff、guardrails）
- **借鉴**：
  - Handoff 机制：step 之间显式声明上下文传递，比隐式状态机更清晰
  - Guardrails 并行校验：artifact 产出后立即校验，fast-fail 减少浪费
  - Tracing 是必须项，从第一版就要有

### MetaGPT — SOP 软件公司模式

- 核心思想：`Code = SOP(Team)`，把软件公司标准流程编码进 prompt
- 角色：Product Manager → Architect → Project Manager → Engineer，各有固定 SOP
- 通过 shared message pool（共享消息池）而非点对点通信
- 每个角色产出标准化文档（PRD、设计文档、代码、测试），下游角色消费
- **借鉴**：最接近本项目的框架。Artifact Bus 思路和 MetaGPT 的"结构化工件传递"一脉相承。在软件开发场景，SOP + 结构化工件 >> 自由对话

### Google A2A 协议 — 跨系统互操作标准

- 核心概念：Agent Card（能力声明）、Task（工作单元）、Artifact（结构化数据）、Message（通信）
- 基于 HTTP/SSE/JSON-RPC，支持长时间任务
- 定位：MCP 解决 agent-to-tool，A2A 解决 agent-to-agent
- **借鉴**：借鉴 Agent Card 概念让每个 agent 声明能力，为未来映射 A2A 留接口

### 设计定位总结

| 特性 | 本项目设计 | 最接近 | 差异 |
|------|-----------|--------|------|
| 编排模式 | 状态机 | LangGraph | 更简单，够用 |
| Agent 定义 | Role-based | CrewAI | 类似 |
| 通信方式 | Artifact Bus | MetaGPT | 一致 |
| 上下文隔离 | 不跨 agent 共享 transcript | Swarm | 一致 |
| 策略路由 | Policy | CrewAI hierarchical | 更灵活 |
| 可观测性 | Tracing + Guardrails | Agents SDK | 对齐 |

本质上是 **MetaGPT 的 SOP 工件思路 + LangGraph 的状态机编排 + CrewAI 的角色定义 + Agents SDK 的 Tracing/Guardrails**。

## What Already Exists

当前代码里已经有一些可以直接复用的骨架：

- `shared/src/index.ts`
  - `ProviderConfig`
  - `Project`
  - `Session`
  - `ProjectAgent`
  - `SupervisionTask`
  - `TaskResult`
- `server/src/services/supervisor-v2-service.ts`
  - 项目级 agent 生命周期
  - 任务轮询与调度入口
- `server/src/services/task-runner.ts`
  - 任务完成后的结果收集、工作流动作、review 触发
- `server/src/services/workflow-engine.ts`
  - 已有 DAG 执行模型，可复用为更通用的编排引擎
- `apps/desktop/src/components/supervision/TaskBoard.tsx`
  - 已有任务看板 UI，可扩展为多 agent 视图
- `apps/desktop/src/stores/supervisionStore.ts`
  - 已有任务/agent 的前端状态容器

换句话说，这次不是从零设计，而是在现有 supervision 系统上增加"多 provider、多角色、多工件"的层。

## Proposed Architecture

建议把系统拆成 6 层（在原有 5 层基础上新增 Tracing 层）。

### 1. Provider Adapter Layer

职责：屏蔽不同 provider 的 API、CLI、能力差异。

建议新增内部接口：

```ts
export interface ProviderAdapter {
  getMetadata(): ProviderMetadata;
  getCapabilities(): ProviderCapabilities;
  run(input: AgentInvocation): Promise<AgentInvocationResult>;
  stream?(input: AgentInvocation, onEvent: (event: AgentStreamEvent) => void): Promise<AgentInvocationResult>;
  cancel?(runId: string): Promise<void>;
}

export interface ProviderMetadata {
  providerId: string;
  type: ProviderType;
  name: string;
  transport: 'cli' | 'http' | 'sdk';
}

// MVP 只保留实际用到的能力字段，不预设未验证的布尔值
export interface ProviderCapabilities {
  tools: boolean;           // 是否支持工具调用
  structuredOutput: boolean; // 是否支持结构化输出
  patchOutput: boolean;      // 是否支持 diff/patch 输出
}
```

说明：

- 这里的输入输出不要暴露 OpenAI / Anthropic / Gemini 原生字段。
- `ProviderConfig` 继续保留为持久化配置；`ProviderAdapter` 是运行时能力封装。
- MVP 阶段 `ProviderCapabilities` 只保留 3 个实际影响调度决策的字段。`imageInput`、`longContext`、`reviewMode`、`planMode` 等能力等到真正需要路由时再添加，避免空转抽象。

### 2. Agent Registry Layer

职责：用"角色实例"代替"模型名"。

建议新增概念：

```ts
// MVP 只定义实际使用的 3 个角色
export type AgentRole =
  | 'planner'
  | 'executor'
  | 'reviewer';

export interface AgentDefinition {
  id: string;
  projectId: string;        // 项目私有，可从全局模板创建
  name: string;
  role: AgentRole;
  providerId: string;
  model?: string;
  enabled: boolean;
  priority: number;          // 同 role 多 agent 时的优先级
  toolPolicyId?: string;
  promptTemplateId?: string;
  costTier?: 'low' | 'medium' | 'high';
  createdAt: number;
  updatedAt: number;
}

// 借鉴 A2A Agent Card，用于能力发现和智能路由
export interface AgentCard {
  agentId: string;
  name: string;
  role: AgentRole;
  supportedInputArtifacts: ArtifactKind[];
  supportedOutputArtifacts: ArtifactKind[];
  estimatedLatency: 'fast' | 'medium' | 'slow';
  costTier: 'low' | 'medium' | 'high';
}
```

建议：

- 一个项目不应该只绑一个 `providerId`，而应该能绑定多个 `AgentDefinition`。
- `Project.agent` 继续存在，但它表示"项目监督器"，不再代表唯一 AI 执行者。
- `AgentDefinition` 为项目私有，但支持全局模板快速创建。用户在项目里配置自己的 agent 组合，但可以从全局模板一键导入。
- `AgentCard` 由 `AgentRegistry` 根据 `AgentDefinition` + `ProviderCapabilities` 自动生成，orchestrator 选 agent 时基于 card 匹配而非硬编码。

### 3. Orchestrator Layer

职责：接收用户任务，拆阶段，选 agent，汇总结果，做裁决。

推荐放在：

- `SupervisorV2Service` 上层继续做项目调度
- 新增 `AgentOrchestratorService` 处理单任务内的多 agent 协作

建议新增核心接口：

```ts
export interface OrchestrationRun {
  id: string;
  projectId: string;
  taskId: string;
  status: 'queued' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled';
  currentStage?: AgentStage;
  strategyId: string;
  maxRetries: number;        // 全局最大重试次数
  currentRetry: number;
  timeoutMs: number;         // 全局超时
  createdAt: number;
  updatedAt: number;
}

// MVP 只保留实际使用的 3 个阶段
export type AgentStage =
  | 'planning'
  | 'execution'
  | 'review';
```

#### Handoff 机制

借鉴 OpenAI Agents SDK，在 step 之间加显式 handoff，让上下文传递可追踪：

```ts
export interface StepHandoff {
  fromAgentId: string;
  toAgentId: string;
  artifactIds: string[];     // 只传工件引用，不传 transcript
  contextOverrides?: Record<string, unknown>;
}
```

Orchestrator 只管调度，上下文传递由 handoff 显式声明。

### 4. Artifact Bus Layer

职责：agent 之间交换结构化结果，而不是整段自然语言。

建议的最小工件类型：

```ts
export type ArtifactKind =
  | 'task_brief'
  | 'context_snapshot'
  | 'plan'
  | 'patch'
  | 'test_report'
  | 'review'
  | 'decision'
  | 'evidence';

export interface TaskArtifact {
  id: string;
  taskId: string;
  runId: string;
  kind: ArtifactKind;
  producerAgentId?: string;
  format: 'json' | 'markdown' | 'diff' | 'text';
  // 小工件直接存内容，大工件存文件路径
  content?: string;          // plan / review / decision 等小工件
  filePath?: string;         // patch / test_report 等大工件
  summary?: string;
  sizeBytes?: number;
  createdAt: number;
}
```

最重要的一点：

- 共享给下游 agent 的应该是 `plan`、`patch`、`review`、`test_report`
- 不应该是完整 session transcript

#### 存储策略

- `plan` / `review` / `decision` / `evidence`：直接存 DB `content` 字段（通常 < 10KB）
- `patch` / `test_report` / `context_snapshot`：存文件系统（`~/.my-claudia/artifacts/{runId}/`），DB 只存 `filePath` + `summary`
- 阈值：content 超过 50KB 自动落文件系统

### 5. Policy Layer

职责：决定"哪个任务应该走哪种协作策略"。

建议单独抽象：

```ts
export interface OrchestrationPolicy {
  id: string;
  name: string;
  when: {
    projectType?: ProjectType[];
    taskKinds?: string[];
    maxScopeFiles?: number;
    requiresReview?: boolean;
  };
  strategyId: string;
  fallbackStrategyId?: string;
}
```

#### Stage Contract（借鉴 MetaGPT SOP）

每个 stage 定义输入输出契约，让 orchestrator 能自动校验：

```ts
export interface StageContract {
  stage: AgentStage;
  requiredInputArtifacts: ArtifactKind[];
  requiredOutputArtifacts: ArtifactKind[];
  outputSchema?: JSONSchema;  // 可选的结构化输出校验
  maxRetries: number;
  timeoutMs: number;
}
```

`plan-execute-review` 策略的 contracts：

| Stage | 输入 | 输出 | 超时 | 重试 |
|-------|------|------|------|------|
| planning | `task_brief` | `plan` | 120s | 2 |
| execution | `plan` | `patch`, `test_report` | 600s | 1 |
| review | `plan`, `patch`, `test_report` | `review` | 120s | 2 |

第一版不需要很智能，支持固定路由即可。

### 6. Tracing Layer（新增）

职责：全链路可观测性，记录每次编排的完整执行轨迹。

借鉴 OpenAI Agents SDK 的 tracing 设计，从第一版就内建：

```ts
export interface OrchestrationTrace {
  runId: string;
  projectId: string;
  taskId: string;
  totalDurationMs: number;
  totalTokenUsage: TokenUsage;
  totalCost?: number;
  steps: TraceStep[];
  createdAt: number;
}

export interface TraceStep {
  stepId: string;
  agentId: string;
  stage: AgentStage;
  status: OrchestrationStepStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  tokenUsage?: TokenUsage;
  cost?: number;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  guardResult?: GuardResult;
  error?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface GuardResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message?: string;
  }>;
}
```

存储：一张 `orchestration_traces` 表即可，`steps` 以 JSON 存储。不需要 OpenTelemetry，够用就好。

用途：

- 调试：哪个 step 失败了、为什么
- 成本核算：每次编排花了多少 token
- 性能分析：哪个 agent 最慢
- UI 展示：给用户看编排进度和历史

## Recommended MVP Strategy

建议第一版只做一个策略：`plan-execute-review`。

### Strategy: `plan-execute-review`

角色分工：

- `planner`
  - 读取任务、上下文摘要、相关文件
  - 输出结构化 `plan`
- `executor`
  - 根据 `plan` 改代码、跑命令
  - 输出 `patch` 和 `test_report`
- `reviewer`
  - 只看 `plan`、`patch`、`test_report`
  - 输出 `review`（包含 verdict）

第一版不启用独立 `judge`，系统按 reviewer verdict 直接结束。

## State Machine

建议在 `SupervisionTask.status` 之上，再加一层细粒度运行状态，不要把所有信息都塞进现有 `TaskStatus`。

### Existing TaskStatus

现有状态仍然保留：

- `pending`
- `queued`
- `planning`
- `running`
- `reviewing`
- `approved`
- `integrated`
- `blocked`
- `failed`

### Proposed Run State

```ts
export type OrchestrationStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'timed_out'
  | 'waiting_user';

export interface AgentStepRun {
  id: string;
  runId: string;
  taskId: string;
  stage: AgentStage;
  agentId: string;
  status: OrchestrationStepStatus;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  handoff?: StepHandoff;
  inputGuard?: GuardResult;
  outputGuard?: GuardResult;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}
```

### State Transition Table

明确所有合法状态转换，避免隐式边界 case：

| 当前状态 | 事件 | 下一状态 | 条件 |
|---------|------|---------|------|
| `pending` | orchestrator 调度 | `running` | agent 可用 |
| `running` | agent 正常完成 | output guard 校验 | — |
| `running` | agent 超时 | `timed_out` | 超过 `timeoutMs` |
| `running` | agent 异常 | `failed` | — |
| output guard 通过 | — | `completed` | — |
| output guard 失败 | — | `failed` 或重试 | `retryCount < maxRetries` 则重试 |
| `failed` | 重试 | `pending` | `retryCount < maxRetries` |
| `failed` | 无法重试 | fallback agent | 同 role 有备选 |
| `failed` | 无备选 | `waiting_user` | 转人工 |
| `timed_out` | — | `failed` | 按 failed 处理 |

### 状态流

1. `SupervisionTask.status = planning`
2. planner step 完成后写入 `plan`，output guard 校验 plan 结构
3. handoff: planner → executor，传递 `plan` artifact
4. `SupervisionTask.status = running`
5. executor step 完成后写入 `patch` / `test_report`，output guard 校验（lint/type-check）
6. handoff: executor → reviewer，传递 `plan + patch + test_report`
7. `SupervisionTask.status = reviewing`
8. reviewer step 完成后写入 `review`
9. 根据 review verdict：
   - `approved` → 任务完成
   - `needs_changes` 且 `retryCount < maxRetries` → 回到 `running`（带 review feedback）
   - `needs_changes` 且已达上限 → `waiting_user`
   - `blocked` → `blocked`
   - reviewer 无法得出结论 → `blocked`

**最大重试次数**：`needs_changes` 回到 `running` 最多 2 次（可配置），防止无限循环。

## Context Model

多 agent 协作最容易失控的地方是上下文传递，所以建议明确区分 3 类上下文。

### 1. Shared Task Brief

给所有 agent：

- 任务标题
- 任务描述
- 验收标准
- 相关文件列表
- 风险提示

### 2. Stage-Specific Context

只给当前角色，通过 handoff 显式传递：

- planner: 架构约束、目录结构、历史任务摘要
- executor: plan artifact、相关代码片段、工作目录、工具权限
- reviewer: plan + patch + test_report artifacts、base_commit、acceptance criteria

### 3. Session Transcript

默认不跨 agent 共享。只在 debug 模式或人工介入时查看。

## Data Model Changes

### Shared Types

建议新增文件：

- `shared/src/orchestration.ts`

建议导出：

- `ProviderCapabilities`
- `AgentRole`
- `AgentDefinition`
- `AgentCard`
- `OrchestrationRun`
- `AgentStepRun`
- `StepHandoff`
- `TaskArtifact`
- `ArtifactKind`
- `StageContract`
- `OrchestrationPolicy`
- `OrchestrationTrace`
- `TraceStep`
- `GuardResult`

### Extend Existing Types Carefully

建议小步扩展现有类型，而不是大改：

```ts
export interface Project {
  // existing fields...
  orchestrationPolicyId?: string;
}

export interface SupervisionTask {
  // existing fields...
  orchestrationRunId?: string;
  preferredStrategyId?: string;
  preferredAgentIds?: string[];
}

export interface TaskResult {
  // existing fields...
  artifactIds?: string[];
  decision?: 'approved' | 'needs_changes' | 'blocked';
}
```

## Server-Side Components

建议新增以下服务：

### `server/src/services/provider-adapter-registry.ts`

职责：

- 注册 provider adapter
- 暴露能力查询
- 根据 providerId 获取 adapter

### `server/src/services/agent-registry.ts`

职责：

- 管理项目级 agent definitions
- 根据 role 查找候选 agent
- 生成 AgentCard
- 支持启停和优先级排序
- 支持从全局模板创建项目 agent

### `server/src/services/agent-orchestrator-service.ts`

职责：

- 创建 `OrchestrationRun`
- 执行阶段状态机
- 管理 handoff
- 执行 guardrails（input/output guard）
- 写入和读取 artifact
- 失败重试和 fallback
- 超时控制
- 触发人工确认
- 写入 trace

### `server/src/repositories/task-artifact.ts`

职责：

- 存储结构化工件
- 大工件自动落文件系统
- 支持按任务、运行、类型检索

### `server/src/repositories/agent-definition.ts`

职责：

- 持久化项目级 agent 配置
- 全局模板管理

### `server/src/repositories/orchestration-trace.ts`

职责：

- 存储编排执行轨迹
- 支持按项目、任务、时间范围查询
- 支持成本和 token 统计

## Guardrails

借鉴 OpenAI Agents SDK，guardrails 与 agent 执行解耦，支持 fast-fail：

### Input Guard

在 agent 接收输入前校验：

- planner: task_brief 是否完整（有标题、描述、验收标准）
- executor: plan 是否为有效结构化格式
- reviewer: patch 和 test_report 是否存在

### Output Guard

在 agent 产出后校验：

- planner: plan 是否包含必要字段（steps、scope、risk）
- executor: patch 是否能 apply，test_report 是否包含通过/失败统计
- reviewer: review 是否包含 verdict（approved / needs_changes / blocked）

校验失败直接 fast-fail，触发重试或 fallback，不浪费下游 agent 调用。

## Frontend Changes

前端不应该只显示"任务状态"，而应该显示"哪个 agent 在做什么"。

建议扩展现有 supervision UI：

### TaskBoard

保留当前分组，但在任务卡片上增加：

- 当前阶段：Planning / Executing / Reviewing
- 当前执行 agent
- 最近产物摘要

### TaskDetail

增加 3 个区域（对应 MVP 的 3 个 stage）：

- `Plan`：展示 plan artifact
- `Execution`：展示 patch + test_report
- `Review`：展示 review artifact + verdict

每个区域展示对应 artifact，而不是只展示日志。

增加 Trace 视图：展示编排的完整执行轨迹（耗时、token、成本）。

### Agent Status Bar

扩展为：

- 本项目有哪些 agent
- 每个 agent 的 role / provider / 状态
- 是否启用
- 当前是否繁忙

## Suggested Execution Flow

建议第一版的一条完整链路如下：

1. 用户创建 `SupervisionTask`
2. `SupervisorV2Service` 选择策略 `plan-execute-review`
3. `AgentOrchestratorService` 创建 `OrchestrationRun`，开始写 trace
4. Input guard 校验 task_brief
5. Planner agent 生成 `plan` artifact
6. Output guard 校验 plan 结构
7. Handoff: planner → executor，传递 plan
8. Executor agent 消费 `plan`，生成 `patch` 和 `test_report`
9. Output guard 校验 patch 和 test_report
10. Handoff: executor → reviewer，传递 plan + patch + test_report
11. Reviewer agent 消费工件，生成 `review`
12. 系统将 reviewer verdict 映射回 `TaskResult`
13. Trace 完成写入
14. UI 展示 artifacts、verdict 和 trace

## Failure and Fallback

多 provider 场景下，失败处理必须是一级能力。

建议第一版支持这几类 fallback：

- provider 调用失败：同 role 换备用 agent（按 priority 排序）
- 结构化输出 guard 校验失败：同 agent 重试一次（带错误提示）
- agent 超时：按失败处理，触发 fallback
- executor 修改失败：转人工确认
- reviewer 无法得出结论：直接标记 `blocked`
- review 判定 needs_changes：回到 executor（最多 2 次），超限转人工

不要在第一版做复杂的 agent 互相辩论。

### 超时机制

两层超时控制：

- **单步超时**：由 `StageContract.timeoutMs` 定义，每个 stage 独立超时
- **全局超时**：由 `OrchestrationRun.timeoutMs` 定义，整个编排的总时间上限
- 超时后立即取消当前 agent 调用，写入 trace，触发 fallback 或转人工

## Permissions

权限建议按 role 控制，而不是按 provider 控制。

建议：

- `planner`
  - 只读文件
  - 搜索代码
  - 禁止修改
- `executor`
  - 可编辑文件
  - 可跑受限命令
  - 可创建 worktree
- `reviewer`
  - 只读 diff、测试结果、关键文件
  - 禁止写入

这跟现有 `PermissionPolicy` / `AgentPermissionPolicy` 思路一致，只是粒度从"项目"下沉到"角色"。

## Why This Fits Current Code

这版草图和现有实现兼容，原因是：

- `SupervisionTask` 已经是任务中心对象
- `SupervisorV2Service` 已经是调度入口
- `TaskRunner` 已经承担执行后处理
- `WorkflowEngine` 已经提供 DAG 式执行思路
- 桌面端已有任务看板与 agent 状态展示入口

所以最自然的演进路线不是重写，而是：

1. 先新增 artifact 和 agent definition
2. 再在 server 里补 orchestrator
3. 最后扩展 supervision UI

## Recommended Implementation Order

### Phase 1: Protocol and Storage

- 新增 `shared/src/orchestration.ts`（3 个角色，4 种核心 artifact）
- 新增 `orchestration_runs` 表（合并 run + steps，steps 以 JSON 存储）
- 新增 `task_artifacts` 表（小工件 content 入库，大工件 filePath 指向文件系统）
- 新增 `agent_definitions` 表
- 新增 `orchestration_traces` 表
- 给 `SupervisionTask` 增加最少关联字段

### Phase 2: Server Orchestrator

- 新增 provider adapter registry
- 新增 agent registry（含 AgentCard 生成）
- 新增 `AgentOrchestratorService`
  - 先硬编码 `plan-execute-review` 流程，不做策略抽象
  - 实现 handoff 机制
  - 实现基础 guardrails
  - 实现超时控制
  - 实现 trace 写入

### Phase 3: UI

- 在 TaskDetail 里加 Artifacts tab（展示 plan / patch / review）
- 在 TaskDetail 里加 Trace 视图
- 在 TaskBoard 卡片上展示当前 stage 和 agent
- 增加 agent 配置入口

### Phase 4: Smarter Routing

- 支持按角色选 provider（基于 AgentCard 匹配）
- 支持 fallback（同 role 备用 agent）
- 支持更多策略
- 支持全局模板管理

## Non-Goals for MVP

第一版明确不做：

- agent 自由群聊
- 自动多轮辩论
- 跨项目共享 agent 内存
- A2A 原生接入
- 全自动成本优化
- `researcher` / `tester` / `judge` 角色（等到真正需要时再加）
- OpenTelemetry 集成（自建 trace 表够用）

这些都可以以后再加。

## Resolved Design Decisions

以下问题在调研后已确定方案：

1. **`AgentDefinition` 全局 vs 项目私有** → 项目私有，支持全局模板。用户在项目里配置自己的 agent 组合，可从全局模板快速创建。
2. **`reviewer` 是否允许直接触发重新执行** → 不允许。Reviewer 只输出 verdict，Orchestrator 决定是否重试（最多 2 次）。
3. **`judge` 是否单独建角色** → 第一版不建。系统按 reviewer verdict 自动结束，减少不必要的抽象。
4. **`artifact.content` 存储策略** → 混合策略。小工件（plan/review/decision）直接入 DB，大工件（patch/test_report）存文件系统，DB 存路径和摘要。阈值 50KB。

## Open Questions

仍需后续确认的问题：

1. 全局模板的管理 UI 放在哪里（设置页 vs 独立页面）
2. Trace 数据的保留策略（多久清理一次）
3. 多个 executor 并行执行同一任务的不同子计划是否在 MVP 范围内

## Recommended First Concrete Slice

如果要开始实现，建议第一刀只做下面这些：

- `shared`: 新增 `orchestration.ts`（类型定义，3 个角色，4 种核心 artifact）
- `server`: 新增 `AgentDefinitionRepository` 与 `TaskArtifactRepository`
- `server`: 新增 `OrchestrationTraceRepository`
- `server`: 新增 `AgentOrchestratorService`（硬编码 plan-execute-review）
- `desktop`: 在 `TaskDetail` 里显示 `plan` / `review` artifact
- `desktop`: 在 `TaskDetail` 里显示 trace 概览

这样做的收益是：

- 一周内可以看到端到端闭环
- 不会破坏现有 supervision 流程
- 后续接更多 provider 也不会推翻当前设计
- 从第一天就有可观测性

## References

- [LangGraph — 图编排模式](https://langchain-ai.github.io/langgraph/)
- [CrewAI — 角色团队模式](https://docs.crewai.com/)
- [AutoGen — 对话驱动模式](https://microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/)
- [OpenAI Agents SDK — Handoff & Guardrails & Tracing](https://openai.github.io/openai-agents-python/)
- [MetaGPT — SOP 软件公司模式](https://github.com/FoundationAgents/MetaGPT)
- [Google A2A 协议](https://a2a-protocol.org/latest/)
