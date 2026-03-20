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
- 前端已经开始被 provider 差异拖着走，例如 `AskUserQuestion`、`TodoWrite`、permission 事件、工具参数结构不一致

但当前 provider 集成仍然存在几个结构性问题：

1. provider 的"能力边界"没有显式建模
2. 适配层以 provider type 为中心，而不是以 capability 为中心
3. 前后端仍然容易被 provider 私有事件、工具名、字段结构拖着走
4. 很难把 provider 从内建适配器演进为可动态加载插件
5. 同一个 provider 在不同模型、CLI 版本、桥接模式下的有效能力不同，但当前没有运行期协商模型
6. 不同 provider 对交互能力的支持差异很大，展示上"看起来支持"的交互实际上缺乏稳定的回填事务路径

本设计将这些问题收敛为一套协议：

- **PCP = Provider Capability Protocol**

PCP 的核心思想不是定义"怎么接某个厂商 SDK"，而是定义：

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
- 让"能力支持"从静态概念变成可协商、可观测、可降级的运行期事实
- 让交互能力通过"内部工具注入"实现，而不是等待上游 provider 能力统一

### 2.2 Secondary Goals

- 让 provider 接入成本降低到"实现一组能力接口 + 提供 manifest"
- 让新增 provider 不再要求前端新增特判
- 为后续 provider marketplace / provider plugin system 做准备
- 为测试矩阵提供正式维度：按 capability 测，而不是按 provider 名字测

### 2.3 Non-Goals

- 不追求所有 provider 在底层能力上完全等价
- 不要求所有 provider 原生支持结构化交互
- 不试图统一上游厂商内部 SDK 语义
- 不在 v1 里定义跨应用、跨厂商的开放标准
- 不在 v1 里直接替换现有全部 `tool_use` / `tool_result` 事件链路
- 不在第一阶段引入 ACP、A2A 或新的跨 agent 标准协议

---

## 3. Design Principles

### 3.1 Capability-first, Not Provider-first

上层系统关注的是"能做什么"，不是"它是谁"。
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

manifest 里的能力声明只是"理论支持"。
真正用于一次 run 的，是运行期协商得到的 **Effective Provider Profile**。

### 3.4 Explicit Degradation

不支持某能力时，必须有明确降级策略。
不能静默地把事务型能力退化成自然语言文本，再假装系统"支持"。

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

### 3.7 Transactional vs Display Boundary

展示型交互和事务型交互必须区分处理。事务型交互不能依赖文本推断，必须来自明确工具调用或原生结构化事件。所有工具输入必须 server 侧做 schema 校验，不能信任模型。

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

### 4.7 Internal Interaction Tools

MyClaudia 自己定义的产品交互工具，不等于 provider 原生工具。通过注入到 provider 的方式实现统一交互能力：

- `ask_user_form` — 结构化问答 / 表单
- `request_approval` — 审批 / 确认
- `update_todo_list` — todo / plan 状态更新

后续可扩展：

- `submit_plan_for_review`
- `notify_user`
- `select_session_target`

---

## 5. Architecture

PCP 位于四层之间：

### Layer 1: Provider Raw Event Layer

保留 provider 产生的原始运行事件。不暴露给前端，只在 server 内部使用。

示例：

- `assistant text`
- `tool_use`
- `tool_result`
- `permission request`
- `task_notification`
- provider-private lifecycle event

### Layer 2: Interaction Tool Layer

定义 MyClaudia 自己的内部交互工具。这些工具通过 MCP bridge / plugin 机制注入到 provider，模型调用时由 server 拦截并转为统一事件。

工具的输出不进入普通 tool result 区域，而是由 server 直接转为统一交互事件。

### Layer 3: PCP Normalization Layer

把两类输入统一映射成一套协议：

- provider 原生结构化交互
- 内部交互工具调用

输出是统一的 PCP 事件和 `NormalizedInteractionEvent`。

### Layer 4: Frontend Interaction Layer

前端只消费统一事件，不感知：

- provider 类型
- 原始 tool name
- provider 私有字段
- provider 私有 permission 结构

数据流：

1. provider 插件通过 manifest 声明能力
2. server 加载 provider module
3. run 启动时 server 协商 `EffectiveProviderProfile`
4. 上层根据 capability 调用对应 contract
5. provider 返回原始事件或结构化结果
6. server 归一化成 MyClaudia 统一语义
7. frontend 只消费统一语义

