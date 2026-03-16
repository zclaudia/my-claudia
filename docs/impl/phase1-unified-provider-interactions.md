# Phase 1: Unified Provider Interactions (MVP)

> **Goal**: 在不重写现有 provider 运行链路的前提下，先把现有结构化交互统一收口到 server 侧，并让前端开始消费 `my-claudia` 自己的 interaction 事件。
>
> **Constraint**:
> - 第一阶段不做新的 provider 工具注入桥
> - 第一阶段不移除现有 `tool_use` / `tool_result` UI
> - 第一阶段只统一已有交互出口
> - 第一阶段优先支持 `AskUserQuestion` 和 `TodoWrite`

---

## 1. Scope

### In Scope

- 新增统一 interaction 事件类型
- server 新增 interaction normalization 层
- server 新增 interaction dispatch 层
- 把现有 `ask_user_question` 统一映射为 `interaction.ask_user`
- 把现有 `TodoWrite` / `todo_list` 类输入统一映射为 `interaction.todo_update`
- 前端新增 interaction store
- 前端新增 interaction renderer
- 前端开始优先渲染统一 interaction 事件
- 保留旧 tool 渲染作为兼容 fallback

### Out of Scope

- Claude 自定义工具桥扩展
- OpenCode / Codex 工具注入
- Cursor / Kimi 的文本推断事务回填
- 完整替换 `ToolCallItem`
- 改数据库 schema 存储 interaction 历史
- 改 session sync 协议存储结构

## 2. Phase 1 Deliverables

本阶段完成后，系统应该满足：

- 前端不再直接依赖 `ask_user_question` 来实现用户问答 UI
- `TodoWrite` 不再只作为普通工具展示，而是可以进入统一 interaction 渲染层
- provider 交互差异开始在 server 吸收，而不是继续扩散到前端
- 后续 Phase 2 可以在不改前端协议的情况下，接入 Claude 内部交互工具

## 3. Existing Paths To Reuse

当前代码里已经有几条可以直接复用的链路。

### Server Existing Paths

- `server/src/server.ts`
  - 负责 provider 消息转发
  - 负责 `ask_user_question`
  - 负责 `permission_request`
  - 已经有 websocket 广播逻辑

- `server/src/providers/*`
  - 已经把不同 provider 归一为统一 `ClaudeMessage` 风格消息
  - 现有统一事件包括 `tool_use`、`tool_result`、`assistant`、`error`

### Frontend Existing Paths

- `apps/desktop/src/services/messageHandler.ts`
  - 统一消费 websocket 消息

- `apps/desktop/src/stores/askUserQuestionStore.ts`
  - 已有问答 pending 状态管理

- `apps/desktop/src/components/chat/InlineAskUserQuestion.tsx`
  - 已有问答 UI

- `apps/desktop/src/components/chat/ToolCallItem.tsx`
  - 已有 `TodoWrite`、`AskUserQuestion` 的工具级渲染

## 4. Target Architecture For Phase 1

第一阶段不改 provider adapter 输入输出协议，只在 server 现有统一消息层之上，新增一个 interaction normalization step。

数据流变为：

1. provider 输出原始统一消息
2. `server.ts` 处理 run / tool / permission 生命周期
3. interaction normalizer 识别可提升为统一交互的消息
4. server 广播新的 `interaction_*` 事件
5. frontend `messageHandler` 写入 interaction store
6. chat UI 渲染 interaction

注意：

- 原始 `tool_use` / `tool_result` 仍然保留
- interaction 是额外的“语义层事件”，不是替代所有原始消息

## 5. Shared Type Changes

文件：

- `shared/src/index.ts`

### 5.1 Add New Shared Types

新增：

```ts
export type InteractionEventSource =
  | 'provider_native'
  | 'tool_call'
  | 'text_inferred';

export interface InteractionBaseMessage {
  interactionId: string;
  sessionId: string;
  runId?: string;
  provider?: string;
  source: InteractionEventSource;
  createdAt: number;
}

export interface AskUserInteractionMessage extends InteractionBaseMessage {
  type: 'interaction_ask_user';
  questions: AskUserQuestionItem[];
}

export interface TodoUpdateInteractionMessage extends InteractionBaseMessage {
  type: 'interaction_todo_update';
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface InteractionResolvedMessage {
  type: 'interaction_resolved';
  interactionId: string;
  sessionId?: string;
}
```

### 5.2 Extend ServerMessage Union

把下面类型加入 `ServerMessage`：

- `AskUserInteractionMessage`
- `TodoUpdateInteractionMessage`
- `InteractionResolvedMessage`

### 5.3 No Client Protocol Change In Phase 1

第一阶段不新增新的 client -> server interaction 提交协议：

- `AskUserQuestion` 继续复用现有 `ask_user_answer`
- `TodoUpdate` 第一阶段只做展示，不做前端提交

## 6. Server Changes

### 6.1 New Module: `server/src/interactions/interaction-normalizer.ts`

