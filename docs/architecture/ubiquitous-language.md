# MyClaudia 统一语言

日期：2026-04-06
状态：Draft

## 目的

统一当前项目里最容易混淆的概念，降低跨上下文重名导致的认知成本。

## 核心词汇

### Project

定义：
项目是顶层工作单元，承载根目录、默认 provider、权限策略、系统提示词等基础配置。

边界：

- `Project` 不等于 Git 仓库，但通常绑定一个工作目录
- `Project` 不等于会话集合，它是会话的归属容器

### Session

定义：
会话是与 AI 交互的连续上下文容器，挂在某个 `Project` 下。

边界：

- `Session` 不是执行进程
- `Session` 不是任务实例
- `Session` 可以承载用户对话，也可以承载后台执行语境

建议子类型语义：

- `regular`: 用户主对话
- `background`: 后台任务上下文
- `agent`: agent 专用执行上下文

### Run

定义：
Run 是一次具体执行过程，从触发到完成或失败的一次运行实例。

边界：

- `Run` 属于运行时概念
- `Run` 可以发生在某个 `Session` 中
- `Run` 不应与 `Session` 混用

### Task

定义：
Task 是带目标和生命周期的工作项。

规则：

- 在没有上下文前缀时，禁止单独使用 `Task`
- 必须显式说清属于哪个上下文

允许的具体名字：

- `SupervisionTask`
- `WorkflowRunStepApprovalTask` 或更精确的工作流等待项
- `OrchestratorTask`
- `SystemTask`

禁止继续扩散的名字：

- 模糊的 `TaskService`
- 不带上下文前缀的 `taskId`

### Workflow

定义：
Workflow 是一个可定义、可触发、可重复执行的自动化流程定义。

边界：

- `Workflow` 是定义
- `WorkflowRun` 是执行实例
- `WorkflowStepRun` 是步骤执行实例

### Supervision

定义：
Supervision 是对任务执行过程的监督能力，包括 checkpoint、review、worktree、恢复与治理。

边界：

- 它不是通用调度器
- 它不是所有 task 的总称

### Orchestration

定义：
Orchestration 是跨上下文协调流程，不是核心业务对象集合。

边界：

- 应作为 process manager 理解
- 不应与 `Workflow` 混为一谈
- 不应承载所有任务语义

### Notification Feed

定义：
Notification Feed 是面向用户的通知流，管理通知项、未读状态、已读状态和广播。

边界：

- feed 是业务概念
- push channel 只是投递手段
- `notification` 和 `push notification` 不能再混用

### Gateway

定义：
Gateway 是远程连接和同步的技术中继上下文。

边界：

- 它不是项目业务的一部分
- 它负责 relay、proxy、presence、backend discovery

## 命名约束

### 必须带上下文前缀的名称

- `Task`
- `State`
- `Manager`
- `Service`
- `Context`

例如：

- 用 `WorkflowScheduleService`，不要只叫 `ScheduleService`
- 用 `GatewayState`，不要只叫 `State`

### 避免复用同一词承载不同语义

- `Run` 只用于执行实例
- `Session` 只用于对话上下文
- `Task` 只用于带目标的工作项
- `Branch` 在 Claudia 语义中表示会话分支，不要混作 Git branch

## 代码落地规则

1. 新增类型前，先检查词汇是否已在别的上下文使用。
2. 类型名与数据库表名允许不同，但语义必须一致。
3. API 字段若沿用历史名称，应在文档中标注目标命名。
4. 新的 `Task`、`Run`、`Manager` 命名必须带上下文限定词。

## 后续治理重点

1. 收敛 `Task` 的多义性。
2. 收敛 `Session` 与 `Run` 的混用。
3. 把 `notification` 和 `push` 从语义上拆开。
4. 将 `orchestration` 从“领域名”收敛为“协调层名”。