---

## 6. Provider Support Snapshot

以下判断基于当前仓库实现，不是官方产品能力总表。

### Claude

- 当前支持度：强
- 已有能力：原生结构化工具事件、`AskUserQuestion` 专门走 permission callback 交互路径、已有 plugin MCP bridge 注入能力
- 结论：最适合作为统一交互协议的第一落地点，可同时支持"原生结构化事���映射"和"内部工具注入"

### OpenCode

- 当前支持度：中
- 已有能力：稳定 `tool_use`、有 `permission.updated` 等结构化 permission 事件
- 缺口：当前仓库还没有像 Claude 一样的自定义交互工具桥接
- 结论：第二阶段适合接入

### Codex

- 当前支持度：中偏弱
- 已有能力：结构化 `tool_use`、能识别 `mcp_tool_call`
- 缺口：现有接入中没有真正挂载自定义工具桥
- 结论：有希望接入统一交互工具，但需要额外桥接层

### Cursor

- 当前支持度：弱
- 已有能力：`tool_call` 能映射成 `tool_use`
- 缺口：目前更像 CLI 输出映射，不是我们控制工具注册表，没有现成的交互工具桥
- 结论：短期适合消费统一事件，不适合优先做工具注入

### Kimi

- 当前支持度：弱
- 已有能力：可解析 `tool_use`
- 缺口：当前实现主要是 CLI `stream-json` 适配，没有现成交互工具桥
- 结论：适合文本降级和基础事件统一，不适合第一批复杂交互注入

---

## 7. Capability Taxonomy

v1 建议把能力拆成以下 8 类。

### 7.1 Core Chat

- `chat.generate`
  - 非流式生成
- `chat.stream`
  - 流式生成

### 7.2 Tooling

- `tool.define`
  - 在 provider 运行前动态注册工具 schema
- `tool.call`
  - provider 发起结构化工具调用

### 7.3 Structured Interaction

- `interaction.form`
  - 结构化问答 / 表单
- `interaction.approval`
  - 审批 / 确认
- `interaction.todo`
  - todo / plan 状态更新

### 7.4 Session Control

- `session.control`
  - abort / stop task / resume / checkpoint / background task control

---

## 8. Capability Definitions

### 8.1 `chat.generate`

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

### 8.2 `chat.stream`

表示 provider 支持流式输出事件。

**Requirements**

- 支持增量内容输出
- 支持终态事件
- 错误不可吞掉，必须显式发出
- 如可提供 usage，则在终态或中途发出

### 8.3 `tool.define`

表示 provider 支持在 run 启动前接收一组工具 schema，并在模型侧以结构化方式暴露。

**Requirements**

- 接收统一 `ToolSchema[]`
- 返回注册结果或注册失败原因
- 如 provider 不支持运行中动态增量注册，则需要在限制中声明

### 8.4 `tool.call`

表示 provider 可以发起结构化工具调用事件。

**Requirements**

- 工具调用必须有稳定的 call id
- 参数必须是结构化 JSON，不接受只靠文本解析
- 必须支持 tool result 回填或明确声明不支持回填

### 8.5 `interaction.form`

表示 provider 可以可靠地产生或消费结构化用户表单交互。

在 MyClaudia 内部应映射到：

- 内部工具 `ask_user_form`
- 统一事件 `interaction.ask_user`

### 8.6 `interaction.approval`

表示 provider 可以可靠地产生或消费结构化审批交互。

在 MyClaudia 内部应映射到：

- 内部工具 `request_approval`
- 统一事件 `interaction.approval`

### 8.7 `interaction.todo`

表示 provider 可以可靠地产生结构化 todo / plan 更新。

在 MyClaudia 内部应映射到：

- 内部工具 `update_todo_list`
- 统一事件 `interaction.todo_update`

### 8.8 `session.control`

表示 provider 支持会话级控制操作。

典型能力包括：

- abort 当前 run
- stop 指定 task
- resume session
- 获取 provider-specific run state

v1 不要求所有子能力都支持，但必须在限制中明确声明。

---

## 9. Capability Reliability Model

仅仅知道"支持/不支持"还不够，PCP 还需要表达可靠性级别。

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

