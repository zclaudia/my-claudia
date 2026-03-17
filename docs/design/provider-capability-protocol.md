# Provider Capability Protocol (PCP) v1

## Status

- Status: Draft
- Owners: MyClaudia
- Target Version: `pcp/v1`
- Scope: Server provider runtime, plugin-loaded providers, unified interaction layer

---

## 1. Background

MyClaudia 当前已经有多 provider 架构，也已经开始有统一交互协议和插件平台基础：

- provider 运行入口目前由 `server/src/providers/*` 和 `server/src/providers/registry.ts` 管理
- 插件平台基础类型已经定义在 `shared/src/plugin-types.ts`
- 统一交互方向已经在 `docs/design/unified-provider-interaction-protocol.md` 中明确

但当前 provider 集成仍然存在几个结构性问题：

1. provider 的“能力边界”没有显式建模
2. 适配层以 provider type 为中心，而不是以 capability 为中心
3. 前后端仍然容易被 provider 私有事件、工具名、字段结构拖着走
4. 很难把 provider 从内建适配器演进为可动态加载插件
5. 同一个 provider 在不同模型、CLI 版本、桥接模式下的有效能力不同，但当前没有运行期协商模型

本设计将这些问题收敛为一套协议：

- **PCP = Provider Capability Protocol**

PCP 的核心思想不是定义“怎么接某个厂商 SDK”，而是定义：

- provider 如何声明自己是谁
- provider 支持哪些标准能力
- 每种能力的契约是什么
- server 如何在运行期协商这些能力
- 前端和上层服务如何只依赖 MyClaudia 自己的统一语义

---

## 2. Goals

### 2.1 Primary Goals

- 用标准 capability 替代按 provider type 硬编码分支
- 为 provider 插件化提供稳定协议边界
- 让 server 能基于 capability 做路由、校验、降级和观测
- 让前端只消费 MyClaudia 统一事件，不直接依赖 provider 原始事件
- 让“能力支持”从静态概念变成可协商、可观测、可降级的运行期事实

### 2.2 Secondary Goals

- 让 provider 接入成本降低到“实现一组能力接口 + 提供 manifest”
- 让新增 provider 不再要求前端新增特判
- 为后续 provider marketplace / provider plugin system 做准备
- 为测试矩阵提供正式维度：按 capability 测，而不是按 provider 名字测

### 2.3 Non-Goals

- 不追求所有 provider 在底层能力上完全等价
- 不要求所有 provider 原生支持结构化交互
- 不试图统一上游厂商内部 SDK 语义
- 不在 v1 里定义跨应用、跨厂商的开放标准
- 不在 v1 里直接替换现有全部 `tool_use` / `tool_result` 事件链路

---

## 3. Design Principles

### 3.1 Capability-first, Not Provider-first

上层系统关注的是“能做什么”，不是“它是谁”。  
例如：

- 是否能流式输出
- 是否能注册工具
- 是否能发起结构化审批
- 是否支持中断和恢复

而不是：

- Claude 怎么办
- Codex 怎么办
- Cursor 怎么办

### 3.2 Server Owns Semantic Normalization

provider 只负责产出原始能力结果，server 负责：

- schema 校验
- capability 路由
- 交互归一化
- 降级决策
- 统一事件广播

前端不应消费 provider-specific 语义。

### 3.3 Explicit Capability Negotiation

manifest 里的能力声明只是“理论支持”。  
真正用于一次 run 的，是运行期协商得到的 **Effective Provider Profile**。

### 3.4 Explicit Degradation

不支持某能力时，必须有明确降级策略。  
不能静默地把事务型能力退化成自然语言文本，再假装系统“支持”。

### 3.5 Contract Per Capability

每个 capability 必须有独立的输入输出契约。  
避免继续膨胀一个万能的 `ProviderAdapter` 接口。

### 3.6 Stable Internal Semantics

即使 provider 内部实现变化，MyClaudia 对上暴露的语义仍然稳定：

- interaction events
- tool lifecycle
- run lifecycle
- errors
- capability availability

---

## 4. Key Concepts

### 4.1 Provider

一个可被 MyClaudia 加载并参与 run 的 AI 后端实现。  
provider 可以基于：

- CLI
- SDK
- HTTP API
- 本地 bridge
- 远程 gateway / relay

### 4.2 Capability

provider 可声明的一项标准能力。  
能力是协议级单元，不是实现细节。

