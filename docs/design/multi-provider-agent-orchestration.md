# Multi-Provider Agent Orchestration Draft

## Goal

在现有 `Supervision V2`、`WorkflowEngine`、`ProviderConfig` 和桌面端任务面板的基础上，收敛一套适合 `my-claudia` 的多 provider、多 agent 协作草图。

这份草图的目标不是一次性引入“通用 agent 平台”，而是先把下面这件事做稳：

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

换句话说，这次不是从零设计，而是在现有 supervision 系统上增加“多 provider、多角色、多工件”的层。

## Proposed Architecture

建议把系统拆成 5 层。

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

export interface ProviderCapabilities {
  tools: boolean;
  imageInput: boolean;
  structuredOutput: boolean;
  longContext: boolean;
  backgroundTasks: boolean;
  reviewMode: boolean;
  planMode: boolean;
  patchOutput: boolean;
}
```

说明：

- 这里的输入输出不要暴露 OpenAI / Anthropic / Gemini 原生字段。
- `ProviderConfig` 继续保留为持久化配置；`ProviderAdapter` 是运行时能力封装。

### 2. Agent Registry Layer

职责：用“角色实例”代替“模型名”。

建议新增概念：

```ts
export type AgentRole =
  | 'planner'
  | 'researcher'
  | 'executor'
  | 'tester'
  | 'reviewer'
  | 'judge';

export interface AgentDefinition {
  id: string;
  name: string;
  role: AgentRole;
  providerId: string;
  model?: string;
  enabled: boolean;
  priority: number;
  capabilities: Partial<ProviderCapabilities>;
  toolPolicyId?: string;
  promptTemplateId?: string;
  costTier?: 'low' | 'medium' | 'high';
  reliability?: number;
  createdAt: number;
  updatedAt: number;
}
```

建议：

- 一个项目不应该只绑一个 `providerId`，而应该能绑定多个 `AgentDefinition`。
- `Project.agent` 继续存在，但它表示“项目监督器”，不再代表唯一 AI 执行者。

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
  createdAt: number;
  updatedAt: number;
}

export type AgentStage =
  | 'planning'
  | 'research'
  | 'execution'
  | 'testing'
  | 'review'
  | 'judgement';
```

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
  content: string;
  summary?: string;
  createdAt: number;
}
```

最重要的一点：

- 共享给下游 agent 的应该是 `plan`、`patch`、`review`、`test_report`
- 不应该是完整 session transcript

### 5. Policy Layer

职责：决定“哪个任务应该走哪种协作策略”。

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

第一版不需要很智能，支持固定路由即可。

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
  - 输出 `review`
- `judge`
  - 决定 `approved` / `needs_changes` / `blocked`

第一版甚至可以不启用独立 `judge`，让系统按 reviewer verdict 直接结束。

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
  startedAt?: number;
  completedAt?: number;
  error?: string;
}
```

状态流建议如下：

1. `SupervisionTask.status = planning`
2. planner step 完成后写入 `plan`
3. `SupervisionTask.status = running`
4. executor step 完成后写入 `patch` / `test_report`
5. `SupervisionTask.status = reviewing`
6. reviewer step 完成后写入 `review`
7. 根据 review 进入：
   - `approved`
   - `blocked`
   - `failed`
   - 或重新回到 `running`

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

只给当前角色：

- planner: 架构约束、目录结构、历史任务摘要
- executor: plan、相关代码片段、工作目录、工具权限
- reviewer: patch、test_report、base_commit、acceptance criteria

### 3. Session Transcript

默认不跨 agent 共享。只在 debug 模式或人工介入时查看。

## Data Model Changes

### Shared Types

建议新增文件：

- `shared/src/orchestration.ts`

建议导出：

- `ProviderCapabilities`
- `AgentDefinition`
- `OrchestrationRun`
- `AgentStepRun`
- `TaskArtifact`
- `OrchestrationPolicy`

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
- 支持启停和优先级排序

### `server/src/services/agent-orchestrator-service.ts`

职责：

- 创建 `OrchestrationRun`
- 执行阶段状态机
- 写入和读取 artifact
- 失败重试
- 触发人工确认

### `server/src/repositories/task-artifact.ts`

职责：

- 存储结构化工件
- 支持按任务、运行、类型检索

### `server/src/repositories/agent-definition.ts`

职责：

- 持久化项目级 agent 配置

## Frontend Changes

前端不应该只显示“任务状态”，而应该显示“哪个 agent 在做什么”。

建议扩展现有 supervision UI：

### TaskBoard

保留当前分组，但在任务卡片上增加：

- 当前阶段：Planning / Running / Reviewing
- 当前执行 agent
- 最近产物摘要

### TaskDetail

增加 4 个区域：

- `Plan`
- `Execution`
- `Review`
- `Decision`

每个区域展示对应 artifact，而不是只展示日志。

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
3. `AgentOrchestratorService` 创建 `OrchestrationRun`
4. planner agent 生成 `plan` artifact
5. executor agent 消费 `plan`，生成 `patch` 和 `test_report`
6. reviewer agent 消费 `plan + patch + test_report`，生成 `review`
7. 系统将 reviewer 结果映射回 `TaskResult`
8. UI 展示 artifacts 和最终结论

## Failure and Fallback

多 provider 场景下，失败处理必须是一级能力。

建议第一版支持这几类 fallback：

- provider 调用失败：同 role 换备用 agent
- 结构化输出校验失败：同 agent 重试一次
- executor 修改失败：转人工确认
- reviewer 无法得出结论：直接标记 `blocked`

不要在第一版做复杂的 agent 互相辩论。

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
- `judge`
  - 不需要 shell 权限

这跟现有 `PermissionPolicy` / `AgentPermissionPolicy` 思路一致，只是粒度从“项目”下沉到“角色”。

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

- 新增 shared orchestration types
- 新增 `agent_definitions` 表
- 新增 `task_artifacts` 表
- 给 `SupervisionTask` 增加最少关联字段

### Phase 2: Server Orchestrator

- 新增 provider adapter registry
- 新增 agent registry
- 新增 `AgentOrchestratorService`
- 先只实现 `plan-execute-review`

### Phase 3: UI

- 扩展 TaskBoard / TaskDetail
- 展示 stage、agent、artifact
- 增加 agent 配置入口

### Phase 4: Smarter Routing

- 支持按角色选 provider
- 支持 fallback
- 支持更多策略

## Non-Goals for MVP

第一版明确不做：

- agent 自由群聊
- 自动多轮辩论
- 跨项目共享 agent 内存
- A2A 原生接入
- 全自动成本优化

这些都可以以后再加。

## Open Questions

这版草图还有 4 个关键决策需要后续确认：

1. `AgentDefinition` 是全局共享还是项目私有
2. `reviewer` 是否允许直接触发重新执行
3. `judge` 是否单独建角色，还是先由系统规则代替
4. `artifact.content` 是否直接入库，还是大内容落文件系统

## Recommended First Concrete Slice

如果要开始实现，我建议第一刀只做下面这些：

- `shared`: 新增 orchestration types
- `server`: 新增 `AgentDefinitionRepository` 与 `TaskArtifactRepository`
- `server`: 新增 `AgentOrchestratorService`
- `desktop`: 在 `TaskDetail` 里显示 `plan` / `review` artifact

这样做的收益是：

- 可以最快看到多 agent 协作闭环
- 不会破坏现有 supervision 流程
- 后续接更多 provider 也不会推翻当前设计