## 10. Manifest Schema

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

### 10.1 Manifest Rules

- `capabilities` 里只能声明 PCP 已知 capability id
- `supported = false` 的 capability 可以省略，但推荐显式声明关键缺失能力
- `models[].capabilities` 用于描述模型级覆盖，不替代 provider 级声明
- `configSchema` 只描述配置结构，不描述运行期状态

### 10.2 Why Manifest Is Not Enough

manifest 只是 provider 插件发布时的"静态宣称"。
实际能力还会受这些因素影响：

- 当前配置是否合法
- 当前模型是否支持
- 当前 CLI / SDK 版本是否满足要求
- 当前 backend 是否启用了 MCP / tool bridge
- 当前 session 是否处于受限模式

所以还需要运行期协商。

---

## 11. Runtime Negotiation

### 11.1 Effective Provider Profile

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

### 11.2 Negotiation Inputs

协商时应至少考虑：

- provider manifest
- provider 当前配置
- provider runtime health
- 指定模型
- server 当前桥接能力
- 当前 run mode / permission mode
- 当前是否是本地 server / 远程 gateway

### 11.3 Negotiation Timing

建议两阶段：

1. **Load-time negotiation**
   - provider 加载后，生成静态可用性概览
2. **Run-time negotiation**
   - run 启动时，生成本次 run 的 `EffectiveProviderProfile`

### 11.4 Why This Matters

同一个 provider 在不同上下文下可能有完全不同的有效能力：

- 同一个 `codex` provider，模型 A 支持工具，模型 B 不支持
- 同一个 `claude` provider，本地桌面模式可桥接 MCP，远程模式不可桥接
- 同一个 `cursor` provider，旧版本 CLI 只能提供 display-only 能力

---

## 12. Degradation Policy

降级策略必须成为协议一部分，而不是实现细节。

```ts
export type DegradationPolicy =
  | 'reject'
  | 'fallback_to_text'
  | 'fallback_to_notice'
  | 'server_emulation';
```

### 12.1 Policy Semantics

- `reject`
  - 明确拒绝能力调用，调用方必须处理错误
- `fallback_to_text`
  - 退化为文本输出，仅适合非事务场景
- `fallback_to_notice`
  - 退化为 UI notice，不保留交互能力
- `server_emulation`
  - 由 server 在 provider 之外模拟实现

### 12.2 Recommended Defaults

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

### 12.3 Provider Integration Strategies

根据 provider 能力不同，降级走三条路径：

#### Path A: Native Structured Interaction

适用于 Claude 这类已经有较强结构化交互能力的 provider。

- 保留 provider 原生结构化能力
- 在 normalization 层映射为统一事件
- 需要时也允许它调用内部交互工具
- 优点：保真度高，交互结果更可靠

#### Path B: Internal Tool Injection

适用于支持工具调用、但没有现成结构化交互能力的 provider。

- 把内部交互工具注入 provider
- 模型调用这些工具时，server 直接发统一事件给前端
- 前提：provider 工具调用足够稳定，我们能控制工具注册
- 优点：不依赖 provider 原生交互模型，统一程度高

#### Path C: Text Degradation

适用于弱工具能力 provider，或当前暂时无法桥接的 provider。

- 能识别的展示型交互，映射为 `interaction.notice` 或只读 `interaction.todo_update`
- 无法可靠识别或需要事务回填的交互，一律降级为普通 assistant text
- 原则：不能因为想统一体验，就对事务型交互做不可靠推断

### 12.4 Transactional vs Display Interactions

这是降级策略中最重要的边界。

#### Display Interactions

包括 todo 列表展示、plan 预览、notice / warning。

可以接受：

- 文本推断（`text_inferred` source）
- 不完全结构化
- 降级渲染

#### Transactional Interactions

包括用户表单回答、审批 / 拒绝、权限确认、需要把结果回写给 run 的交互。

必须满足：

- 来自 provider 原生结构化事件，或
- 来自内部工具明确调用

不能只从文本中猜，否则会出现：

- UI 看起来可以交互
- 但系统没有稳定的回填事务路径

### 12.5 Strict Rule For Transactional Capabilities

以下能力默认视为事务型能力：

- `tool.call`
- `interaction.form`
- `interaction.approval`
- `session.control`

