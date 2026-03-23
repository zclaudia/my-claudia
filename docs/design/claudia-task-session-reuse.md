# Claudia Task Session Reuse and Forking Design

## Goal

让 `Claudia Chat` 同时满足下面两件事：

- 连续 follow-up 请求能够复用上下文，而不是每次都丢失前情。
- 多个长耗时 task 可以并行执行，互不污染 session、权限请求和取消链路。

这份设计的核心结论是：

- `task` 继续作为独立的运行单元存在。
- `session` 不再和 `task` 强绑定，而是变成可复用的执行分支。
- 串行 follow-up 默认复用 session。
- 并行新任务默认 fork 新 session。

## Current Problem

当前 `Claudia` 的行为接近于“每个 task 一个 session”：

- 每次 `claudia_message` 都会创建一个新的 `sessions` 记录。
- `claudia_task_continue` 也会 spawn 一个新的 orchestrator task，并在执行时创建新的 session。
- task 结束后 session 默认长期保留，不会自动归档或删除。

这带来两个明显问题：

### 1. 连续对话上下文断裂

用户在 `Claudia Chat` 中连续追问时，系统并不会自然延续前一轮 session。

例子：

1. “帮我查询一下圣何塞未来一周的天气”
2. 几分钟后，“那山景城呢？”

从用户视角，这是明确的 follow-up。  
从当前实现看，这是两个彼此独立的 session。

### 2. 并行能力和上下文连续性无法兼得

如果简单改成“所有请求都复用同一个 Claudia 主 session”，又会立刻破坏并行 task：

- 同一个 provider session 不能安全承载多个并发 run。
- 权限请求无法稳定归属到正确 task。
- `Cancel / Resume / View Details` 会失去明确目标。

所以目标不是“所有 task 共用一个 session”，而是“在该复用时复用，在该 fork 时 fork”。

## Design Principles

- `task` 和 `session` 解耦。一个 task 绑定一个 session branch，但不要求每个 task 都新建 session。
- session 复用只发生在串行 follow-up 场景，不发生在并发执行场景。
- 并行 task 必须拥有独立 session branch。
- UI 需要让用户感知”这是继续之前的上下文”还是”这是新开的分支任务”。
- 现有 `TaskCard`、权限请求、恢复逻辑继续以 `taskId` 为主键，不改成 session 驱动。
- fork 新 branch 时不自动切换 active branch。并行任务是”后台分支”，不影响用户的主对话流。

## Active Task Definition

以下 task 状态视为 **active**，会触发 fork 而非 reuse：

| 状态 | 视为 Active | 原因 |
|------|------------|------|
| `running` | ✅ | session 正在被写入 |
| `queued` | ✅ | 即将运行，session 随时可能被占用 |
| `waiting_permission` | ✅ | 用户授权后会立即恢复运行 |
| `completed` | ❌ | 已结束，session 空闲 |
| `failed` | ❌ | 已结束，session 空闲 |
| `cancelled` | ❌ | 已结束，session 空闲 |

判断逻辑：

```ts
const ACTIVE_STATUSES = ['running', 'queued', 'waiting_permission'] as const;

function branchHasActiveTask(branchId: string): boolean {
  return tasks.some(t => t.branchId === branchId && ACTIVE_STATUSES.includes(t.status));
}
```

## Terminology

### Host Project

固定的 `__claudia` 隐藏项目，作为 Claudia 会话和 task 的宿主项目。

### Task

一次用户请求对应的运行单元，负责：

- 排队、运行、等待权限、完成、失败、取消
- 展示卡片
- View Details / Cancel / Continue / Resume

### Session Branch

一个可被后续 task 复用的执行上下文分支。

它负责：

- 保存 provider 层的 `sdk_session_id`
- 承载该分支的历史消息
- 支持后续 follow-up 继续沿用上下文

### Active Branch

当前 `Claudia Chat` 默认的上下文分支。  
用户发起新请求时，系统优先判断是否复用它。

## Proposed Model

### Core Rule

每个新请求都一定会创建一个新的 `task`，但不一定创建新的 `session branch`。

系统需要先决定：

- `reuse existing branch`
- or `fork new branch`

