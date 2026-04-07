# MyClaudia Context Map

日期：2026-04-07
状态：Active

## 目标

定义当前项目领域升级的目标上下文边界，明确：

- 哪些模块是 `Bounded Context`
- 哪些模块是 `Application Layer`
- 哪些模块是 `Infrastructure / Integration`
- 上下文之间应如何协作

这份文档是后续目录调整、依赖收敛、共享类型拆分的基线，不直接描述实现细节。

## 上下文分类

### 核心领域

| 上下文 | 定位 | 核心职责 |
|---|---|---|
| `workflows` | Core Domain | 定义、触发、执行工作流与步骤编排 |
| `supervision` | Core Domain | 监督任务、检查点、worktree、代码审查生命周期 |

### 支撑领域

| 上下文 | 定位 | 核心职责 |
|---|---|---|
| `notification-feed` | Supporting Domain | 通知项生命周期、未读状态、通知流广播 |
| `local-pr` | Supporting Domain | 本地 PR 工作流与变更审查辅助能力 |

### 基础领域

| 上下文 | 定位 | 核心职责 |
|---|---|---|
| `projects` | Foundational Domain | 项目配置、目录、策略、默认 provider 等基础信息 |
| `sessions` | Foundational Domain | 会话标识、层级、归属、状态等基础信息 |
| `providers` | Foundational Domain | provider 元数据、能力发现、运行时配置入口 |

### 应用层

| 模块 | 定位 | 说明 |
|---|---|---|
| `conversation` | Application Context | 实时交互入口，负责 transport、run runtime、permission interaction、Claudia 入口编排 |
| `orchestration` | Process Manager | 跨上下文协调任务与分支分配，不作为平级业务域对待 |
| `plugins` | Application / Extension Layer | 外部能力接入、插件激活、运行时桥接 |

### 基础设施 / 集成

| 模块 | 定位 | 说明 |
|---|---|---|
| `gateway` | Integration Context | 远程连接、中继、同步、代理；不是核心业务域 |
| `storage/*` | Infrastructure | DB、文件、持久化实现 |
| `routes/*` | Interface Layer | HTTP API 暴露层 |
| `router/*` | Interface Layer | WebSocket 消息分发层 |
| `providers/* sdk impl` | Infrastructure | 各 AI provider 的具体适配实现 |

## 目标上下文图

```text
Desktop / Mobile UI
  -> Application API Facade
    -> conversation (application context)
    -> workflows
    -> supervision
    -> projects
    -> sessions
    -> notification-feed

conversation
  -> orchestration (service / process manager)
  -> providers
  -> notification-feed

orchestration
  -> sessions
  -> notification-feed

workflows
  -> projects
  -> sessions
  -> notification-feed
  -> plugins

supervision
  -> projects
  -> sessions
  -> providers

all server contexts
  -> shared-kernel / integration-protocol
  -> infrastructure

remote clients / other devices
  -> gateway (integration context)
```

## 上下文协作方式

| 上游 | 下游 | 当前问题 | 目标协作方式 |
|---|---|---|---|
| `conversation` | `orchestration` | 直接依赖具体实现 | 通过 port / service interface |
| `conversation` | `notification-feed` | 入口侧感知领域服务 | 保留服务接口，避免扩散到传输细节 |
| `conversation` | `gateway` | 混入技术单例 | 改为 application adapter 注入 |
| `workflows` | `notification-feed` | 运行时直接调用服务 | 保留 port，弱化具体实现依赖 |
| `supervision` | `sessions` / `projects` | 依赖基础数据模型 | 短期保留，长期通过应用服务包装 |
| `desktop` | server contexts | 边界映射不稳定 | 按 feature facade 对齐 bounded context |

## 目录升级目标

### 服务端目标（已完成 ✅）