这些能力不得静默降级为自然语言文本后继续假装系统"支持"。

---

## 13. Capability Contracts

下面给出 v1 建议 contract。

### 13.1 Shared Message Types

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

### 13.2 `chat.generate`

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

### 13.3 `chat.stream`

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

### 13.4 `tool.define`

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

### 13.5 `tool.call`

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

### 13.6 Structured Interactions

```ts
export type PCPInteraction =
  | PCPFormInteraction
  | PCPApprovalInteraction
  | PCPTodoInteraction
  | PCPPlanReviewInteraction
  | PCPNoticeInteraction;

export interface PCPInteractionBase {
  id: string;
  source: 'provider_native' | 'tool_call' | 'server_emulated' | 'text_inferred';
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
  approveLabel?: string;
  rejectLabel?: string;
  payload?: Record<string, unknown>;
}

export interface PCPTodoInteraction extends PCPInteractionBase {
  type: 'interaction.todo';
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface PCPPlanReviewInteraction extends PCPInteractionBase {
  type: 'interaction.plan_review';
  title?: string;
  content: string;
}

export interface PCPNoticeInteraction extends PCPInteractionBase {
  type: 'interaction.notice';
  level: 'info' | 'warning' | 'error';
  message: string;
}
```

**`source` 字段语义：**

- `provider_native` — 来自 provider 原生结构化事件
- `tool_call` — 来自内部交互工具明确调用
- `server_emulated` — 由 server 模拟生成
- `text_inferred` — 从文本推断，**只允许用于展示型事件**，不允许用于事务型回填

### 13.7 Internal Interaction Tool Contracts

内部交互工具 schema 固定，不允许 provider 各自定义变体。

#### `ask_user_form`

```ts
{
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options?: Array<{
      value: string;
      label: string;
      description?: string;
    }>;
    multiSelect?: boolean;
  }>;
}
```

#### `request_approval`

```ts
{
  title: string;
  message: string;
  approveLabel?: string;
  rejectLabel?: string;
  payload?: Record<string, unknown>;
}
```

#### `update_todo_list`

```ts
{
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}
```

### 13.8 `session.control`

```ts
export interface SessionControlAPI {
  abort?(sessionId: string, cwd: string): Promise<void>;
  stopTask?(sessionId: string, taskId: string): Promise<void>;
  resume?(sessionId: string, cwd: string): Promise<void>;
  getRunState?(options: Record<string, unknown>): Promise<Record<string, unknown>>;
}
```

---

## 14. Provider Module Interface

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

### 14.1 Capability Interfaces

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

### 14.2 Why Marker Capabilities Exist

对于 `tool.call` 和 `interaction.*`，v1 的主要事件出口是 stream。
因此这些 capability 在接口层可能是 marker，但它们仍然必须：

- 在 manifest 中显式声明
- 在 profile 中可协商
- 在测试中可断言

---

## 15. Server-Side Modules

### 15.1 `interaction-tool-registry.ts`

职责：

- 定义内部交互工具 schema
- 提供工具元数据
- 管理工具注册生命周期

### 15.2 `interaction-normalizer.ts`

职责：

- 把 provider 原始事件映射成统一 PCP 事件
- 把内部工具调用映射成统一事件
- 统一字段名和状态值
- schema 校验

### 15.3 `interaction-dispatcher.ts`

职责：

- 把统一交互事件发给 websocket client
- 处理用户提交结果
- 关联 session / run / request lifecycle

---

## 16. Prompt Strategy

如果要让不同 provider 主动调用内部交互工具，system prompt 必须明确约束。

建议加入统一规则：

- 需要用户在多个选项中做结构化选择时，必须调用 `ask_user_form`
- 需要用户审批时，必须调用 `request_approval`
- 更新任务列表时，必须调用 `update_todo_list`
- 不允许只用自然语言模拟这些交互，除非 provider 不支持工具且当前处于降级路径

这个 prompt 规则应由 server 注入，而不是散落在前端或 provider 特例里。

---

## 17. Frontend Changes

前端目标是从"认 provider"改成"认 interaction type"。

### 17.1 New Modules

建议新增：

- `interactionStore` — 管理交互状态
- `InteractionRenderer` — 统一渲染交互 UI
- `InteractionResultDispatcher` — 处理用户交互结果回传

### 17.2 Consumed Events