然后再把这个 task 绑定到选中的 branch 上。

### Rule 1: No Active Task -> Reuse Current Branch

当当前 branch 上没有活跃 task 时，新请求默认复用当前 branch。

适用场景：

- 简单 follow-up
- 同一主题的连续提问
- 用户显然在继续上一轮思路

例子：

1. “帮我查询一下圣何塞未来一周的天气”
2. 等上一个 task 完成后，再问：“那山景城呢？”

这里 task 是新的，但 session branch 复用原来的。

### Rule 2: Active Task Exists -> Fork New Branch

当当前 branch 上已经有活跃 task（参见 Active Task Definition），用户又提交了新请求时，默认 fork 新 branch。

适用场景：

- 原任务仍在 running / waiting_permission / queued
- 用户又发起了新的非阻塞任务

例子：

1. task A：查圣何塞天气
2. task A 还在运行时，用户又发起 task B：”帮我查询最近的重要邮件”

这里 task B 必须新建 branch，不能复用 task A 的 session。

**Active Branch 不变**：fork 新 branch 时，active branch 保持不变。新 branch 作为后台分支存在。这意味着当 task A 完成后，用户在输入框直接打字仍然会走 branch A（follow-up），而非被隐式切换到 branch B。

### Rule 3: Continue from Task -> Prefer Task Branch

用户从某个 task 卡片点 `Continue` 时，默认沿用该 task 所在 branch。

这意味着：

- `Continue` 不是”回到全局当前 branch”
- 而是”沿着这个 task 的上下文继续”
- 同时将该 task 所在的 branch 设为 active branch

这样才能保证 task detail、follow-up 和用户心智一致。

**Continue 遇到 branch 冲突时的降级**：如果目标 branch 上已有活跃 task，Continue 会 fork 新 branch 并标记为 `derived from parent task`。此时新 branch 没有父 branch 的历史上下文（provider session 是全新的），系统应在 UI 上明确提示用户”上下文已重置，因为原对话仍在执行中”，避免用户误以为上下文是连续的。

### Rule 4: Interrupted Resume -> Always Reuse Original Branch

`Resume` 的语义不是发起新 task，而是恢复原 task。  
因此必须复用原来的 session branch，不能 fork。

### Rule 5: Explicit New Conversation -> Force Fork

如果未来 UI 增加 `New Conversation`，它应始终创建新 branch，并把该 branch 设为 active branch。

## Session Allocation Algorithm

新请求进入 `Claudia Chat` 时，按下面顺序决策：

1. 如果是 `Resume interrupted task`
   复用该 task 的 branch
2. 如果是 `Continue` from task
   复用该 task 的 branch
3. 如果用户显式选择 `New Conversation`
   fork 新 branch
4. 如果当前 active branch 上存在活跃 task
   fork 新 branch
5. 否则
   复用 active branch

## Data Model Changes

建议在现有模型上增加“branch”概念，但不一定马上引入新表。MVP 可以先在 `sessions` 上补字段。

### Option A: Minimal Change on `sessions`

在 `sessions` 表增加：

```ts
branch_id TEXT NULL
branch_root_session_id TEXT NULL
branch_title TEXT NULL
last_task_id TEXT NULL
```

语义：

- `branch_id`: session 所属 branch 的稳定 ID
- `branch_root_session_id`: branch 的首个 session
- `branch_title`: branch 的用户可见标题
- `last_task_id`: 最近绑定到该 branch 的 task

MVP 下可以简化成：

- 一个 branch 在任意时刻只对应一个“当前可复用 session”
- fork 时创建新 session，并赋予新 `branch_id`
- reuse 时直接把新 task 绑定到已有 session

### Option B: Introduce `claudia_branches`

更完整但改动更大的方案：

```ts
claudia_branches (
  id TEXT PRIMARY KEY,
  host_project_id TEXT NOT NULL,
  active_session_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_task_id TEXT
)
```

再让 task 或 session 关联到 `branch_id`。

建议：

- 第一阶段先用 Option A
- 等 branch UI 真的成形，再考虑独立 `claudia_branches` 表

## Task Model Changes

