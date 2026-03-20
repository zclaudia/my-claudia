# Unified Provider Interaction Protocol Draft

## Goal

在现有多 provider 架构上，收敛一套由 `my-claudia` 自己定义的交互协议，让前端不再直接消费 provider-specific 的消息能力。

这份方案要解决的核心问题是：

- 不同 provider 对交互能力的支持差异很大
- Claude 已支持较强的结构化交互，其他 provider 更多是纯文本或弱工具能力
- 前端已经开始被 provider 差异拖着走，例如 `AskUserQuestion`、`TodoWrite`、permission 事件、工具参数结构不一致
- 我们希望像 `push file` 一样，把自己的交互能力注入给不同 provider，而不是等待上游能力统一

目标不是让所有 provider 真正获得完全等价的底层能力，而是做到：

- 前端只理解一套统一交互事件
- server 负责 provider 差异吸收、工具桥接和降级策略
- provider 只负责产出原始事件，或调用我们注入的内部工具

## Non-Goals

- 不追求所有 provider 在底层能力上完全等价
- 不在第一阶段引入 ACP、A2A 或新的跨 agent 标准协议
- 不要求所有纯文本 provider 都可靠地产生事务型交互
- 不在前端继续堆更多 provider 特判

## Problem Summary

当前代码里已经能看到几个问题：

- 前端直接依赖具体工具名和字段结构，例如 `AskUserQuestion`、`TodoWrite`
- provider 之间的工具输入格式并不一致，例如同样是 todo 更新，有的路径是 `todos`，有的路径是 `items`
- Claude 目前有最强的结构化交互路径，但其他 provider 只能部分映射为 `tool_use`、permission 或纯文本
- 一些交互目前是“展示上看起来像支持”，但实际上没有稳定的回填事务路径

这意味着如果继续让前端直接处理 provider 原始消息：

- UI 会不断增加 provider 分支
- 数据结构难以稳定
- 事务型交互会越来越难做对
- 新 provider 接入成本会持续上升

## Design Principles

- 前端只消费 `my-claudia` 自己定义的语义事件，不消费 provider 原始事件
- 所有 provider 统一先进入 server 归一化层
- 展示型交互和事务型交互必须区分处理
- 事务型交互不能依赖文本推断，必须来自明确工具调用或原生结构化事件
- 能力统一优先通过“内部工具注入”，而不是要求 provider 原生支持
- 所有工具输入必须 server 侧做 schema 校验，不能信任模型
- 对弱 provider 允许降级，但降级策略必须显式

## Provider Support Snapshot

以下判断基于当前仓库实现，不是官方产品能力总表。

### Claude

- 当前支持度：强
- 已有能力：
  - 原生结构化工具事件
  - `AskUserQuestion` 专门走 permission callback 交互路径
  - 已有 plugin MCP bridge 注入能力
- 结论：
  - 最适合作为统一交互协议的第一落地点
  - 可同时支持“原生结构化事件映射”和“内部工具注入”

### OpenCode

- 当前支持度：中
- 已有能力：
  - 稳定 `tool_use`
  - 有 `permission.updated` 这类结构化 permission 事件
  - agent / model 能力较灵活
- 缺口：
  - 当前仓库还没有像 Claude 一样的自定义交互工具桥接
- 结论：
  - 第二阶段适合接入

### Codex

- 当前支持度：中偏弱
- 已有能力：
  - 结构化 `tool_use`
  - 能识别 `mcp_tool_call`
- 缺口：
  - 现有接入中没有真正挂载自定义工具桥
- 结论：
  - 有希望接入统一交互工具，但需要额外桥接层

### Cursor

- 当前支持度：弱
- 已有能力：
  - `tool_call` 能映射成 `tool_use`
- 缺口：
  - 目前更像 CLI 输出映射，不是我们控制工具注册表
  - 没有现成的交互工具桥
- 结论：
  - 短期适合消费统一事件，不适合优先做工具注入

### Kimi

- 当前支持度：弱
- 已有能力：
  - 可解析 `tool_use`
- 缺口：
  - 当前实现主要是 CLI `stream-json` 适配
  - 没有现成交互工具桥
- 结论：
  - 适合文本降级和基础事件统一，不适合第一批复杂交互注入

## Proposed Architecture

建议把方案拆成 4 层。

### 1. Provider Raw Event Layer

这一层保留 provider 产生的原始运行事件。

示例：

- `assistant text`
- `tool_use`
- `tool_result`
- `permission request`
- `task_notification`

这一层不暴露给前端，只在 server 内部使用。

### 2. Interaction Tool Layer

这一层定义 `my-claudia` 自己的内部交互工具。

第一批建议只做 3 个：

- `ask_user_form`
- `request_approval`
- `update_todo_list`

后续可扩展：

- `submit_plan_for_review`
- `notify_user`
- `select_session_target`

这些工具不等于 provider 原生工具，而是“我们定义的产品能力”。

### 3. Normalization Layer