### 4.3 Capability Contract

某项能力对应的输入输出 schema、生命周期事件、错误模型和限制。

### 4.4 Manifest

provider 插件的静态元信息，包括：

- 身份
- 版本
- 入口
- 能力声明
- 配置 schema
- 模型/特性元信息

### 4.5 Effective Provider Profile

一次 run 或 session 上下文下，server 根据环境、模型、桥接状态、版本等因素协商出的最终有效能力快照。

### 4.6 Native / Bridged / Emulated

- `native`: provider 原生支持
- `bridged`: 通过 MyClaudia 注入桥接能力实现
- `emulated`: 通过 server 弱模拟或兼容层实现

这个区分很重要，因为相同 capability 在三种模式下可靠性、交互性、事务性都不同。

---

## 5. Architecture Positioning

PCP 位于三层之间：

1. provider implementation layer
2. server runtime / normalization layer
3. frontend unified interaction / run UI layer

数据流：

1. provider 插件通过 manifest 声明能力
2. server 加载 provider module
3. run 启动时 server 协商 `EffectiveProviderProfile`
4. 上层根据 capability 调用对应 contract
5. provider 返回原始事件或结构化结果
6. server 归一化成 MyClaudia 统一语义
7. frontend 只消费统一语义

---

## 6. Capability Taxonomy

v1 建议把能力拆成以下 8 类。

### 6.1 Core Chat

- `chat.generate`
  - 非流式生成
- `chat.stream`
  - 流式生成

### 6.2 Tooling

- `tool.define`
  - 在 provider 运行前动态注册工具 schema
- `tool.call`
  - provider 发起结构化工具调用

### 6.3 Structured Interaction

- `interaction.form`
  - 结构化问答 / 表单
- `interaction.approval`
  - 审批 / 确认
- `interaction.todo`
  - todo / plan 状态更新

### 6.4 Session Control

- `session.control`
  - abort / stop task / resume / checkpoint / background task control

---

## 7. Capability Definitions

### 7.1 `chat.generate`

表示 provider 支持基于统一消息输入生成完整回复。

**Typical uses**

- plugin 通过 `ProviderAPI.call()` 发起单次推理
- workflow step 执行一次非流式模型调用
- review / summarize 等后台逻辑

**Requirements**

- 接收统一消息数组
- 支持基础 generation options
- 返回完整内容和可选 usage
- 明确返回 model identity

### 7.2 `chat.stream`

表示 provider 支持流式输出事件。

**Requirements**

- 支持增量内容输出
- 支持终态事件
- 错误不可吞掉，必须显式发出
- 如可提供 usage，则在终态或中途发出

### 7.3 `tool.define`

表示 provider 支持在 run 启动前接收一组工具 schema，并在模型侧以结构化方式暴露。

**Requirements**

- 接收统一 `ToolSchema[]`
- 返回注册结果或注册失败原因
- 如 provider 不支持运行中动态增量注册，则需要在限制中声明

### 7.4 `tool.call`

表示 provider 可以发起结构化工具调用事件。

**Requirements**

- 工具调用必须有稳定的 call id
- 参数必须是结构化 JSON，不接受只靠文本解析
- 必须支持 tool result 回填或明确声明不支持回填

### 7.5 `interaction.form`

表示 provider 可以可靠地产生或消费结构化用户表单交互。

在 MyClaudia 内部应映射到：

- `ask_user_form`

### 7.6 `interaction.approval`

表示 provider 可以可靠地产生或消费结构化审批交互。

在 MyClaudia 内部应映射到：

- `request_approval`

### 7.7 `interaction.todo`

表示 provider 可以可靠地产生结构化 todo / plan 更新。

在 MyClaudia 内部应映射到：

- `update_todo_list`

### 7.8 `session.control`

表示 provider 支持会话级控制操作。

典型能力包括：

- abort 当前 run
- stop 指定 task
- resume session
- 获取 provider-specific run state

v1 不要求所有子能力都支持，但必须在限制中明确声明。

---

## 8. Capability Reliability Model

仅仅知道“支持/不支持”还不够，PCP 还需要表达可靠性级别。

```ts
type CapabilityMode = 'native' | 'bridged' | 'emulated';

type ReliabilityTier = 'strict' | 'best_effort' | 'display_only';
```

建议语义：