前端只处理：

- `interaction.ask_user`
- `interaction.approval`
- `interaction.todo_update`
- `interaction.plan_review`
- `interaction.notice`

### 17.3 Migration From ToolCallItem

现有 `ToolCallItem` 里与交互强绑定的部分，长期应从工具渲染里剥离出去，迁到 interaction renderer。

短期策略：

- 先把事务型交互迁到 interaction 层
- 展示型工具暂时保留在 tool call UI
- 等稳定后再逐步收缩 `ToolCallItem` 特例

---

## 18. Event Normalization Rules

server 必须负责把 provider 原始事件规范化为内部事件。

### 18.1 Raw Event Layer

provider 可能输出：

- assistant text
- tool call
- tool result
- permission request
- provider-private lifecycle event

### 18.2 Normalized PCP Event Layer

server 将其映射为：

- `run.started`
- `content.delta`
- `tool.call`
- `tool.result`
- `interaction`
- `usage`
- `run.completed`
- `run.failed`

### 18.3 Frontend Event Layer

frontend 最终只消费 MyClaudia 自己的协议消息，例如：

- `interaction_ask_user`
- `interaction_todo_update`
- `interaction_resolved`
- 以及已有统一 message types

PCP 不直接暴露给前端；PCP 是 server runtime 的内部标准边界。

---

## 19. Error Model

PCP 需要统一错误分类，避免"任意字符串错误"。

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

### 19.1 Rules

- 不支持某能力时，优先返回 `CAPABILITY_NOT_SUPPORTED`
- 协商后被禁用时，返回 `CAPABILITY_NEGOTIATION_FAILED`
- provider 返回坏结构时，返回 `INVALID_*`
- 上游 CLI / SDK 原始错误放入 `cause` 或 `metadata`，不要直接暴露为唯一错误模型

---

## 20. Observability

PCP 必须可观测，否则后续多 provider 调试会继续困难。

### 20.1 Recommended Telemetry Fields

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

### 20.2 Trace Layers

建议把 trace 拆成三层：

1. `provider_raw`
2. `pcp_norm`
3. `frontend_dispatch`

这样可以直接对齐现有 provider trace 实验方向。

---

## 21. Security and Validation

### 21.1 Manifest Validation

provider manifest 加载时必须验证：

- `apiVersion` 是否匹配
- capability id 是否合法
- `entry` 是否存在
- `configSchema` 是否为对象
- provider id 是否符合规范

### 21.2 Capability Validation

如果 provider 声明支持某能力，则必须满足对应最小 contract。

例如：

- 声明支持 `tool.call`，但 stream 中从不产出结构化 `tool.call`
  - 视为协议违规
- 声明支持 `interaction.approval`，但输出 payload 不是结构化对象
  - 视为协议违规

### 21.3 Tool Schema Validation

所有 provider 注册和调用的工具 schema 都必须由 server 校验。
不要信任模型，也不要信任 provider 插件返回的任意结构。

### 21.4 Transactional Boundary

审批、用户表单、会话控制必须由 server 控制提交和回填边界。
provider 不能绕过 server 直接驱动前端事务状态。

---

## 22. Testing Strategy

测试维度应从"按 provider 文件测"扩展为"按 capability 合同测"。

### 22.1 Contract Tests

为每个 capability 定义 contract tests：

- `chat.generate` contract
- `chat.stream` contract
- `tool.define` contract
- `tool.call` contract
- `interaction.form` contract
- `interaction.approval` contract
- `interaction.todo` contract
- `session.control` contract

### 22.2 Provider Capability Matrix Tests

每个 provider 跑一张 capability matrix：

- manifest 声明
- effective profile
- 实际 contract 结果
- 降级行为是否符合协议

### 22.3 Regression Tests

重点覆盖：

- tool schema 差异
- todo 字段差异
- structured interaction 降级
- abort / stopTask 行为差异

---

## 23. Mapping To Existing MyClaudia Architecture

### 23.1 Current State

当前大致是：

- provider 由 `server/src/providers/registry.ts` 直接注册
- 运行接口集中在 `server/src/providers/types.ts` 的 `ProviderAdapter`
- plugins 通过 `shared/src/plugin-types.ts` 访问 `ProviderAPI`

### 23.2 Proposed Alignment