新增职责：

- 从现有 provider tool / permission 事件中识别 interaction
- 统一字段名
- 屏蔽 provider 差异

建议导出：

```ts
export function normalizeInteractionFromToolUse(args: {
  sessionId: string;
  runId?: string;
  providerType?: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
}): AskUserInteractionMessage | TodoUpdateInteractionMessage | null;

export function normalizeInteractionFromAskUserRequest(args: {
  requestId: string;
  sessionId: string;
  runId?: string;
  providerType?: string;
  questions: AskUserQuestionItem[];
}): AskUserInteractionMessage;
```

### 6.2 Normalization Rules

#### Rule A: Existing AskUserQuestion Path

来源：

- `server.ts` 当前生成的 `ask_user_question`

处理：

- 保持旧 `ask_user_question` 继续发，避免立即破坏旧 UI
- 同时额外发一个 `interaction_ask_user`
- `interactionId` 可先复用 `requestId`

#### Rule B: TodoWrite / todo_list

识别来源：

- provider tool name = `TodoWrite`
- 兼容以下输入结构：
  - `{ todos: [...] }`
  - `{ items: [...] }`
  - `{ list: [...] }`
  - 单对象 `{ content, status }`

处理：

- 映射为 `interaction_todo_update`
- `interactionId` 可先复用 `toolUseId`
- `source = 'provider_native'`

### 6.3 New Module: `server/src/interactions/todo-normalizer.ts`

建议把 todo 归一化单独拆出来，因为这块已经在前端踩过结构不稳定的问题。

导出：

```ts
export interface NormalizedTodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export function normalizeTodoItems(value: unknown): NormalizedTodoItem[];
```

规则：

- 接受数组 / 单对象 / 字符串化 JSON
- 接受 `todos` / `items` / `list`
- 无法解析时返回空数组，不抛异常

### 6.4 New Module: `server/src/interactions/interaction-dispatcher.ts`

职责：

- 对接 websocket client 广播
- 统一 interaction 事件发送
- 负责 resolved 广播

建议导出：

```ts
export function dispatchInteractionEvent(...): void;
export function dispatchInteractionResolved(...): void;
```

### 6.5 `server/src/server.ts` Integration Points

需要改的点：

#### A. `ask_user_question` 发送处

在当前发送：

- `ask_user_question`

的地方，同时发送：

- `interaction_ask_user`

#### B. `tool_use` 处理处

在现有 `case 'tool_use'` 中：

- 继续保存和转发原始 `tool_use`
- 然后调用 `normalizeInteractionFromToolUse()`
- 若有 interaction，额外广播 interaction 事件

#### C. `ask_user_answer` 处理处

在现有问答 resolved 逻辑里：

- 保持旧 `ask_user_question_resolved`
- 同时追加 `interaction_resolved`

### 6.6 Tests To Add

新增：

- `server/src/interactions/__tests__/todo-normalizer.test.ts`
- `server/src/interactions/__tests__/interaction-normalizer.test.ts`

补充：

- `server/src/routes/...` 不需要改
- `server/src/server.ts` 相关测试补 interaction 广播断言

## 7. Frontend Changes

### 7.1 New Store: `apps/desktop/src/stores/interactionStore.ts`

建议新增 state：

```ts
interface InteractionState {
  interactionsBySession: Record<string, InteractionMessage[]>;
  upsertInteraction: (sessionId: string, event: InteractionMessage) => void;
  resolveInteraction: (interactionId: string) => void;
  clearInteractionsForSession: (sessionId: string) => void;
  getInteractionsForSession: (sessionId: string) => InteractionMessage[];
}
```

说明：

- 第一阶段 interaction 不需要复杂分页
- 只需要跟随 session 当前消息流维护即可

### 7.2 Update `apps/desktop/src/services/messageHandler.ts`

新增处理分支：

- `interaction_ask_user`
- `interaction_todo_update`
- `interaction_resolved`

处理逻辑：

- `interaction_ask_user`：
  - 写入 `interactionStore`
  - 同时继续兼容写入 `askUserQuestionStore`，避免现有 UI 立即断

- `interaction_todo_update`：
  - 写入 `interactionStore`

- `interaction_resolved`：
  - 标记 interaction resolved

### 7.3 New Renderer: `apps/desktop/src/components/chat/InteractionItem.tsx`

职责：

- 按 interaction 类型渲染

第一阶段只支持：

- `interaction_ask_user`
- `interaction_todo_update`

不支持的类型直接 return null。

### 7.4 Update `apps/desktop/src/components/chat/MessageList.tsx`

目标：

- 在 session 消息列表里，把 interaction 渲染到合适位置

第一阶段最稳妥的做法不是复杂 interleave，而是：

- 先在当前 session 的底部或最后一个 assistant block 后渲染“活动 interaction”

原因：

- 这样能最小改动上线统一 interaction 层
- 不需要第一阶段就改消息持久化结构

### 7.5 Keep Existing UI As Fallback