- `strict`
  - 事务性语义可靠
  - 可用于需要回填、审批、状态一致性的流程
- `best_effort`
  - 通常可用，但存在 provider 行为不稳定或桥接限制
- `display_only`
  - 只适合展示，不应驱动事务逻辑

示例：

- Claude 的 `interaction.approval` 可能是 `native + strict`
- Codex 的 `tool.call` 可能是 `native + best_effort`
- Cursor 的 `interaction.todo` 可能是 `emulated + display_only`

---

## 9. Manifest Schema

PCP v1 建议定义如下 manifest。

```ts
export type ProviderRuntimeKind = 'cli' | 'sdk' | 'http' | 'bridge';

export type ProviderCapabilityId =
  | 'chat.generate'
  | 'chat.stream'
  | 'tool.define'
  | 'tool.call'
  | 'interaction.form'
  | 'interaction.approval'
  | 'interaction.todo'
  | 'session.control';

export interface ProviderManifest {
  id: string;                  // e.g. com.myclaudia.provider.claude
  name: string;
  version: string;             // provider plugin version
  apiVersion: 'pcp/v1';

  providerType: string;        // logical type, e.g. claude/codex
  runtime: ProviderRuntimeKind;
  entry: string;               // module entry

  providerVersion?: string;    // upstream cli/sdk version if known
  description?: string;

  capabilities: ProviderCapabilityDescriptor[];
  models?: ProviderModelDescriptor[];

  configSchema?: Record<string, unknown>;
  engines?: {
    claudia: string;
  };

  experimental?: boolean;
}

export interface ProviderCapabilityDescriptor {
  id: ProviderCapabilityId;
  version: '1.0';
  supported: boolean;
  mode?: CapabilityMode;
  reliability?: ReliabilityTier;
  limits?: Record<string, string | number | boolean>;
  notes?: string;
}

export interface ProviderModelDescriptor {
  id: string;
  label?: string;
  contextWindow?: number;
  default?: boolean;
  capabilities?: Partial<Record<ProviderCapabilityId, boolean>>;
}
```

### 9.1 Manifest Rules

- `capabilities` 里只能声明 PCP 已知 capability id
- `supported = false` 的 capability 可以省略，但推荐显式声明关键缺失能力
- `models[].capabilities` 用于描述模型级覆盖，不替代 provider 级声明
- `configSchema` 只描述配置结构，不描述运行期状态

### 9.2 Why Manifest Is Not Enough

manifest 只是 provider 插件发布时的“静态宣称”。  
实际能力还会受这些因素影响：

- 当前配置是否合法
- 当前模型是否支持
- 当前 CLI / SDK 版本是否满足要求
- 当前 backend 是否启用了 MCP / tool bridge
- 当前 session 是否处于受限模式

所以还需要运行期协商。

---

## 10. Runtime Negotiation

### 10.1 Effective Provider Profile

```ts
export interface EffectiveProviderProfile {
  providerId: string;
  providerType: string;
  runId?: string;
  sessionId?: string;
  model?: string;

  capabilities: EffectiveCapability[];
  unavailableReasons?: Record<string, string>;
  negotiatedAt: number;
}

export interface EffectiveCapability {
  id: ProviderCapabilityId;
  enabled: boolean;
  mode?: CapabilityMode;
  reliability?: ReliabilityTier;
  degradationPolicy?: DegradationPolicy;
  notes?: string;
}
```

### 10.2 Negotiation Inputs

协商时应至少考虑：

- provider manifest
- provider 当前配置
- provider runtime health
- 指定模型
- server 当前桥接能力
- 当前 run mode / permission mode
- 当前是否是本地 server / 远程 gateway

### 10.3 Negotiation Timing

建议两阶段：

1. **Load-time negotiation**
   - provider 加载后，生成静态可用性概览
2. **Run-time negotiation**
   - run 启动时，生成本次 run 的 `EffectiveProviderProfile`

### 10.4 Why This Matters

同一个 provider 在不同上下文下可能有完全不同的有效能力：

- 同一个 `codex` provider，模型 A 支持工具，模型 B 不支持
- 同一个 `claude` provider，本地桌面模式可桥接 MCP，远程模式不可桥接
- 同一个 `cursor` provider，旧版本 CLI 只能提供 display-only 能力

---

## 11. Degradation Policy

降级策略必须成为协议一部分，而不是实现细节。

