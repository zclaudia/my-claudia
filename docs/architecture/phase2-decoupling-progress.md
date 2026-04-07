# MyClaudia 领域升级 Phase 2 进度

日期：2026-04-06
状态：In Progress

## 目标

Phase 2 的目标是从“语义纠正”进入“真实解耦”：

- 去掉 `conversation` 对协调层和集成层的具体实现依赖
- 把跨上下文协作收成明确的 port / adapter
- 让 composition root 成为依赖拼装的唯一位置

## 已完成

### 1. `conversation -> orchestration` 收成 `TaskCoordinationPort`

新增：

- `server/src/application/conversation/task-coordination-port.ts`

当前效果：

- `message-handler` 不再直接依赖 `TaskOrchestrator` / `BranchAllocatorPort`
- `claudia` handlers 改为依赖 `TaskCoordinationPort`
- `server.ts` 负责把 `taskOrchestrator + branchAllocator` 组合成 port 实现

### 2. `conversation runtime -> gateway singletons` 收成 `SessionSyncPort`

新增：

- `server/src/application/conversation/session-sync-port.ts`

当前效果：

- `run-bootstrap` 不再直接调用 `getGatewayClient()`
- `run-recovery` 不再直接调用 `getGatewayClient()`
- `RunHandlerContext` 通过 `sessionSync` 注入同步能力
- `server.ts` 在 composition root 中把 gateway client 单例包装成最小同步 adapter

## 当前状态

### 已建立的 port

```text
conversation
  -> TaskCoordinationPort
  -> SessionSyncPort
```

### 已去掉的直接依赖

- `conversation/ws/message-handler` -> `TaskOrchestrator`
- `conversation/ws/message-handler` -> `BranchAllocatorPort`
- `conversation/ws/run-bootstrap` -> `getGatewayClient`
- `conversation/ws/run-recovery` -> `getGatewayClient`

## 剩余问题

### A. `agent-tools` 已收成独立 port，但真实实现仍由 orchestration 提供

新增：

- `server/src/application/conversation/agent-task-port.ts`

说明：

- `task-tools.ts` 已不再直接依赖 `TaskOrchestrator`
- 但它的 port 实现仍在 orchestration register 中组合
- 这属于当前阶段可接受的 composition root 适配

### B. `server.ts` 里仍有组合适配逻辑

这属于当前阶段可接受的妥协，但后续可以继续收敛到更明确的 factory / adapter module。

### C. gateway / orchestration 的真实实现文件仍在 legacy 目录

本阶段没有物理搬运文件，只完成了解耦和入口收敛。

## 下一步建议

### Batch 3: 收缩 `shared`

已完成：

1. 完成服务端 `@my-claudia/shared` 使用面的扫描
2. 产出 `shared` 收缩计划文档
3. 为 `shared` 增加受控子路径 exports
4. 在服务端装配层开始使用子路径导入示范

参考：

- `docs/architecture/shared-contraction-plan.md`

后续动作：

1. 停止新增通过总入口无差别引入类型
2. 为 `protocol` 建独立导出面
3. 为 `ui facade` 建独立导出面

### Batch 4: 真实搬运实现文件

优先顺序：

1. `orchestration`
2. `gateway`
3. `conversation`

## 验收标准

Phase 2 当前阶段应满足：

1. `conversation` 主运行链路已不再直接依赖 orchestrator/gateway 具体实现。
2. 跨上下文协作点都有明确的 port 名称。
3. 新增耦合不再绕过 composition root 直接打到具体实现。
