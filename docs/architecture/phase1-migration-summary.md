# MyClaudia 领域升级 Phase 1 总结

日期：2026-04-06
状态：In Progress

## 目标

Phase 1 的目标不是重写实现，而是先纠正边界语义：

- 把不应视为领域的模块迁到 `application/` 或 `infrastructure/` 语义
- 为后续真实迁移建立兼容入口
- 让主装配点不再继续扩大旧的伪领域边界

## 本阶段已完成

### 1. Push Notification 迁移到基础设施语义

新增：

- `server/src/infrastructure/push/push-notification-service.ts`

处理方式：

- 真实实现迁到 `infrastructure/push`
- `domains/notification/notification-service.ts` 保留为兼容 re-export
- 主装配点已改为依赖基础设施路径

结论：

- `notification feed` 和 `push channel` 的语义已开始分离

### 2. Orchestration 迁移到应用层语义

新增：

- `server/src/application/orchestration/register.ts`
- `server/src/application/orchestration/types.ts`
- `server/src/application/orchestration/task-orchestrator.ts`
- `server/src/application/orchestration/claudia-branch-service.ts`
- `server/src/application/orchestration/repository.ts`

处理方式：

- 主装配点和关键消费方已改为依赖 `application/orchestration/*`
- 旧 `domains/orchestration/*` 仍保留实现，作为过渡层

结论：

- `orchestration` 已从“平级领域”语义收敛为 process manager / application layer

### 3. Gateway 迁移到基础设施语义

新增：

- `server/src/infrastructure/gateway/manager.ts`
- `server/src/infrastructure/gateway/gateway-instance.ts`
- `server/src/infrastructure/gateway/ws-hub.ts`

处理方式：

- `index.ts`、`server.ts`、`server-setup.ts`、`routes/sessions.ts` 等主入口已切到新路径
- 旧 `domains/gateway/*` 继续承载实现

结论：

- `gateway` 已从业务域语义收敛为 integration / infrastructure

### 4. Conversation 拆出应用层入口

新增：

- `server/src/application/conversation/transport/types.ts`
- `server/src/application/conversation/transport/broadcast.ts`
- `server/src/application/conversation/transport/message-handler.ts`
- `server/src/application/conversation/runtime/run-handler.ts`
- `server/src/application/conversation/runtime/run-lifecycle.ts`
- `server/src/application/conversation/interactions/permission-handler.ts`
- `server/src/application/conversation/interactions/ws-handlers.ts`

处理方式：

- 主装配点 `server.ts`、`server-setup.ts` 已切到 `application/conversation/*`
- 多个 domain register 已改为依赖新的 transport/runtime 入口
- `message-handler` 已改为依赖 `application/conversation/interactions/*`

结论：

- `conversation` 已不再只能通过 `domains/conversation/ws/*` 被理解
- 当前已初步分出三条语义线：
  - `transport`
  - `runtime`
  - `interactions`

## 当前目录语义状态

### 已建立的目标入口

```text
server/src/
  application/
    conversation/
      transport/
      runtime/
      interactions/
    orchestration/
  infrastructure/
    gateway/
    push/
```

### 仍承载主要实现的旧目录

```text
server/src/domains/conversation/ws/
server/src/domains/orchestration/
server/src/domains/gateway/
server/src/domains/notification/
```

说明：

- 这是有意的过渡状态
- 本阶段优先改“装配和依赖语义”，不优先改“物理文件归位”

## 收益

### 已获得的架构收益

1. 主入口不再继续强化错误边界。
2. 新代码可以优先依赖 `application/*` 和 `infrastructure/*` 语义。
3. 第 2 期可以在不破坏主入口的前提下逐步搬实现。
4. 领域升级已经从“文档判断”进入“代码结构显性化”。

## 剩余债务

### A. 仍保留 legacy 实现目录

当前 `application/*` 和 `infrastructure/*` 大量是 re-export / shim。

这不是最终状态，后续应逐步把真实实现搬过去：

1. `domains/orchestration/*` -> `application/orchestration/*`
2. `domains/gateway/*` -> `infrastructure/gateway/*`
3. `domains/conversation/ws/*` -> `application/conversation/*`

### B. 仍存在单例和直接实现依赖

典型问题：

- `conversation runtime -> gateway-instance` 仍是单例访问
- `conversation -> orchestration` 仍是具体类型耦合，而非稳定 port
- `supervision/workflows/local-pr` 仍直接依赖 conversation transport

### C. shared 仍未收缩

当前 `shared` 仍同时承载：

- core types
- feature types
- interaction types
- protocol
- facade runtime

这会继续稀释 bounded context。

### D. 测试与 legacy import 仍未迁移

本阶段没有主动改测试：

- 部分 test mock 仍引用 `domains/gateway/*`
- 部分 ws test 仍直接引用 legacy 路径

这是预期中的待处理项。

## Phase 2 建议拆分

### Batch 1: 解耦 `conversation -> orchestration`

目标：

- 用 port/interface 替代具体 orchestrator / branch service 类型依赖

建议动作：

1. 在 `application/conversation` 定义 `TaskCoordinationPort`
2. 在 `message-handler` / `claudia handler` 只依赖 port
3. 由 composition root 注入 orchestration 实现

### Batch 2: 解耦 `conversation -> gateway`

目标：

- 去掉 runtime 中对 `gateway-instance` 单例的直接感知

建议动作：

1. 为 gateway 能力定义 adapter interface
2. 在 run bootstrap 层通过依赖注入传入
3. 把“是否连着 gateway”从 runtime 逻辑里抽离

### Batch 3: 收缩 shared

目标：

- 把共享包拆成稳定共享内核和协议层

建议动作：

1. 定义 `shared-kernel` 范围
2. 定义 `integration-protocol` 范围
3. 避免 application/domain 继续从总入口 `@my-claudia/shared` 无差别取类型

### Batch 4: 搬运真实实现文件

目标：

- 逐步减少 shim

建议动作：

1. 先搬 `orchestration`
2. 再搬 `gateway`
3. 最后搬 `conversation`

原因：

- `conversation` 牵涉面最大，适合最后做

## 验收标准

Phase 1 结束时，应满足：

1. 新增代码默认从 `application/*` 或 `infrastructure/*` 入口引用。
2. `server.ts` 和 `server-setup.ts` 已不再从错误语义路径装配关键能力。
3. `push`、`gateway`、`orchestration` 的定位已在代码层显性化。
4. `conversation` 已被拆出 `transport/runtime/interactions` 三条语义线。

## 非目标

本阶段刻意不做：

- 大规模文件移动
- 测试路径全面重写
- `shared` 物理拆包
- 聚合/实体规则重写

这些属于第 2 期和第 3 期工作。