```ts
export type DegradationPolicy =
  | 'reject'
  | 'fallback_to_text'
  | 'fallback_to_notice'
  | 'server_emulation';
```

### 11.1 Policy Semantics

- `reject`
  - 明确拒绝能力调用，调用方必须处理错误
- `fallback_to_text`
  - 退化为文本输出，仅适合非事务场景
- `fallback_to_notice`
  - 退化为 UI notice，不保留交互能力
- `server_emulation`
  - 由 server 在 provider 之外模拟实现

### 11.2 Recommended Defaults

- `chat.generate`
  - `reject`
- `chat.stream`
  - `fallback_to_text`
- `tool.define`
  - `server_emulation`
- `tool.call`
  - `reject`
- `interaction.form`
  - `fallback_to_notice` 或 `reject`
- `interaction.approval`
  - `reject`
- `interaction.todo`
  - `fallback_to_notice`
- `session.control`
  - `reject`

### 11.3 Strict Rule For Transactional Interactions

以下能力默认视为事务型能力：

- `tool.call`
- `interaction.form`
- `interaction.approval`
- `session.control`

这些能力不得静默降级为自然语言文本后继续假装系统“支持”。

---

## 12. Capability Contracts

下面给出 v1 建议 contract。

### 12.1 Shared Message Types

```ts
export interface PCPMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface PCPGenerationOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  cwd?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
}
```

### 12.2 `chat.generate`

```ts
export interface GenerateInput {
  messages: PCPMessage[];
  options?: PCPGenerationOptions;
}

export interface GenerateOutput {
  content: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  metadata?: Record<string, unknown>;
}
```

### 12.3 `chat.stream`

```ts
export type StreamEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'content.delta'; delta: string }
  | { type: 'content.done'; content?: string }
  | { type: 'tool.call'; call: PCPToolCall }
  | { type: 'tool.result'; result: PCPToolResult }
  | { type: 'interaction'; interaction: PCPInteraction }
  | { type: 'usage'; usage: { inputTokens?: number; outputTokens?: number } }
  | { type: 'run.completed' }
  | { type: 'run.failed'; error: PCPError };
```

### 12.4 `tool.define`

```ts
export interface ToolSchema {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface RegisterToolsInput {
  tools: ToolSchema[];
}

export interface RegisterToolsResult {
  accepted: string[];
  rejected: Array<{ toolId: string; reason: string }>;
}
```

### 12.5 `tool.call`

```ts
export interface PCPToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: unknown;
}

export interface PCPToolResult {
  id: string;
  callId: string;
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}
```

### 12.6 Structured Interactions

```ts
export type PCPInteraction =
  | PCPFormInteraction
  | PCPApprovalInteraction
  | PCPTodoInteraction;

export interface PCPInteractionBase {
  id: string;
  source: 'provider_native' | 'tool_call' | 'server_emulated';
  createdAt: number;
}

export interface PCPFormInteraction extends PCPInteractionBase {
  type: 'interaction.form';
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options?: Array<{
      label: string;
      value: string;
      description?: string;
    }>;
    multiSelect?: boolean;
  }>;
}

export interface PCPApprovalInteraction extends PCPInteractionBase {
  type: 'interaction.approval';
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface PCPTodoInteraction extends PCPInteractionBase {
  type: 'interaction.todo';
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}
```

### 12.7 `session.control`

```ts
export interface SessionControlAPI {
  abort?(sessionId: string, cwd: string): Promise<void>;
  stopTask?(sessionId: string, taskId: string): Promise<void>;
  resume?(sessionId: string, cwd: string): Promise<void>;
  getRunState?(options: Record<string, unknown>): Promise<Record<string, unknown>>;
}
```

---

## 13. Provider Module Interface

当前代码里的 provider 入口是偏单体的 `ProviderAdapter`。  
PCP v1 建议逐步演进为 capability-composed 模式。

