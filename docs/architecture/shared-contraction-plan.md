# MyClaudia Shared 收缩计划

日期：2026-04-06
状态：Draft

## 目标

当前 `@my-claudia/shared` 是一个“大总线包”，同时承载：

- core entity / value object
- feature model
- interaction model
- websocket / gateway protocol
- facade runtime type
- UI 导向常量

这会让 bounded context 看起来解耦，实际仍通过共享语言强耦合。

本计划的目标不是立刻拆包，而是先定义收缩边界：

1. 哪些类型属于 `shared-kernel`
2. 哪些类型属于 `integration-protocol`
3. 哪些类型其实是 `ui-facade-types`
4. 哪些类型不应继续从 `@my-claudia/shared` 总入口直接导入

## 当前现状

### 目录结构

当前 `shared/src/` 主要包含：

- `core/`
- `features/`
- `interaction/`
- `protocol/`
- `facade/`
- `files.ts`
- `plugin-types.ts`

总入口：

- `shared/src/index.ts`

它一次性 re-export 了几乎全部子模块。

## 服务端消费现状

基于本次扫描，`server/src` 从 `@my-claudia/shared` 的依赖大致分成 6 类：

### 1. Shared Kernel 候选

这些类型相对稳定，适合长期保留为共享内核：

- `Project`
- `Session`
- `SessionDraft`
- `ProviderConfig`
- `ApiResponse`
- `MessageRole`

特点：

- 数据形状稳定
- server / desktop / storage 都会消费
- 不直接绑定某个 transport protocol

风险：

- 其中部分类型已经混入别的上下文语义
  例如 `Project` 依赖了 supervision 的 `ProjectAgent`
  例如 `Session` 混入了 supervision / workflow 的 task 状态字段

结论：

- 这些类型可以作为 shared-kernel 起点
- 但需要先“去杂质”再稳定下来

### 2. Integration Protocol 候选

这些类型本质上是通信协议，不该和 shared-kernel 混放：

- `ServerMessage`
- `ClientMessage`
- `Request` / `Response`
- `GatewayBackendInfo`
- `Terminal*Message`
- `StateHeartbeatMessage`
- `Run*` 系列消息
- `protocol/gateway.ts` 下的 peer / backend / snapshot / proxy 消息

特点：

- 强依赖 websocket / gateway / facade
- 变化频率高
- 不是领域内核

结论：

- 应归入 `integration-protocol`

### 3. UI Facade Types 候选

这些类型更偏前后端协作和 UI 展示，不适合和 shared-kernel 混放：

- `ServerFeature`
- `ALL_SERVER_FEATURES`
- `ServerInfo`
- `ServerGatewayConfig`
- `ServerGatewayStatus`
- `ProviderCapabilities`
- `ModeOption`
- `ModelOption`
- `LOCAL_COMMANDS`
- `CLI_COMMANDS`

特点：

- 主要由 API / UI / capability negotiation 使用
- 并非领域模型本身

结论：

- 适合归入 `ui-facade-types` 或 `application-contracts`

### 4. Feature Model

这些类型对应具体支撑域或功能域：

- `LocalPR*`
- `Notification*`
- `Workflow*`
- `Supervision*`
- `SystemTask*`
- `Delegation*`

特点：

- 带明显上下文语义
- 当前直接暴露在 shared 总入口下，容易让别的上下文无差别依赖

结论：

- 短期保留在 feature 分组
- 中期应限制通过总入口无差别导入

### 5. Interaction Model

这些类型对应权限、表单、计划确认等交互协议：

- `UnifiedPermissionPolicy`
- `PermissionRequest`
- `PermissionMode`
- `ApprovalInteractionMessage`
- `TodoUpdateInteractionMessage`
- `InteractionPromptMessage`

特点：

- 处于 conversation / plugins / UI 交叉地带
- 兼具领域规则与协议属性

结论：

- 应先独立视为 `interaction-contracts`
- 暂不归入 shared-kernel

### 6. Plugin / PCP / Facade Runtime

这些类型构成单独的技术能力簇：

- `PCP*`
- `plugin-types`
- `Permission`
- `PluginManifest`
- `Mcp*`
- `facade/*`

特点：

- 技术性强
- 不属于项目核心业务语言

结论：

- 应继续隔离，避免被核心领域无差别使用

## 当前主要问题

### 问题 1: `shared/index.ts` 过宽

现状：

- `server`、`desktop`、`gateway` 都习惯直接从总入口拿类型

影响：

- 调用方不知道自己依赖的是 kernel、protocol 还是 UI contract
- 领域边界被 re-export 扁平化

### 问题 2: 核心实体已混入其他上下文字段

例如：

- `Project` 混入 `ProjectAgent`
- `Session` 混入 `projectRole / taskId / planStatus / lastRunStatus`

影响：

- 基础领域实体被 supervision / workflows 语义污染

### 问题 3: protocol 与 model 混在同一导出面

例如：

- `ServerMessage` 和 `Project` 都从同一个总入口拿

影响：

- 应用层和协议层难以区分

## 目标结构

建议目标不是一次拆成多个 npm package，而是先按目录语义收缩：

```text
shared/
  src/
    shared-kernel/
      project.ts
      session.ts
      provider.ts
      api.ts
    integration-protocol/
      messages.ts
      gateway.ts
      correlation.ts
    feature-models/
      workflows.ts
      supervision.ts
      local-pr.ts
      notification-feed.ts
    interaction-contracts/
      permissions.ts
      forms.ts
      notifications.ts
    ui-facade-types/
      server.ts
      commands.ts
      provider-capabilities.ts
    plugin-runtime/
      pcp.ts
      plugin-types.ts
      facade/*
```

## 执行策略

### Phase A: 先限制导入方式

目标：

- 不再鼓励从 `@my-claudia/shared` 总入口无差别导入

建议：

1. 新代码优先从子路径导入
2. 在文档中标记总入口为 legacy convenience export
3. 后续引入 lint 规则限制新代码使用总入口

### Phase B: 标记 shared-kernel 范围

建议先标记这些类型为 shared-kernel：

- `Project`
- `Session`
- `SessionDraft`
- `ProviderConfig`
- `ApiResponse`

但要注意：

- `Project`、`Session` 需要后续瘦身

### Phase C: 抽 protocol-only 导出

建议先建立：

- `shared/src/integration-protocol/index.ts`

聚合：

- websocket messages
- gateway protocol
- request/response correlation

### Phase D: 收缩 UI-only 导出

建议把这些优先迁出总入口：

- `ALL_SERVER_FEATURES`
- `ServerInfo`
- `ServerGatewayConfig`
- `ServerGatewayStatus`
- `LOCAL_COMMANDS`

原因：

- 这些本质上是 frontend contract，而不是领域核心语言

## 建议优先级

1. 停止新增从 `@my-claudia/shared` 总入口导入
2. 给 `protocol` 建独立导出面
3. 给 `server/ui facade` 建独立导出面
4. 再处理 `Project` / `Session` 瘦身

## 验收标准

阶段性完成时应满足：

1. 新代码能明确知道自己依赖的是 kernel、protocol 还是 facade type。
2. `ServerMessage` 和 `Project` 不再默认从同一总入口导入。
3. `shared-kernel` 范围被明确并保持稳定。
4. `shared/index.ts` 不再是默认推荐导入方式。