这一层负责把两类输入统一映射成一套协议：

- provider 原生结构化交互
- 我们的内部交互工具调用

输出是统一的 `NormalizedInteractionEvent`。

### 4. Frontend Interaction Layer

前端只消费统一事件，不感知：

- provider 类型
- 原始 tool name
- provider 私有字段
- provider 私有 permission 结构

前端只做：

- 渲染统一交互 UI
- 发送统一交互结果
- 展示降级状态

## Unified Event Schema

建议新增一套 server 到 frontend 的统一交互事件。

```ts
export type NormalizedInteractionEvent =
  | AskUserInteractionEvent
  | ApprovalInteractionEvent
  | TodoUpdateInteractionEvent
  | PlanReviewInteractionEvent
  | NoticeInteractionEvent;

export interface InteractionEventBase {
  id: string;
  sessionId: string;
  runId?: string;
  provider: 'claude' | 'opencode' | 'codex' | 'cursor' | 'kimi' | string;
  source: 'provider_native' | 'tool_call' | 'text_inferred';
  createdAt: number;
}

export interface AskUserInteractionEvent extends InteractionEventBase {
  type: 'interaction.ask_user';
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

export interface ApprovalInteractionEvent extends InteractionEventBase {
  type: 'interaction.approval';
  title: string;
  message: string;
  approveLabel?: string;
  rejectLabel?: string;
  payload?: Record<string, unknown>;
}

export interface TodoUpdateInteractionEvent extends InteractionEventBase {
  type: 'interaction.todo_update';
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface PlanReviewInteractionEvent extends InteractionEventBase {
  type: 'interaction.plan_review';
  title?: string;
  content: string;
}

export interface NoticeInteractionEvent extends InteractionEventBase {
  type: 'interaction.notice';
  level: 'info' | 'warning' | 'error';
  message: string;
}
```

关键点：

- `source` 必须保留，方便区分事件来自原生结构化能力、内部工具还是文本推断
- `text_inferred` 只允许用于展示型事件，不允许用于事务型回填
- 所有事务型事件都必须有稳定 `id`

## Internal Tool Contract

建议把内部交互工具 schema 固定下来，不允许 provider 各自定义变体。

### `ask_user_form`

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

### `request_approval`

```ts
{
  title: string;
  message: string;
  approveLabel?: string;
  rejectLabel?: string;
  payload?: Record<string, unknown>;
}
```

### `update_todo_list`

```ts
{
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}
```

这些工具的输出不进入普通 tool result 区域，而是由 server 直接转为统一交互事件。

## Provider Integration Strategy

### Path A: Native Structured Interaction

适用于 Claude 这类已经有较强结构化交互能力的 provider。

处理方式：

- 保留 provider 原生结构化能力
- 在 normalization 层映射为统一事件
- 需要时也允许它调用内部交互工具

优点：

- 保真度高
- 交互结果更可靠

### Path B: Internal Tool Injection

适用于支持工具调用、但没有现成结构化交互能力的 provider。

处理方式：

- 把内部交互工具注入 provider
- 模型调用这些工具时，server 直接发统一事件给前端

优点：

- 不依赖 provider 原生交互模型
- 统一程度高

前提：

- provider 工具调用足够稳定
- 我们能控制工具注册

### Path C: Text Degradation

适用于弱工具能力 provider，或当前暂时无法桥接的 provider。

处理方式：

- 能识别的展示型交互，映射为 `interaction.notice` 或只读 `interaction.todo_update`
- 无法可靠识别或需要事务回填的交互，一律降级为普通 assistant text

原则：

- 不能因为想统一体验，就对事务型交互做不可靠推断

## Transactional vs Display Interactions

这是整个方案最重要的边界。

### Display Interactions

包括：

- todo 列表展示
- plan 预览
- notice / warning

这类可以接受：

- 文本推断
- 不完全结构化
- 降级渲染

### Transactional Interactions

包括：

- 用户表单回答
- 审批 / 拒绝
- 权限确认
- 需要把结果回写给 run 的交互

这类必须满足：

- 来自 provider 原生结构化事件，或
- 来自内部工具明确调用

这类不能只从文本中猜，否则会出现：

- UI 看起来可以交互
- 但系统没有稳定的回填事务路径

## Server-Side Modules

建议新增 3 个核心模块。

### `interaction-tool-registry.ts`

职责：

- 定义内部交互工具
- 提供 schema
- 提供工具元数据

### `interaction-normalizer.ts`

职责：

- 把 provider 原始事件映射成统一事件
- 把内部工具调用映射成统一事件
- 统一字段名和状态值

### `interaction-dispatcher.ts`

职责：

- 把统一交互事件发给 websocket client
- 处理用户提交结果
- 关联 session / run / request lifecycle

## Frontend Changes

前端目标是从“认 provider”改成“认 interaction type”。

建议新增：

- `interactionStore`
- `InteractionRenderer`
- `InteractionResultDispatcher`

前端只处理：