```ts
export interface ProviderModule {
  manifest: ProviderManifest;
  create(context: ProviderRuntimeContext): Promise<ProviderInstance> | ProviderInstance;
}

export interface ProviderRuntimeContext {
  appVersion: string;
  serverPort?: number;
  db?: unknown;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  bridges?: {
    mcp?: boolean;
    interactions?: boolean;
    tools?: boolean;
  };
}

export interface ProviderInstance {
  setup?(): Promise<void>;
  dispose?(): Promise<void>;

  getProfile(input: {
    model?: string;
    sessionId?: string;
    runId?: string;
    options?: Record<string, unknown>;
  }): Promise<EffectiveProviderProfile>;

  capabilities: Partial<{
    chatGenerate: ChatGenerateCapability;
    chatStream: ChatStreamCapability;
    toolDefine: ToolDefineCapability;
    toolCall: ToolCallCapability;
    interactionForm: InteractionFormCapability;
    interactionApproval: InteractionApprovalCapability;
    interactionTodo: InteractionTodoCapability;
    sessionControl: SessionControlCapability;
  }>;
}
```

### 13.1 Capability Interfaces

```ts
export interface ChatGenerateCapability {
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

export interface ChatStreamCapability {
  stream(input: GenerateInput): AsyncGenerator<StreamEvent>;
}

export interface ToolDefineCapability {
  registerTools(input: RegisterToolsInput): Promise<RegisterToolsResult>;
}

export interface ToolCallCapability {
  // Marker capability in v1. Tool calls are typically surfaced through StreamEvent.
}

export interface InteractionFormCapability {
  // Marker capability in v1. Structured interactions surface through StreamEvent.
}

export interface InteractionApprovalCapability {
  // Marker capability in v1.
}

export interface InteractionTodoCapability {
  // Marker capability in v1.
}

export interface SessionControlCapability extends SessionControlAPI {}
```

### 13.2 Why Marker Capabilities Exist

对于 `tool.call` 和 `interaction.*`，v1 的主要事件出口是 stream。  
因此这些 capability 在接口层可能是 marker，但它们仍然必须：

- 在 manifest 中显式声明
- 在 profile 中可协商
- 在测试中可断言

---

## 14. Mapping To Existing MyClaudia Architecture

### 14.1 Current State

当前大致是：

- provider 由 `server/src/providers/registry.ts` 直接注册
- 运行接口集中在 `server/src/providers/types.ts` 的 `ProviderAdapter`
- plugins 通过 `shared/src/plugin-types.ts` 访问 `ProviderAPI`

### 14.2 Proposed Alignment

#### Provider Runtime

- 短期保留现有 `ProviderAdapter`
- 在 server 层新增 PCP wrapper / profile negotiation
- 中期让内建 provider 也转成 `ProviderModule`

#### Plugin API

当前 `ProviderAPI` 可以继续保留为上层“消费接口”，但其底层实现应改为基于 PCP：

- `call()` -> 走 `chat.generate`
- `callStream()` -> 走 `chat.stream`
- `list()` / `get()` -> 额外返回 capability/profile 概览

#### Unified Interaction

`interaction.form` / `interaction.approval` / `interaction.todo`
应直接接到统一交互层，而不是让前端识别 provider 私有工具名。

---

## 15. Event Normalization Rules

server 必须负责把 provider 原始事件规范化为内部事件。

### 15.1 Raw Event Layer

provider 可能输出：

- assistant text
- tool call
- tool result
- permission request
- provider-private lifecycle event

### 15.2 Normalized PCP Event Layer

server 将其映射为：

- `run.started`
- `content.delta`
- `tool.call`
- `tool.result`
- `interaction`
- `usage`
- `run.completed`
- `run.failed`

### 15.3 Frontend Event Layer

frontend 最终只消费 MyClaudia 自己的协议消息，例如：

- `interaction_ask_user`
- `interaction_todo_update`
- `interaction_resolved`
- 以及已有统一 message types

PCP 不直接暴露给前端；PCP 是 server runtime 的内部标准边界。

---

## 16. Error Model

PCP 需要统一错误分类，避免“任意字符串错误”。

```ts
export interface PCPError {
  code:
    | 'PROVIDER_NOT_AVAILABLE'
    | 'CAPABILITY_NOT_SUPPORTED'
    | 'CAPABILITY_NEGOTIATION_FAILED'
    | 'INVALID_TOOL_SCHEMA'
    | 'INVALID_TOOL_CALL'
    | 'INVALID_INTERACTION_PAYLOAD'
    | 'SESSION_CONTROL_NOT_AVAILABLE'
    | 'UPSTREAM_ERROR'
    | 'TIMEOUT';
  message: string;
  retryable?: boolean;
  cause?: unknown;
  providerId?: string;
  capabilityId?: ProviderCapabilityId;
}
```

### 16.1 Rules