```text
server/src/
  application/
    conversation/     ✅ 从 domains/ 迁入
    orchestration/    ✅ 从 domains/ 迁入
    plugins/          ✅ 从 domains/ 迁入
  domains/
    workflows/        ✅ 保留
    supervision/      ✅ 保留
    notification-feed/ ✅ 从 notification 重命名
    local-pr/         ✅ 保留
    projects/         ✅ 保留
    sessions/         ✅ 保留
    providers/        ✅ 保留
  infrastructure/
    gateway/          ✅ 从 domains/ 迁入
    push/             ✅ 已有
    storage/          ✅ 从 src/storage/ 迁入
    providers/        ✅ 从 src/providers/ 迁入（SDK 实现）
  interfaces/
    http/             ✅ 从 src/routes/ 迁入
    websocket/        ✅ 从 src/router/ 迁入
```

说明：

- ✅ `conversation` 从”超级领域”降级为应用层上下文
- ✅ `orchestration` 从 `domains/` 迁出
- ✅ `gateway` 从 `domains/` 迁出
- ✅ `notification` 已更名为 `notification-feed`
- ✅ `plugins` 从 `domains/` 迁出
- ✅ `shared` 子路径导入全量迁移完成

### 共享包目标

```text
shared/
  shared-kernel/
  integration-protocol/
  ui-facade-types/
```

短期不要求物理拆包，但后续设计必须按这三个方向收缩。子路径导入已全量迁移，为后续拆包做好准备。

## 本阶段决策

1. `workflows`、`supervision` 作为核心领域保留。
2. `conversation` 不再视为单一业务域。
3. `orchestration` 视为 process manager，而非平级 bounded context。
4. `gateway` 视为 integration context，而非业务域。
5. `notification-feed` 作为领域保留，推送能力迁往基础设施。
6. `projects`、`sessions` 先保留为基础领域，后续再增强模型。

## 已完成

1. ✅ 建立统一语言词汇表（ubiquitous-language.md）。
2. ✅ 制定目录迁移方案并执行（domain-classification.md）。
3. ✅ shared 子路径导入全量迁移（server/src/ 零残留）。
4. ✅ 物理目录迁移：orchestration、gateway、plugins、conversation、notification-feed。

## 下一步

1. ✅ 统计并削减跨上下文直接依赖（依赖审计已完成，8 处违规已修复）。
2. ✅ conversation 内部拆分：ws/ → transport/runtime/handlers/interactions inline。
3. ✅ storage/、providers/ sdk impl、routes/、router/ 迁入 infrastructure/interfaces。
4. 中期：conversation → gateway 解耦（getGatewayClient 全局单例改为 adapter 注入）。
5. 中期：shared 方向性收敛（shared-kernel / integration-protocol / ui-facade-types）。
6. 长期：整理 server/src/ 剩余顶层目录（commands/, events/, handlers/, helpers/, middleware/, mcp/, plugins/, repositories/, services/, utils/）。

## 跨上下文依赖审计（2026-04-07）

### 架构违规：域 → 应用层（8 处）

| 违规文件 | 导入目标 | 严重性 | 修复方案 |
|---|---|---|---|
| `supervision/register.ts` | `sendMessage`, `createVirtualClient` | HIGH | 提取 transport port |
| `local-pr/register.ts` | `sendMessage`, `ConnectedClient` | HIGH | 提取 transport port |
| `workflows/register.ts` | `sendMessage`, `ConnectedClient`, `workflowStepRegistry` | HIGH | transport port + 注入 registry |
| `sessions/register.ts` | `ActiveRun` type | MEDIUM | 提取类型到 shared |
| `sessions/message-routes.ts` | `ActiveRun` type | MEDIUM | 提取类型到 shared |
| `workflows/routes.ts` | `workflowStepRegistry`, `workflowTriggerRegistry` | MEDIUM | 注入 registry |
| `workflows/generator.ts` | `workflowStepRegistry` | MEDIUM | 注入 registry |
| `providers/routes.ts` | `toolRegistry` | MEDIUM | 注入 registry |

### 修复优先级

1. **P1**：提取 transport port（`sendMessage`, `createVirtualClient`）— 解决 3 个 HIGH
2. **P2**：`ActiveRun` 类型提取到 shared — 解决 2 个 MEDIUM
3. **P3**：plugin registry 注入 — 解决 3 个 MEDIUM