#### Provider Runtime

- 短期保留现有 `ProviderAdapter`
- 在 server 层新增 PCP wrapper / profile negotiation
- 中期让内建 provider 也转成 `ProviderModule`

#### Plugin API

当前 `ProviderAPI` 可以继续保留为上层"消费接口"，但其底层实现应改为基于 PCP：

- `call()` -> 走 `chat.generate`
- `callStream()` -> 走 `chat.stream`
- `list()` / `get()` -> 额外返回 capability/profile 概览

#### Unified Interaction

`interaction.form` / `interaction.approval` / `interaction.todo`
应直接接到统一交互层，而不是让前端识别 provider 私有工具名。

---

## 24. Migration Plan

### Phase 0: Documentation and Type Draft

- 新增 PCP 设计文档（本文档）
- 在 shared/server 中引入 PCP 基础类型
- 不改现有 provider 行为

### Phase 1: Normalize Existing Interactions + PCP Wrapper

目标：统一已有结构化交互出口，加入 capability 协商层。

工作项：

- 新增 `ProviderManifest`、`EffectiveProviderProfile`
- 在现有 registry 上加一层 capability registry / profile negotiation
- 先让内建 provider 输出静态 manifest
- 定义 `NormalizedInteractionEvent`
- 新增 `interaction-normalizer` + `interaction-dispatcher`
- 把 Claude `AskUserQuestion` 映射到 `interaction.ask_user`
- 把现有 `TodoWrite` 全部统一为 `interaction.todo_update`
- 前端新增 interaction renderer，但保留旧 tool UI 兼容

产出：

- 前端不再直接依赖 provider-specific 交互事件
- 每个 provider 有静态 capability 声明

### Phase 2: Internal Tool MVP on Claude + Stream Event Normalization

目标：在 Claude 路径先跑通内部交互工具，统一 stream 事件。

工作项：

- 定义 `ask_user_form` / `request_approval` / `update_todo_list`
- 通过现有 MCP bridge / plugin tool 注入机制接到 Claude
- server 将工具调用转换成统一事件
- 把 provider 输出统一映射为 PCP stream event
- 前端继续只消费 MyClaudia 自己的统一事件

产出：

- 第一条完整"内部交互工具 -> 统一事件 -> 前端 -> 回填"链路

### Phase 3: Expand to OpenCode + Codex

目标：把内部交互工具能力接到 OpenCode 和 Codex。

工作项：

- 增加 OpenCode 工具桥接
- 处理 permission / tool_use 的统一映射
- 对齐事务回填路径
- 为 Claude / OpenCode / Codex 接入 `tool.define`
- 让 `interaction.*` 能通过桥接工具稳定产生

### Phase 4: Cursor / Kimi Degradation + Provider Plugins

目标：明确弱 provider 边界，支持动态加载。

工作项：

- Cursor / Kimi 只做只读展示型事件统一
- 事务型交互明确降级
- 保留普通文本 fallback
- provider 不再只靠内建 registry 注册
- 支持从 provider plugin manifest 动态发现
- 内建 provider 也逐步迁移成同构 provider module

### Phase 5: Deprecate Legacy Adapter-only Paths

- 新 provider 必须走 PCP
- 旧 provider adapter 只作为兼容层

---

## 25. Compatibility With Existing Types

### 25.1 `ProviderAdapter`

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

### 25.2 `ProviderAPI`

当前 `shared/src/plugin-types.ts` 中的 `ProviderAPI` 可以保留，但建议后续补充：

- `capabilities?: EffectiveCapability[]`
- `profile?: EffectiveProviderProfile`

这样 plugin 在做多 provider orchestration 时，可以基于 capability 选择 provider，而不是只看 `type`。

---

## 26. Example Manifests

### 26.1 Claude-like Provider

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

### 26.2 Cursor-like Provider

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

## 27. Risks

### 工具调用稳定性风险

不同 provider 对工具调用的稳定性差异很大。即使支持 tools，也可能出现不调用、乱调用、参数缺失、参数结构漂移。

缓解方式：server schema 校验、必填字段 fail-fast、provider 级 capability gating。

### 前端与工具 UI 双轨并存风险

短期内现有 `ToolCallItem` 和新 `InteractionRenderer` 会共存。