- 不支持某能力时，优先返回 `CAPABILITY_NOT_SUPPORTED`
- 协商后被禁用时，返回 `CAPABILITY_NEGOTIATION_FAILED`
- provider 返回坏结构时，返回 `INVALID_*`
- 上游 CLI / SDK 原始错误放入 `cause` 或 `metadata`，不要直接暴露为唯一错误模型

---

## 17. Observability

PCP 必须可观测，否则后续多 provider 调试会继续困难。

### 17.1 Recommended Telemetry Fields

- `providerId`
- `providerType`
- `model`
- `capabilityId`
- `capabilityMode`
- `reliability`
- `degradationPolicy`
- `runId`
- `sessionId`
- `eventType`
- `latencyMs`
- `success`

### 17.2 Trace Layers

建议把 trace 拆成三层：

1. `provider_raw`
2. `pcp_norm`
3. `frontend_dispatch`

这样可以直接对齐现有 provider trace 实验方向。

---

## 18. Security and Validation

### 18.1 Manifest Validation

provider manifest 加载时必须验证：

- `apiVersion` 是否匹配
- capability id 是否合法
- `entry` 是否存在
- `configSchema` 是否为对象
- provider id 是否符合规范

### 18.2 Capability Validation

如果 provider 声明支持某能力，则必须满足对应最小 contract。

例如：

- 声明支持 `tool.call`，但 stream 中从不产出结构化 `tool.call`
  - 视为协议违规
- 声明支持 `interaction.approval`，但输出 payload 不是结构化对象
  - 视为协议违规

### 18.3 Tool Schema Validation

所有 provider 注册和调用的工具 schema 都必须由 server 校验。  
不要信任模型，也不要信任 provider 插件返回的任意结构。

### 18.4 Transactional Boundary

审批、用户表单、会话控制必须由 server 控制提交和回填边界。  
provider 不能绕过 server 直接驱动前端事务状态。

---

## 19. Testing Strategy

测试维度应从“按 provider 文件测”扩展为“按 capability 合同测”。

### 19.1 Contract Tests

为每个 capability 定义 contract tests：

- `chat.generate` contract
- `chat.stream` contract
- `tool.define` contract
- `tool.call` contract
- `interaction.form` contract
- `interaction.approval` contract
- `interaction.todo` contract
- `session.control` contract

### 19.2 Provider Capability Matrix Tests

每个 provider 跑一张 capability matrix：

- manifest 声明
- effective profile
- 实际 contract 结果
- 降级行为是否符合协议

### 19.3 Regression Tests

重点覆盖：

- tool schema 差异
- todo 字段差异
- structured interaction 降级
- abort / stopTask 行为差异

---

## 20. Migration Plan

### Phase 0: Documentation and Type Draft

- 新增 PCP 设计文档
- 在 shared/server 中引入 PCP 基础类型
- 不改现有 provider 行为

### Phase 1: PCP Wrapper Over Existing `ProviderAdapter`

- 保留 `ProviderAdapter`
- 新增 `ProviderManifest`、`EffectiveProviderProfile`
- 在现有 registry 上加一层 capability registry / profile negotiation
- 先让内建 provider 输出静态 manifest

### Phase 2: Stream Event Normalization

- 把 provider 输出统一映射为 PCP stream event
- 把 `interaction.*` 与统一交互层对齐
- 前端继续只消费 MyClaudia 自己的统一事件

### Phase 3: Tool Registration and Interaction Bridge

- 为 Claude / OpenCode / Codex 接入 `tool.define`
- 让 `interaction.form` / `interaction.approval` / `interaction.todo` 能通过桥接工具稳定产生

### Phase 4: Provider Plugins

- provider 不再只靠内建 registry 注册
- 支持从 provider plugin manifest 动态发现
- 内建 provider 也逐步迁移成同构 provider module

### Phase 5: Deprecate Legacy Adapter-only Paths

- 新 provider 必须走 PCP
- 旧 provider adapter 只作为兼容层

---

## 21. Compatibility With Existing Types

### 21.1 `ProviderAdapter`

当前接口：

```ts
export interface ProviderAdapter {
  readonly type: string;
  run(...): AsyncGenerator<ClaudeMessage, void, void>;
  abort?(sessionId: string, cwd: string): Promise<void>;
  stopTask?(sessionId: string, taskId: string): Promise<void>;
  getRunState?(options: RunOptions): Record<string, unknown>;
}
```