- `interaction.ask_user`
- `interaction.approval`
- `interaction.todo_update`
- `interaction.plan_review`
- `interaction.notice`

现有 `ToolCallItem` 里与交互强绑定的部分，长期应从工具渲染里剥离出去，迁到 interaction renderer。

## Capability Descriptor

建议给每个 provider 增加运行时能力描述，不只保留现有 UI 里的 `modes` / `models`。

示例：

```ts
export interface ProviderInteractionCapabilities {
  supportsNativeStructuredInteraction: boolean;
  supportsInternalInteractionTools: boolean;
  supportsReliableToolArguments: boolean;
  supportsTextInferenceFallback: boolean;
}
```

用途：

- 决定优先走原生映射、工具注入还是文本降级
- 避免在代码里散落 `if (provider === 'claude')`

## Prompt Strategy

如果要让不同 provider 主动调用内部交互工具，system prompt 必须明确约束。

建议加入统一规则：

- 需要用户在多个选项中做结构化选择时，必须调用 `ask_user_form`
- 需要用户审批时，必须调用 `request_approval`
- 更新任务列表时，必须调用 `update_todo_list`
- 不允许只用自然语言模拟这些交互，除非 provider 不支持工具且当前处于降级路径

这个 prompt 规则应由 server 注入，而不是散落在前端或 provider 特例里。

## Rollout Plan

### Phase 1: Normalize Existing Interactions

目标：

- 不先做新工具注入
- 先统一已有结构化交互出口

工作项：

- 定义 `NormalizedInteractionEvent`
- 新增 normalization + dispatcher
- 把 Claude `AskUserQuestion` 映射到 `interaction.ask_user`
- 把现有 `TodoWrite` 全部统一为 `interaction.todo_update`
- 前端新增 interaction renderer，但保留旧 tool UI 兼容

产出：

- 前端不再直接依赖 provider-specific 交互事件

### Phase 2: Internal Tool MVP on Claude

目标：

- 在 Claude 路径先跑通内部交互工具

工作项：

- 定义 `ask_user_form`
- 定义 `request_approval`
- 定义 `update_todo_list`
- 通过现有 MCP bridge / plugin tool 注入机制接到 Claude
- server 将工具调用转换成统一事件

产出：

- 第一条完整“内部交互工具 -> 统一事件 -> 前端 -> 回填”链路

### Phase 3: Expand to OpenCode

目标：

- 把内部交互工具能力接到 OpenCode

工作项：

- 增加 OpenCode 工具桥接
- 处理 permission / tool_use 的统一映射
- 对齐事务回填路径

### Phase 4: Evaluate Codex

目标：

- 验证 Codex 是否值得接入内部交互工具桥

工作项：

- 评估当前 `mcp_tool_call` 和 SDK 接入的可控性
- 能稳定注入则接入，不能则暂时保留统一消费和文本降级

### Phase 5: Cursor / Kimi Degradation Strategy

目标：

- 明确弱 provider 的边界，而不是硬凑一致性

工作项：

- 只做只读展示型事件统一
- 事务型交互明确降级
- 保留普通文本 fallback

## Risks

### 工具调用稳定性风险

不同 provider 对工具调用的稳定性差异很大。即使支持 tools，也可能出现：

- 不调用
- 乱调用
- 参数缺失
- 参数结构漂移

缓解方式：

- server schema 校验
- 必填字段 fail-fast
- provider 级 capability gating

### 前端与工具 UI 双轨并存风险

短期内现有 `ToolCallItem` 和新 `InteractionRenderer` 会共存。

缓解方式：

- 先把事务型交互迁到 interaction 层
- 展示型工具暂时保留在 tool call UI
- 等稳定后再逐步收缩 `ToolCallItem` 特例

### 文本推断误判风险

如果把事务型交互建立在文本推断上，会造成假交互。

缓解方式：

- 只允许展示型交互使用 `text_inferred`
- 事务型交互必须来自明确结构化来源

## Recommended MVP Scope

建议把第一版范围压到最小：

- 统一事件：
  - `interaction.ask_user`
  - `interaction.todo_update`
  - `interaction.notice`
- 内部工具：
  - `ask_user_form`
  - `update_todo_list`
- Provider：
  - 先做 `claude`
  - `opencode` 作为第二阶段

不要第一版就做：

- 所有 provider 同步接入
- 复杂 plan review 事务流
- 文本推断驱动的审批流程

## Summary

这套方案的本质不是“让不同 provider 拥有相同能力”，而是：

- 让 `my-claudia` 拥有自己的交互协议
- 让 server 成为 provider 差异吸收层
- 让前端只消费统一语义事件

最可行的路径是：

1. 先统一现有结构化交互出口
2. 再把交互能力做成内部工具
3. 先在 Claude 上跑通
4. 再逐步扩到 OpenCode / Codex
5. 对 Cursor / Kimi 明确采用降级策略

这条路线既能保留当前多 provider 架构，也能避免前端继续堆 provider 特例。