保留：

- `InlineAskUserQuestion`
- `AskUserQuestionModal`
- `ToolCallItem` 里的 `TodoWrite`

但策略改为：

- 优先展示 interaction 层
- 旧 UI 作为 fallback 和兼容路径

## 8. Phase 1 File Checklist

### Shared

- `shared/src/index.ts`

### Server

- `server/src/interactions/interaction-normalizer.ts`
- `server/src/interactions/todo-normalizer.ts`
- `server/src/interactions/interaction-dispatcher.ts`
- `server/src/interactions/__tests__/interaction-normalizer.test.ts`
- `server/src/interactions/__tests__/todo-normalizer.test.ts`
- `server/src/server.ts`

### Desktop

- `apps/desktop/src/stores/interactionStore.ts`
- `apps/desktop/src/services/messageHandler.ts`
- `apps/desktop/src/components/chat/InteractionItem.tsx`
- `apps/desktop/src/components/chat/MessageList.tsx`
- `apps/desktop/src/components/chat/__tests__/InteractionItem.test.tsx`
- `apps/desktop/src/services/__tests__/messageHandler.test.ts`

## 9. Data Flow Example

### 9.1 AskUserQuestion

1. Claude 触发 `AskUserQuestion`
2. `server.ts` 现有 permission callback 路径生成 `ask_user_question`
3. 同时调用 interaction dispatcher 发出：

```json
{
  "type": "interaction_ask_user",
  "interactionId": "req-123",
  "sessionId": "sess-1",
  "source": "provider_native",
  "provider": "claude",
  "questions": [...]
}
```

4. 前端 `messageHandler` 同时写入：
   - `askUserQuestionStore`
   - `interactionStore`
5. `MessageList` 优先渲染 interaction UI
6. 用户回答后继续走现有 `ask_user_answer`
7. server 发 `interaction_resolved`

### 9.2 TodoWrite

1. provider 发出：

```json
{
  "type": "tool_use",
  "toolName": "TodoWrite",
  "toolInput": { "items": [...] }
}
```

2. `server.ts` 正常转发 `tool_use`
3. 同时调用 `normalizeInteractionFromToolUse`
4. 归一化后发出：

```json
{
  "type": "interaction_todo_update",
  "interactionId": "tool-123",
  "sessionId": "sess-1",
  "source": "provider_native",
  "provider": "codex",
  "todos": [...]
}
```

5. 前端优先渲染 interaction todo 卡片

## 10. Acceptance Criteria

### Functional

- Claude 现有问答交互能通过 interaction 层渲染
- TodoWrite 在 `todos` / `items` / 单对象情况下都不崩
- 前端新增 interaction 渲染后，不影响原有 run / tool / permission 流程

### Compatibility

- 旧 `ask_user_question` UI 仍然可用
- `ToolCallItem` 仍可作为旧路径 fallback
- 旧 provider adapter 不需要改签名

### Stability

- 归一化层对异常 payload 不抛异常
- websocket 广播不会因为 interaction 解析失败而中断原始消息转发

## 11. Risks In Phase 1

### 双轨渲染重复展示

风险：

- 一个 ask_user 或 todo 可能在 interaction 层和 tool UI 里都出现

缓解：

- 第一阶段允许短期重复
- 通过 feature flag 或前端优先级控制逐步切走旧展示

### interaction 不持久化

风险：

- session reload 后 interaction 历史可能不完整

缓解：

- 第一阶段只要求实时链路打通
- interaction 持久化放到 Phase 2 或 Phase 3

### 旧 store 与新 store 状态不一致

风险：

- `askUserQuestionStore` 和 `interactionStore` 并行维护可能漂移

缓解：

- 第一阶段只把 ask_user 双写
- resolved 统一由同一 websocket 事件驱动

## 12. Recommended Implementation Order

按下面顺序落地最稳：

1. `shared/src/index.ts`
2. `server/src/interactions/todo-normalizer.ts`
3. `server/src/interactions/interaction-normalizer.ts`
4. `server/src/interactions/interaction-dispatcher.ts`
5. `server/src/server.ts` integration
6. server tests
7. `apps/desktop/src/stores/interactionStore.ts`
8. `apps/desktop/src/services/messageHandler.ts`
9. `apps/desktop/src/components/chat/InteractionItem.tsx`
10. `apps/desktop/src/components/chat/MessageList.tsx`
11. desktop tests

## 13. Exit Criteria For Moving To Phase 2

只有满足下面条件，才进入“内部交互工具注入”阶段：

- interaction 协议字段稳定
- ask_user 和 todo update 已经不再依赖 provider-specific UI 才能工作
- server normalization 层证明能吸收 provider 差异
- 前端能够只根据 interaction type 渲染，不依赖 tool name

达到这些条件后，Phase 2 才去做：

- Claude 内部交互工具注入
- 新的 `ask_user_form` / `request_approval` / `update_todo_list`
- interaction 持久化与历史回放