建议演进方式：

- 短期：保留
- 新增包装层将其映射为 PCP `chat.stream` + `session.control`
- 中期：把 `run()` 的语义压缩为 PCP stream contract
- 长期：让 provider module 直接实现 PCP

### 21.2 `ProviderAPI`

当前 `shared/src/plugin-types.ts` 中的 `ProviderAPI` 可以保留，但建议后续补充：

- `capabilities?: EffectiveCapability[]`
- `profile?: EffectiveProviderProfile`

这样 plugin 在做多 provider orchestration 时，可以基于 capability 选择 provider，而不是只看 `type`。

---

## 22. Example Manifests

### 22.1 Claude-like Provider

```json
{
  "id": "com.myclaudia.provider.claude",
  "name": "Claude Provider",
  "version": "1.0.0",
  "apiVersion": "pcp/v1",
  "providerType": "claude",
  "runtime": "cli",
  "entry": "./dist/claude-provider.js",
  "capabilities": [
    { "id": "chat.generate", "version": "1.0", "supported": true, "mode": "native", "reliability": "strict" },
    { "id": "chat.stream", "version": "1.0", "supported": true, "mode": "native", "reliability": "strict" },
    { "id": "tool.define", "version": "1.0", "supported": true, "mode": "bridged", "reliability": "strict" },
    { "id": "tool.call", "version": "1.0", "supported": true, "mode": "native", "reliability": "strict" },
    { "id": "interaction.form", "version": "1.0", "supported": true, "mode": "bridged", "reliability": "strict" },
    { "id": "interaction.approval", "version": "1.0", "supported": true, "mode": "bridged", "reliability": "strict" },
    { "id": "interaction.todo", "version": "1.0", "supported": true, "mode": "bridged", "reliability": "strict" },
    { "id": "session.control", "version": "1.0", "supported": true, "mode": "native", "reliability": "strict" }
  ]
}
```

### 22.2 Cursor-like Provider

```json
{
  "id": "com.myclaudia.provider.cursor",
  "name": "Cursor Provider",
  "version": "1.0.0",
  "apiVersion": "pcp/v1",
  "providerType": "cursor",
  "runtime": "cli",
  "entry": "./dist/cursor-provider.js",
  "capabilities": [
    { "id": "chat.stream", "version": "1.0", "supported": true, "mode": "native", "reliability": "best_effort" },
    { "id": "tool.call", "version": "1.0", "supported": true, "mode": "native", "reliability": "best_effort" },
    { "id": "interaction.todo", "version": "1.0", "supported": true, "mode": "emulated", "reliability": "display_only" },
    { "id": "session.control", "version": "1.0", "supported": false }
  ]
}
```

---

## 23. Open Questions

以下问题可在 v1 文档通过后单独决策：

1. provider manifest 是否复用现有 plugin manifest，还是独立文件类型
2. provider plugin 是否允许第三方执行任意 shell / network 行为，还是必须跑在受限 worker
3. `session.control` 是否要在 v1 就拆成更细的 capability
4. `tool.define` 是否需要区分“启动前注册”和“运行中动态注册”
5. `interaction.form` 的回填协议是否直接复用现有 `ask_user_answer`
6. `EffectiveProviderProfile` 是否要暴露给前端，还是只暴露精简视图

---

## 24. Recommended Next Steps

按当前仓库情况，建议落地顺序是：

1. 在 `shared` 中新增 PCP 基础类型
2. 在 `server` 中新增 `ProviderManifest` 和 `EffectiveProviderProfile` 协商层
3. 给现有内建 provider 补静态 capability 声明
4. 在统一交互层接入 `interaction.form` / `interaction.todo` / `interaction.approval`
5. 将 `ProviderAPI` 底层实现切到 PCP
6. 最后再做 provider 动态插件加载

---

## 25. Summary

PCP v1 的目标不是重新发明 provider SDK 接入方式，而是建立一条稳定边界：

- 对 provider 来说：实现能力，而不是适配零散特判
- 对 server 来说：协商、路由、归一化、降级
- 对 frontend 来说：只消费统一语义
- 对插件平台来说：provider 可以成为一种可发现、可验证、可动态加载的插件类型

一句话定义：

> **Provider Capability Protocol 是 MyClaudia 用来声明、协商、调用和降级 provider 标准能力的内部协议。**