缓解方式：先把事务型交互迁到 interaction 层，展示型工具暂时保留在 tool call UI，等稳定后再逐步收缩 `ToolCallItem` 特例。

### 文本推断误判风险

如果把事务型交互建立在文本推断上，会造成假交互。

缓解方式：只允许展示型交互使用 `text_inferred`，事务型交互必须来自明确结构化来源。

---

## 28. Open Questions

以下问题可在 v1 文档通过后单独决策：

1. provider manifest 是否复用现有 plugin manifest，还是独立文件类型
2. provider plugin 是否允许第三方执行任意 shell / network 行为，还是必须跑在受限 worker
3. `session.control` 是否要在 v1 就拆成更细的 capability
4. `tool.define` 是否需要区分"启动前注册"和"运行中动态注册"
5. `interaction.form` 的回填协议是否直接复用现有 `ask_user_answer`
6. `EffectiveProviderProfile` 是否要暴露给前端，还是只暴露精简视图

---

## 29. Protocol Positioning & Evolution

### 29.1 PCP 的本质定位

PCP 是 **workflow 中 AI provider 节点的能力标准协议**。

它不是 agent-to-agent 通信协议，也不是编辑器接口标准。它定义的是：当人类编排多个 AI provider 协作完成任务时，每个 provider 节点的能力契约。

核心问题：

- 这个 provider **能做什么** → Capability Taxonomy
- **做得多可靠** → ReliabilityTier (strict / best_effort / display_only)
- **怎么接入的** → CapabilityMode (native / bridged / emulated)
- **做不到怎么办** → DegradationPolicy
- **当前真正能做什么** → EffectiveProviderProfile（运行期协商）

Workflow 层不需要关心"这是 Claude 还是 Codex"，只需要声明"我要一个 `chat.stream` + `tool.call` strict 的节点"，PCP 负责匹配和保障。

### 29.2 在协议生态中的位置

AI agent 生态中目前有多个协议在不同层级解决不同问题：

| 协议 | 解决的问题 | 控制权 | 层级 |
|------|-----------|--------|------|
| **MCP** (Anthropic) | Agent-to-Tool | Agent 调用工具 | 工具层 |
| **A2A** (Google) | Agent-to-Agent | Agent 自主协作 | 网络层 |
| **ACP-IBM** (Linux Foundation) | Agent-to-Agent | Agent 自主互操作 | 网络层 |
| **ACP-Zed** (Zed Industries) | Editor-to-Agent | 编辑器驱动 | 接口层 |
| **PCP** (MyClaudia) | **Workflow-to-Provider** | **人类编排** | 能力层 |

关键区分 — **编排主导权**：

- **A2A / ACP-IBM**：agent 自主决定协作对象和方式，编排权在 agent
- **PCP**：人类定义 workflow，provider 是执行节点，编排权在人类

这意味着 PCP 和 A2A 不在同一层级竞争。PCP 管的是"workflow 节点能做什么"，A2A 管的是"agent 之间怎么通信"。MyClaudia 的多 provider 编排（Claude 写代码 → Codex review → Kimi 写文档）是 hub-and-spoke 模型，由 server 集中调度，provider 之间互不可见，不需要 A2A。

### 29.3 与 ACP 的核心差异

市面上 "ACP" 实际上是两个不同协议：

**ACP-IBM（Agent Communication Protocol）**：
- 定位：跨框架 Agent-to-Agent 通信标准
- 传输：HTTP REST + JSON-RPC，支持异步长任务
- 参与者：对等 peers
- 类比：agent 世界的 HTTP

**ACP-Zed（Agent Client Protocol）**：
- 定位：Editor-to-Agent 通信��准（LSP 的 AI 版）
- 传输：JSON-RPC over stdio
- 已接入：Claude Code、Gemini CLI、Codex、JetBrains、Neovim
- 类比：标准化编辑器与 agent 的接口

**PCP 与两者的差异：**

| 维度 | ACP-IBM / A2A | ACP-Zed | PCP |
|------|--------------|---------|-----|
| 本质 | Agent network protocol | Editor interface | Workflow provider contract |
| 编排权 | Agent 自主 | 编辑器驱动 | 人类定义 workflow |
| 核心问题 | 互操作 | 接口标准化 | 能力协商 + 降级 |
| 参与者 | 对等 peers | Client-Server | Orchestrator-Provider |
| 能力模型 | Agent Card（静态） | 无 | Manifest + EffectiveProfile（动态协商） |
| 降级策略 | 无 | 无 | 显式降级（reject / fallback / emulate） |
| 可靠性分级 | 无 | 无 | strict / best_effort / display_only |
| 事务边界 | 无 | 无 | 事务型 vs 展示型显式区分 |