在 orchestrator task 上增加：

```ts
branchId?: string | null
```

这样后续能力会更清楚：

- Active Tasks 按 branch 聚合
- 同 branch task 可以在 UI 上显示“continued from previous context”
- 权限请求和恢复逻辑仍然按 `taskId` 走，不受影响

## Backend Changes

### 1. Replace “Always Create New Session” in `claudia_message`

当前 `claudia_message` 的逻辑是：

- 生成 `sessionId`
- 立即 `INSERT INTO sessions`

需要改成：

1. 根据 branch rule 决定 `targetBranch`
2. 如果 `reuse`
   使用 branch 当前 session
3. 如果 `fork`
   创建新 session，并把它设为新 branch 的 active session

### 2. Preserve Branch Reuse in `run_start`

同一 branch 复用 session 时，provider 层继续依赖原有 `sdk_session_id`。

这样才能真正获得：

- 上下文连续
- provider 原生 resume
- 对话级别的记忆延续

#### Session Resume Fallback

Provider session resume 不是总能成功的（session 过期、provider 内部状态丢失、cwd 变化等），需要明确的降级策略：

1. **尝试 resume**：使用原 `sdk_session_id` 发起请求
2. **检测失败**：如果 provider 返回 session 无效 / 超时 / 错误
3. **自动降级**：在同一 branch 内创建新的 provider session，替换掉原来的 `sdk_session_id`
4. **通知用户**：在 task 卡片上显示轻量提示 `Context was reset due to session expiry`
5. **不改变 branch**：降级不触发 fork，branch 逻辑不受影响——用户仍在同一个 branch 中，只是 provider 层的上下文丢失了

```ts
async function resumeOrReset(branch: Branch): Promise<string> {
  try {
    await provider.resume(branch.sdkSessionId);
    return branch.sdkSessionId;
  } catch (e) {
    const newSessionId = await provider.createSession();
    branch.sdkSessionId = newSessionId;
    branch.contextReset = true; // 标记以便 UI 提示
    return newSessionId;
  }
}
```

### 3. Keep `Continue` Semantics Branch-Local

`claudia_task_continue` 不再一律 spawn 一个全新 session。

新规则：

- 如果 parent task 对应 branch 当前没有活跃 task，优先复用 parent branch
- 如果 parent branch 当前已有别的活跃 task，fork 新 branch，但将其标记为 `derived from parent task`（此时新 branch 没有原 branch 的上下文，UI 应提示"上下文已重置"）

### 4. Session Lifecycle

本设计不要求立刻解决自动清理，但需要把“可归档”与“可复用”分开：

- session 是否可复用：由 branch 状态决定
- session 是否需要长期保留：由归档策略决定

换句话说，session 结束后可以不再作为 active branch，但仍然保留历史。

## Frontend Changes

### 1. Active Tasks Panel

现有 `Active Tasks` 面板继续保留，但每个 task 需要额外显示 branch 关系。

建议增加一个轻量标识：

- `Current Conversation`
- `Detached`
- `Continued`

### 2. Branch Awareness in TaskCard

在 task 卡片上增加一个很轻的次级标签：

- `Using current context`
- `Started in new context`
- `Resumed original context`

这比把 session ID 暴露给用户更有意义。

### 3. View Details

`View Details` 打开的仍然是具体 task/session。  
这点不改。

但未来如果有 branch 视图，应该允许从 task detail 回到对应 branch。

### 4. Follow-up Affordance

在输入框附近增加一个很轻的文案提示，告诉用户下一条输入将会：

- `Continue current context`
- 或 `Start a new background context`

MVP 可以先不加显式 selector，只做自动规则。

### 5. Frontend State Management

前端需要引入 branch 感知的状态管理：

**新增状态**：

- `activeBranchId: string | null` — 当前 active branch，存储在 Claudia store 中
- `branches: Map<string, BranchInfo>` — 已知 branch 的元信息（可按需从后端获取）

**消息发送流程变更**：

```ts
// 发送 claudia_message 时，附带 branch 上下文
function sendClaudiaMessage(message: string) {
  ws.send({
    type: 'claudia_message',
    message,
    activeBranchId: store.activeBranchId, // 后端据此决定 reuse/fork
  });
}
```