PCP 的核心创新在于：

1. **运行期能力协商** — 不只是静态声明，根据模型、版本、桥接状态动态计算有效能力
2. **显式降级协议** — 不支持就明确怎么降级，而不是静默失败
3. **可靠性分层** — 同一能力在不同 provider/模式下有不同可靠性等级
4. **事务性边界** — 把"看起来支持"和"真正可靠"区分开

### 29.4 演进方向

PCP 的终态是 **capability-aware workflow runtime 的 provider contract layer**。

```
v1 (当前)     v1.x              v2
  │             │                 │
  │ 内部协议    │ MCP 整合 +     │ Provider Plugin 生态
  │ 成熟        │ 工具桥接自动化  │ + Capability Composition
  │             │                 │ + Fallback Chain
  │             │                 │
  ▼             ▼                 ▼
[声明+协商] → [工具桥接] → [插件生态+能力组合+自动降级]
```

#### v1.x — 内部协议成熟 + MCP 整合

- 完成 capability 声明 + 协商层
- 在 Claude / OpenCode 上跑通交互工具链路
- 前端完全切到统一事件消费
- PCP 的 `tool.define` 契约直接包装为 MCP tool registration
- provider plugin 通过 PCP manifest 声明工具能力，server 自动桥接为 MCP tools

#### v2 — Provider Plugin 生态 + Capability Composition

PCP 的"能力协商 + 降级"核心优势的自然延伸：

- **Provider Plugin 生态**：PCP manifest 标准化后，第三方可以编写 provider plugin，不再需要内建每个 adapter
- **Capability Composition**：组合多个 provider 的能力（provider A 做 chat，provider B 做 code review），PCP 协商层天然支持按 capability 路由
- **Provider Fallback Chain**：基于 capability + reliability 的自动降级链（Claude 不可用时自动切到 OpenCode 的同等能力）
- **运行期能力再协商**：session 中途 provider 状态变化时，动态更新 EffectiveProviderProfile

### 29.5 不做什么

以下方向经过评估，明确不在 PCP 演进路线内：

- **A2A / ACP-IBM agent 互操作**：MyClaudia 没有对外暴露 agent 的需求。多 provider 编排是人类主导的 hub-and-spoke 模型，不需要 agent 自主发现和通信。
- **ACP-Zed editor 接口**：MyClaudia 不是编辑器，其架构是 spawn CLI agent 并消费输出，而非作为 host 向 agent 提供编辑器能力。ACP-Zed 的 Editor-to-Agent 模型与 PCP 的方向相反。
- **通用开放标准**：PCP 服务于 MyClaudia 的内部需求，不追求成为跨应用标准。

### 29.6 与 MCP 的互补关系

PCP 与 MCP 处于不同层级，协同工作：

- **MCP 在下**：PCP 通过 MCP 实现 tool injection（把交互工具注入 provider）
- **PCP 在上**：定义 provider 能力契约，决定哪些工具该注入、provider 是否能可靠消费

---

## 30. Summary

PCP v1 的目标不是重新发明 provider SDK 接入方式，而是建立一条稳定边界：

- 对 provider 来说：实现能力，而不是适配零散特判
- 对 server 来说：协商、路由、归一化、降级
- 对 frontend 来说：只消费统一语义
- 对插件平台来说：provider 可以成为一种可发现、可验证、可动态加载的插件类型

一句话定义：

> **Provider Capability Protocol 是 MyClaudia 用来声明、协商、调用和降级 provider 标准能力的内部协议。**

最可行的落地路径是：

1. 先统一现有结构化交互出口 + 加入 capability 声明
2. 再把交互能力做成内部工具，在 Claude 上跑通
3. 逐步扩到 OpenCode / Codex
4. 对 Cursor / Kimi 明确采用降级策略
5. 最后做 provider 动态插件加载

这条路线既能保留当前多 provider 架构，也能避免前端继续堆 provider 特例。