**后端响应中返回决策结果**：

```ts
// task_created 事件中包含 branch 信息
interface TaskCreatedEvent {
  taskId: string;
  branchId: string;
  branchAction: 'reused' | 'forked'; // 用于 UI 显示标签
  contextReset?: boolean;            // session resume 降级时为 true
}
```

**Active branch 切换规则**：

- 初始化时：如果存在上次的 active branch，恢复它；否则为 null（下次请求会创建新 branch）
- Continue from task：切换 active branch 到该 task 的 branch
- New Conversation：创建新 branch 并切换
- Fork（并行任务）：**不切换** active branch

## UX Examples

### Example A: Serial Follow-up

1. 用户：“查圣何塞天气”
2. 系统创建 `task A`，创建 `branch A`
3. task A 完成
4. 用户：“那山景城呢？”
5. 系统创建 `task B`，复用 `branch A`

结果：

- 两个 task 卡片独立存在
- 但底层上下文连续

### Example B: Parallel Tasks

1. 用户：“查圣何塞天气”
2. 系统创建 `task A`，创建 `branch A`
3. task A 仍在运行
4. 用户：“帮我查询最近的重要邮件”
5. 系统创建 `task B`，fork `branch B`

结果：

- A、B 并行运行
- 权限请求、取消、View Details 都能稳定归属
- 两边上下文互不污染

### Example C: Continue from Old Task

1. 用户打开旧的天气 task
2. 点击 `Continue`
3. 输入：“那下周气温变化趋势呢？”

结果：

- 创建新 task
- 默认复用该旧 task 所属 branch，而不是当前全局 active branch

## Migration Plan

### Phase 1: Branch Metadata Without Behavior Change

- 给 session / task 增加 `branchId`
- 新建 task 时先记录 branch 信息
- UI 可以开始显示 branch 标签
- 仍然保持当前“一 task 一 session”行为

目的：

- 先把模型和观测铺好
- 不先动 provider resume 语义

### Phase 2: Reuse When No Active Task

- 在 `claudia_message` 中加入 reuse/fork 决策
- 当前 branch 无活跃 task 时复用 session
- 当前 branch 有活跃 task 时 fork

这是最关键的一步。

### Phase 3: Continue Semantics Cleanup

- `Continue` 改成 branch-local
- `Resume` 明确绑定原 branch
- Active Tasks / TaskCard 增加上下文来源标签

### Phase 4: Optional Branch UI

- 允许用户显式 `New Conversation`
- 允许切换当前 active branch
- 可选显示 branch 历史

## Risks

### 1. Provider Resume Inconsistency

不同 provider 对 session resume 的稳定性不同。  
特别是 cwd、工作目录、底层会话损坏等问题，都会影响 branch reuse。

缓解：

- 保留现有 `sdk_session_id` reset/retry 逻辑
- branch reuse 只在明确安全时启用

### 2. Hidden Coupling Between Task and Session

当前很多逻辑默认认为：

- 一个 task 对应一个 session

改成 branch model 后，需要检查这些链路：

- permission request 过滤
- interrupted restore
- View Details
- Cancel fallback
- task hydration

### 3. User Mental Model

如果系统 silently fork，用户可能意识不到上下文已经断开。

缓解：

- 在 task 卡片和输入区给出轻量文案提示
- 避免把复杂 session 术语直接暴露给用户

## Recommendation

建议按下面顺序落地：

1. 先引入 `branchId`
2. 保持 task 独立
3. 只在“当前 branch 没有活跃 task”时启用 session reuse
4. 并发情况下强制 fork
5. `Continue` 和 `Resume` 显式绑定原 branch

这条路径能解决当前最真实的用户问题：

- follow-up 不再丢上下文
- 并行任务仍然安全
- 不需要一开始就做复杂 branch UI

## Non-Goals

这份设计当前不解决：

- session 自动归档 / 自动删除策略
- 多 branch 的完整可视化时间线
- 跨 branch 合并上下文
- 多 task 共用同一个并发 provider run

这些都可以在 session reuse 稳定之后再做。
