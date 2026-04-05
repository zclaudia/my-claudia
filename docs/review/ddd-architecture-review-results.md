# MyClaudia DDD 架构 Review 结果

日期：2026-04-01
状态：In Progress（Phase 1 完成）

---

## R1: 领域划分合理性

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 3/5 | conversation 职责过宽，orchestration 定位模糊，notification-feed 身份混合 |
| 依赖正确性 | 4/5 | 跨域直接依赖比预期少得多，大部分为类型依赖 |
| 内聚性 | 3/5 | conversation/ws/ 混合了运行时、消息路由、权限管理三类职责 |
| 耦合度 | 4/5 | 大多数域彼此独立，仅 conversation 有真实跨域耦合 |
| 可演进性 | 3/5 | conversation 修改影响面大，ws/ 内部改动牵连多个子模块 |
| 语言一致性 | 2/5 | "Task" 在四个域含义不同，"Agent" 在三处含义不同，"Run/Session"边界模糊 |

**综合评分：3.2/5**

### 各领域职责分析

#### conversation（8,668 行，Hub 域）

**ws/ 子目录的实际职责拆解（17 文件）：**

| 职责类型 | 文件 | 占比 |
|---|---|---|
| 运行时管理 | run-handler, run-bootstrap, run-provider-launch, run-provider-setup, run-recovery | ~40% |
| 消息路由 | message-handler, broadcast, handlers/ (5个) | ~30% |
| 权限管理 | run-permissions, permission-handler, handlers/permissions | ~20% |
| 数据/持久化 | run-lifecycle, run-events, run-context | ~10% |

**结论**：ws/ 子目录实质上包含了三个可独立的概念：
1. WebSocket 传输层（狭义 ws）
2. Run 生命周期执行引擎（runs/）
3. 权限决策处理（可归入 agent/）

conversation 当前的 6 个子目录中，`context/`、`interactions/`、`memory/`、`agent/`、`agent-tools/` 边界清晰，
`ws/` 过于臃肿且混合关注点。

#### orchestration（1,077 行，协调层）

- `task-orchestrator.ts`：仅管理 `kind='agent'` 的任务，外部任务（supervision/workflow）通过 `syncExternalTask()` 镜像同步
- `claudia-branch-service.ts`：管理 Claudia Chat 的会话分支分配（5 条规则）
- **没有 register.ts**，在 server-setup.ts 中直接通过 `createTaskOrchestrator()` 创建

**定性**：orchestration **不是一个 DDD 意义上的 Bounded Context**，而是一个协调层/编排模式（Orchestration Pattern Layer）。
它的职责是调度 agent 任务并同步状态，不拥有核心业务规则。

#### notification-feed（550 行，身份模糊）

实际包含两个完全不同的服务：

| 文件 | 职责 | 分类 |
|---|---|---|
| `service.ts` | 通知项 CRUD、WS 广播 | **领域逻辑** |
| `repository.ts` | DB 数据访问 | 数据访问层 |
| `routes.ts` | HTTP 端点（GET/POST feed） | 接口层 |
| `notification-service.ts` | Ntfy 推送配置管理 | **基础设施** |
| `notification-routes.ts` | 推送配置端点 | 接口层 |

**结论**：notification-feed 是一个领域，但 `notification-service.ts` 属于推送基础设施，不应在同一目录下。

#### scheduled-tasks / agent-triggers（已废弃）

- `scheduled-tasks`：无对其他域的跨域 import，功能已被 workflows 完全覆盖
- `agent-triggers`：无对其他域的跨域 import
- 两者对系统的"污染"仅在 server-setup.ts 的注册阶段（4 行）

**结论**：这两个域是真正的"空壳废弃域"，可以安全删除（见 R11）。

#### gateway（2,769 行，技术适配域）

- 具有良好的 adapter 模式（embedded/standalone 两种适配器）
- 没有对其他业务域的跨域 import
- **定性**：gateway 是技术适配域（Anti-Corruption Layer），不是业务域，归类为基础设施更合适

#### supervision（4,977 行，结构良好）

- 职责明确：任务监督、检查点、worktree、代码审查
- 内部分层清晰（service → engine → lifecycle → runner）
- 主要问题：重度依赖全局 repositories/（见 R3）

#### workflows（3,398 行，唯一用端口模式的域）

- `ports/step-executor.ts` 是全项目唯一的端口定义，架构示范良好
- step-executors/ 可插拔，扩展性好
- 问题：`generator.ts` 和 `engine.ts` 直接 import 全局 `SessionRepository`/`ProjectRepository`

### 问题清单

| # | 问题 | 严重度 | 涉及范围 | 建议 |
|---|---|---|---|---|
| 1 | conversation/ws/ 混合三类职责，17 个文件过于臃肿 | 高 | ws/ 全部文件 | 将 run-handler/run-lifecycle 等提取为 runs/ 子模块 |
| 2 | orchestration 不是真正的 Bounded Context | 中 | orchestration/ | 明确定位为协调层，文档说明，不视为平等领域 |
| 3 | notification/notification-service.ts 是推送基础设施混在领域中 | 中 | notification-service.ts | 移至 infrastructure/push/ 或 services/ |
| 4 | "Task" 在四个域含义不同（SupervisionTask/OrchestratorTask/ScheduledTask/SystemTask） | 中 | 4个域 | 制定统一语言词汇表（见 R13） |
| 5 | scheduled-tasks/agent-triggers 占用域注册开销但实质废弃 | 低 | server-setup.ts | 彻底删除（见 R11）|

### 决策结论

| 领域 | 决策 | 理由 |
|---|---|---|
| **conversation** | 保留，ws/ 内部重组 | Hub 域地位不变，但 ws/runs/ 应独立子模块 |
| **supervision** | 保留 | 职责清晰，结构健全 |
| **workflows** | 保留（主力域） | 唯一实践端口模式，架构最成熟 |
| **orchestration** | 保留，但降级定位 | 标注为协调层（非 Bounded Context），不在 Context Map 中平等对待 |
| **notification-feed** | 保留，拆出推送基础设施 | feed 是领域，ntfy 是 infra |
| **gateway** | 保留，重新归类 | 移出 domains/，标注为技术适配层 |
| **local-pr** | 保留 | 职责独立 |
| **scheduled-tasks** | 删除 | 完全被 workflows 覆盖（见 R11） |
| **agent-triggers** | 删除 | 完全被 workflows 覆盖（见 R11） |

### 影响范围

- conversation ws/ 重组：仅影响内部文件结构，不影响外部 API
- notification-service 拆出：影响 server-setup.ts 注册逻辑（约 10 行）
- gateway 重新归类：影响 domains/ 目录结构，不影响运行逻辑

---

## R2: 领域间依赖精确分析

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 4/5 | 绝大多数域无跨域依赖，比预期好得多 |
| 依赖正确性 | 4/5 | conversation 的 3 处 type-only import 可接受，1 处运行时 import 需关注 |
| 内聚性 | 4/5 | 各域内部 import 逻辑独立 |
| 耦合度 | 4/5 | 仅 conversation 有跨域耦合，其余域完全解耦 |
| 可演进性 | 4/5 | 绝大多数域可独立演进 |
| 语言一致性 | 3/5 | 不影响此项 |

**综合评分：3.8/5**

### 实际跨域依赖图（精确数据）

```
跨域依赖（仅 conversation 域有对外跨域 import）：

conversation/ws/message-handler.ts:14       ──type──→ notification/service.ts
conversation/ws/handlers/notification-feed.ts:7  ──type──→ notification/service.ts
conversation/ws/handlers/claudia.ts:19      ──type──→ notification/service.ts
conversation/ws/handlers/claudia.ts:21      ──runtime→ orchestration/claudia-branch-service.ts
conversation/ws/run-bootstrap.ts:12         ──runtime→ gateway/gateway-instance.ts

所有其他域（workflows / supervision / orchestration / notification-feed / local-pr / gateway）
对其他域的跨域 import 数量：0
```

> **与计划基线对比**：
> - 原计划：conversation → notification-feed "10+ 处，最严重"
> - 实际：**3 处，全部 type-only**，严重度应为"低"
> - 原计划：conversation → orchestration "3 处"
> - 实际：**1 处运行时 import**（ClaudiaBranchService）

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | `handlers/claudia.ts` 直接 import `ClaudiaBranchService` 运行时类 | 中 | handlers/claudia.ts:21 | 通过构造函数注入（DI），已有 NotificationFeedService 的 type-only 注入模式可参考 |
| 2 | `run-bootstrap.ts` import `getGatewayClient` 全局单例 | 中 | run-bootstrap.ts:12 | 通过 DI 注入 gateway client 接口，而非直接调用单例 |
| 3 | conversation 的 3 处 type-only import notification-feed | 低 | message-handler.ts, handlers/ | 可接受（type-only 无运行时耦合），但需在 Context Map 中标注依赖方向 |

**循环依赖**：无（notification-feed 对其他域无 import，不存在循环）

### 改进建议

**P1（建议处理）**：
1. `handlers/claudia.ts` 中的 `ClaudiaBranchService` 改为接口注入
   ```typescript
   // 当前
   import { ClaudiaBranchService } from '../../../../domains/orchestration/claudia-branch-service.js';
   // 目标：通过构造函数注入，类型可定义在 conversation/ws/types.ts 中
   interface IBranchAllocator {
     allocateBranch(params: ...): BranchAllocation;
   }
   ```
2. `getGatewayClient` 单例改为通过 DI 注入 `IGatewayClient` 接口

**P2（延后处理）**：
3. 在 Context Map 中正式标注 conversation → notification-feed 的依赖方向和协作模式

### 决策结论

**整体结论**：跨域依赖情况比预期好得多，不需要大规模重构。

| 依赖关系 | 结论 |
|---|---|
| conversation → notification-feed (type-only) | **保留**，type-only 依赖可接受 |
| conversation → orchestration (ClaudiaBranchService) | **引入接口**，通过 DI 解耦 |
| conversation → gateway (单例) | **引入接口**，通过 DI 解耦 |

---

## R3: 领域 vs 基础设施边界

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 2/5 | repositories/ 全局层被所有域广泛直接 import，边界极不清晰 |
| 依赖正确性 | 2/5 | 域直接 import 具体 Repository 实现，违反依赖倒置 |
| 内聚性 | 3/5 | 各域业务逻辑内聚，但数据访问散落在全局层 |
| 耦合度 | 2/5 | SupervisionTask/Project/Session 的 Repository 跨越多个域 |
| 可演进性 | 3/5 | 更换数据库实现需要修改所有域文件 |
| 语言一致性 | 3/5 | 不影响此项 |

**综合评分：2.5/5**

### 精确违规统计

#### 违规类型 1：domain → repositories/（全局层）

共 **48 处**，按域统计：

| 域 | import 数 | 依赖的 Repository | 类型 |
|---|---:|---|---|
| supervision | 24 | SupervisionTaskRepository, ProjectRepository, SessionRepository | 运行时 + type-only 混合 |
| local-pr | 7 | ProjectRepository, ProviderRepository, SessionRepository, WorktreeConfigRepository | 运行时 + type-only 混合 |
| workflows | 6 | SessionRepository, ProjectRepository, BaseRepository | 运行时 + type-only 混合 |
| scheduled-tasks | 4 | ProjectRepository, SessionRepository, BaseRepository | 运行时（已废弃，删除后消失）|

**根本原因**：`Project`、`Session`、`SupervisionTask`、`WorktreeConfig` 是跨域共享实体，其 Repository 放在全局 `repositories/` 是合理的共享内核设计，但直接 import 具体实现类（而非通过接口）是违规点。

#### 违规类型 2：domain → storage/db

共 **12 处**，按严重度：

| 文件 | 类型 | 严重度 |
|---|---|---|
| conversation/ws/run-handler.ts | **运行时 import** `initDatabase` | **高** |
| gateway/manager.ts | **运行时 import** `initDatabase` | **高** |
| conversation/ws/* (6 处) | type-only import `initDatabase` | 低（用于类型标注）|
| local-pr/register.ts, supervision/register.ts, workflows/register.ts, scheduled-tasks/register.ts | type-only import | 低（register.ts 是 DI 注册点，接近 Composition Root）|

**分析**：`register.ts` 中的 type-only import 是可接受的（register.ts 本质是 Composition Root 的一部分），但 `run-handler.ts` 和 `gateway/manager.ts` 中的运行时 import 违反了域不应直接依赖 DB 初始化的原则。

#### 违规类型 3：domain → routes/

共 **3 处**：

| 文件 | import | 严重度 |
|---|---|---|
| scheduled-tasks/register.ts | `createSystemTaskRoutes` | 中（但域已废弃）|
| workflows/register.ts | `createAutomationRoutes` | **中** |
| gateway/manager.ts | `GatewayConfig` (type-only) | 低 |

**问题**：`workflows/register.ts` 从 `routes/automations.ts` import 路由创建函数——这是反向依赖，应是 routes/ 调用 domain，而非 domain 引入 routes/。

#### 违规类型 4：domain → services/

共 **5 处**：

| 文件 | import | 严重度 |
|---|---|---|
| conversation/ws/run-context.ts | `workspaceService` (运行时单例) | **高** |
| supervision/supervisor-service.ts | `systemTaskRegistry` (运行时) | **高** |
| local-pr/register.ts | `systemTaskRegistry` (运行时) | 中 |
| scheduled-tasks/register.ts | `systemTaskRegistry` | 低（废弃）|
| workflows/register.ts | `systemTaskRegistry` | 中 |

**问题**：`systemTaskRegistry` 被 3 个域在运行时直接 import，说明它是一个全局单例服务，多个域依赖它。应通过依赖注入传入。

#### 违规类型 5：domain → storage/metadata-extractor

| 文件 | import | 严重度 |
|---|---|---|
| conversation/ws/run-lifecycle.ts | `extractAndIndexMetadata`, `removeIndexedMetadata` | 中 |

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | `run-handler.ts` 运行时 import `initDatabase`，域直接操作 DB 连接 | 高 | run-handler.ts:9 | 通过 DI 注入 `Database` 实例 |
| 2 | `gateway/manager.ts` 运行时 import `initDatabase` | 高 | manager.ts:12 | 通过 DI 注入 |
| 3 | `run-context.ts` 直接 import `workspaceService` 全局单例 | 高 | run-context.ts:14 | 通过 DI 注入 `IWorkspaceService` 接口 |
| 4 | `supervisor-service.ts` 直接 import `systemTaskRegistry` | 高 | supervisor-service.ts:1 | 通过 DI 注入 |
| 5 | `workflows/register.ts` import `createAutomationRoutes` — 域依赖路由层 | 中 | register.ts:15 | routes/ 主动拉取 domain，domain 不应知道 routes 的存在 |
| 6 | 48 处 domain → repositories/ 直接 import 具体类（而非接口） | 中 | supervision/, workflows/, local-pr/ | **暂缓**：全局 repositories 是共享内核，直接 import 可接受，但应明确文档化规则 |
| 7 | `run-lifecycle.ts` 直接 import `metadata-extractor` | 中 | run-lifecycle.ts:8 | 通过 DI 注入或移入 infra 层 |

### 允许 vs 禁止依赖清单

| 依赖关系 | 判断 | 说明 |
|---|---|---|
| domain → repositories/（全局共享实体） | **过渡期允许** | Project/Session/SupervisionTask 是共享内核，但应文档化，长期目标是通过接口 |
| domain → repositories/BaseRepository | **允许** | 纯基类，无业务语义 |
| register.ts → storage/db（type-only） | **允许** | register.ts 是 Composition Root 的一部分 |
| domain/service.ts → storage/db（运行时） | **禁止** | 应通过 DI 注入 Database 实例 |
| domain → routes/ | **禁止** | 路由层依赖域，而非域依赖路由 |
| domain → services/（全局单例直接 import） | **禁止** | 应通过 DI 注入接口 |
| domain → storage/metadata-extractor | **禁止** | 应抽象为端口 |

### 改进建议（按优先级）

**P0（立即处理）**：
1. `run-handler.ts` 和 `gateway/manager.ts` 的运行时 `initDatabase` 改为通过 DI 接收 `Database` 实例
2. `workspaceService` 和 `systemTaskRegistry` 改为通过 DI 注入（在 register.ts/server-setup.ts 中完成）

**P1（下个版本）**：
3. `workflows/register.ts` 引入 `createAutomationRoutes` 的方向反转：由 `routes/automations.ts` 调用 `workflowDomain.getRouter()`
4. `run-lifecycle.ts` 的 `metadata-extractor` 通过 DI 注入

**P2（长期）**：
5. 全局 `repositories/` 的 Repository 类逐步抽象为接口，在 Composition Root 注入具体实现

### 决策结论

- **repositories/ 全局层**：保留，明确定位为"共享内核的数据访问层"，不视为违规，但文档化使用规则
- **运行时 initDatabase import**：必须整改（P0）
- **全局单例 import**：必须整改（P0/P1）
- **routes 反向依赖**：必须整改（P1）

### 影响范围

- P0 修改涉及：`run-handler.ts`、`gateway/manager.ts`、`run-context.ts`、`supervisor-service.ts`（约 8 个文件的签名修改）
- 修改均在 server-setup.ts 的注册阶段完成 DI 传递，不影响 API 兼容性
- 无数据迁移需求

---

## 上下文映射（Context Map）更新版

基于 R1-R3 的分析结论：

```
┌─────────────────────────────────────────────────────────────────┐
│                         Shared Kernel                            │
│         (repositories/: Project, Session, SupervisionTask)       │
└─────────────────────────────────────────────────────────────────┘
                              ↑ 共享数据访问
        ┌─────────────┬───────┴──────────┬──────────────┐
        │             │                  │              │
   conversation   supervision        workflows       local-pr
   [Hub Domain]   [Core Domain]    [Core Domain]   [Domain]
        │             │                  │
        │type-only    │                  │
        └──────────→ notification-feed ←─┘
                   [Domain: feed部分]
                   [Infra: ntfy部分]
        │
        └──runtime──→ orchestration
                    [Coordination Layer，非 Bounded Context]
        │
        └──runtime──→ gateway
                    [Technical Adapter，非业务域]

废弃：scheduled-tasks, agent-triggers（应删除）
```

**协作模式标注**：

| 上游 | 下游 | 当前模式 | 理想模式 | 改造成本 |
|---|---|---|---|---|
| notification-feed | conversation | Published Language（type-only） | 保持，加 Context Map 文档 | 零成本 |
| orchestration | conversation | Open Host Service（DI注入） | 保持，抽象为接口 | 小（接口定义）|
| gateway | conversation | 单例访问 | 依赖注入接口 | 小 |
| repositories/ | supervision/workflows/local-pr | Shared Kernel | 保持，文档化 | 零成本 |

---

---

## R4: Routes → Services → Domains 调用链

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 4/5 | router/ 和 routes/ 职责清晰（WS vs HTTP），但 Composition Root 过大 |
| 依赖正确性 | 3/5 | 大部分路由通过 DI 调用 service，但 routes/projects.ts 有业务逻辑泄漏 |
| 内聚性 | 4/5 | 域内 routes.ts 通过 DI 委托 service，不承载逻辑 |
| 耦合度 | 4/5 | 大部分 route handler 只做参数转发，耦合度低 |
| 可演进性 | 4/5 | 路由层与 service 层边界基本清晰 |
| 语言一致性 | 3/5 | 不影响此项 |

**综合评分：3.7/5**

### 关键发现

**`router/` vs `routes/` 的真实关系（已澄清）**

| 目录 | 类型 | 职责 |
|---|---|---|
| `router/index.ts` | WebSocket 消息路由器（MessageRouter） | 注册消息类型处理函数，提供 `crud()` 快捷方法 |
| `routes/*.ts` | Express HTTP REST 路由 | API 端点定义，注入 service 后委托处理 |

两者**没有功能重叠**，`router/` 是 WS 协议分发层，`routes/` 是 HTTP 接口层。

**server-setup.ts 作为 Composition Root**

server-setup.ts（700 行）+ server.ts（534 行）共同组成 Composition Root。职责分工：
- `server.ts`：DB 初始化、HTTP/WS 服务器创建、基础设施启动
- `server-setup.ts`：所有 domain register() 调用、routes 挂载、中间件组装

整体设计合理，但 700 行偏大，可抽取 domain 注册部分为 `domain-registry.ts`。

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | `routes/projects.ts` handler 内直接执行 git worktree 操作（`ensureWorktreesGitignore`） | 中 | routes/projects.ts | 移入 service 层 |
| 2 | server-setup.ts 700 行偏大，DI 注册与路由挂载混在一起 | 低 | server-setup.ts | 可抽取 `domain-registry.ts`，但不紧急 |
| 3 | `supervision/routes.ts` 挂载了两个前缀 `/api` 和 `/api/supervision`（重复挂载） | 低 | server-setup.ts:260-261 | 统一挂载前缀 |

### 决策结论

- **router/ vs routes/**：保留现状，职责清晰，无需合并
- **routes 中业务逻辑**：`routes/projects.ts` 中的 git 操作移入 service，其余保留
- **Composition Root**：保留，可选择性抽取 domain 注册段，不强制

---

## R5: Repository 层评估

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 3/5 | 全局 repositories/ 和域内 repository.ts 有隐含规则但未文档化 |
| 依赖正确性 | 3/5 | BaseRepository 抽象良好，但部分自定义 Repository 不继承基类 |
| 内聚性 | 4/5 | 全局 repositories 聚焦共享实体，域内 repository 聚焦域专属数据 |
| 耦合度 | 3/5 | 同 R3 的 repositories 依赖问题 |
| 可演进性 | 3/5 | storage/db.ts 单文件 schema 管理难以独立演进 |
| 语言一致性 | 3/5 | 不影响此项 |

**综合评分：3.2/5**

### Repository 分层规则（现状归纳）

| 位置 | 内容 | 隐含规则 |
|---|---|---|
| `repositories/`（全局） | Project, Session, Provider, SupervisionTask, WorktreeConfig, SessionMessage... | 跨域共享实体，生命周期跨越多个域 |
| `domains/*/repository.ts` | LocalPR, Notification, Orchestration, Workflow(4个), ScheduledTask(2个) | 域专属实体，仅在本域内使用 |

**`SupervisionTaskRepository` 在全局层的原因**：
supervision 域本身没有 `repository.ts`，而是直接使用全局 `repositories/supervision-task.ts`。
这与"域内 repository 聚焦域专属数据"的隐含规则矛盾，
但 SupervisionTask 可能被 orchestration 等域的 `syncExternalTask()` 引用，所以放全局。

**不继承 BaseRepository 的 Repository**（4个）：
- `session.ts`（6260 行！最大单文件）
- `session-message.ts`
- `supervision-task.ts`
- `worktree-config.ts`

这 4 个有特殊查询需求（关联查询、upsert 等），无法完全套用基类。

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | `repositories/session.ts` 6260 行，是项目最大单文件，职责极可能混杂 | 高 | repositories/session.ts | 拆分为 SessionCoreRepository + SessionMessageRepository + SessionSearchRepository |
| 2 | `storage/db.ts` 负责所有表的 schema 和迁移，全量加载，难以按域维护 | 中 | storage/db.ts | 长期目标：按域拆分迁移文件（如 `migrations/supervision/` ），短期加注释分区 |
| 3 | 全局 repositories 与域内 repository 的划分规则未文档化，容易被误用 | 低 | 整体 | 在 repositories/README.md 中说明"共享实体放全局，域专属数据放域内" |

### 决策结论

- **全局 repositories/（共享内核）**：保留，明确文档化为共享内核数据访问层
- **`session.ts` 拆分**：P1 级别，6260 行需要拆分
- **schema 管理**：短期加分区注释，长期考虑按域拆分迁移文件

---

## R6: 事件系统评估

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 3/5 | pluginEvents 同时承载"领域事件"和"插件扩展事件"，概念边界不清 |
| 依赖正确性 | 4/5 | 事件总线模式减少了跨域直接依赖，使用正确 |
| 内聚性 | 4/5 | 事件定义集中在 events/index.ts |
| 耦合度 | 4/5 | 发布-订阅使跨域耦合度低 |
| 可演进性 | 3/5 | type union `| string` 允许任意字符串，类型安全弱；无持久化 |
| 语言一致性 | 3/5 | 事件名使用 `run.completed` 风格，一致性良好 |

**综合评分：3.5/5**

### 事件总线使用现状

| 指标 | 数据 |
|---|---|
| 引用文件数 | 13 个 |
| emit/on 调用总数 | 121 次 |
| 事件类型定义 | TypeScript string union（不是 enum），允许 `| string` 自定义 |
| 持久化 | 无（内存 EventEmitter） |

**事件发布方**：
- `conversation/ws/run-provider-launch.ts`：`run.started`
- `conversation/ws/run-events.ts`：`run.toolCall`, `run.toolResult`, `run.completed`
- `plugins/permissions.ts`：`permission.*`

**事件订阅方**：
- `domains/local-pr/register.ts`：订阅 `run.completed`
- `domains/workflows/service.ts`：动态订阅，在 `initialize()` 中 `rebuildEventSubscriptions()`
- `domains/agent-triggers/service.ts`：glob pattern 订阅（废弃域）

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | `| string` 类型允许任意字符串事件，IDE 无法自动补全非 PluginEvent 定义的事件 | 低 | events/index.ts | 保留 `| string` 以支持插件，但在文档中说明已知事件名 |
| 2 | pluginEvents 同时被业务域（conversation, local-pr, workflows）和插件系统共享，职责不单一 | 中 | events/index.ts | 考虑区分 `domainEvents`（业务事件）和 `pluginEvents`（插件扩展事件），或接受现状并文档化 |
| 3 | 无事件持久化：`run.completed` 若消费方不在时错过事件，无法重放 | 中 | 整体 | 明确定位为 best-effort hook，不用于可靠业务流程 |

### 决策结论

- **pluginEvents**：保留现状，不拆分 domainEvents/pluginEvents（改造成本高于收益）
- **明确定位**：pluginEvents 是 best-effort 进程内事件总线，不用于需要可靠传递的业务场景
- **`| string`**：保留，用于插件自定义事件

---

## R7: shared/ 类型归属

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 3/5 | 3 个权限版本共存；delegation/agent-triggers 废弃类型未清理 |
| 依赖正确性 | 3/5 | facade/ 包含完整运行时实现，是否应在 shared 存疑 |
| 内聚性 | 3/5 | core/ 和 protocol/ 内聚性好；features/ 有过期类型 |
| 耦合度 | 4/5 | shared 无内部循环依赖 |
| 可演进性 | 3/5 | 废弃类型未清理会导致 shared API 混乱 |
| 语言一致性 | 3/5 | features/ 命名与 server domains 基本对齐，但有缺口 |

**综合评分：3.2/5**

### 关键问题

**1. 三个权限版本共存（`interaction/permissions.ts`）**

| 版本 | 类型名 | 状态 |
|---|---|---|
| v1 | `AgentPermissionPolicy` | `@deprecated` |
| v2 | `CategoryPermissionPolicy` | `@deprecated` |
| v3 | `UnifiedPermissionPolicy` | **当前版本** |

三版本均在同一文件，v1/v2 标记 deprecated 但仍存在，用于兼容旧数据。需要明确迁移截止时间。

**2. facade/ 在 shared 的合理性**

`facade/`（136K）包含 `BackendFacadeRuntimeCore`、`StreamManager`、`RegistryStore` 等完整运行时实现。
从代码看，facade 的依赖全为 shared 内部类型（无平台依赖），适合放在 shared 中作为 desktop 和未来其他客户端的共享实现层。**结论：保留**。

**3. 废弃类型未清理**

| 文件 | 状态 |
|---|---|
| `features/delegation.ts` | 完全废弃，迁移至 `UnifiedPermissionPolicy.aiReview` |
| `features/agent-triggers.ts` | 完全废弃，迁移至 workflows |

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | permissions.ts 3 个版本并存，v1/v2 占用命名空间 | 中 | interaction/permissions.ts | 明确移除截止时间；若 DB 中无 v1/v2 数据，可立即删除 |
| 2 | `features/delegation.ts` 废弃类型未删除 | 中 | features/delegation.ts | 确认无引用后删除 |
| 3 | `features/agent-triggers.ts` 废弃类型未删除 | 中 | features/agent-triggers.ts | 与 R11 联动，服务端废弃域删除时同步删除 |
| 4 | `shared` 中无 `features/conversation.ts` 对应 server/conversation 域 | 低 | 缺口 | 评估是否需要：conversation 的共享类型已在 protocol/messages/run.ts 中 |

### 决策结论

- **废弃类型**（delegation, agent-triggers）：与 R11 联动，服务端清理后同步删除
- **permissions v1/v2**：查验 DB 中是否有旧格式数据，若无则删除
- **facade/**：保留在 shared，定位为跨客户端共享运行时
- **protocol/messages/**：保留，结构合理

---

## R8: Desktop 端架构

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 4/5 | 31 个 store 按实体/功能清晰划分，hook 与 store 边界清晰 |
| 依赖正确性 | 4/5 | store 纯数据操作，hook 承载连接逻辑，符合 Zustand 规范 |
| 内聚性 | 3/5 | chatStore 26K 偏大，可考虑拆分 |
| 耦合度 | 4/5 | store 间通过 selector 关联，无直接方法调用 |
| 可演进性 | 4/5 | 156 处 shared 依赖通过类型系统约束，变更影响范围可控 |
| 语言一致性 | 4/5 | store 命名与 shared types 保持一致 |

**综合评分：3.8/5**

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | chatStore 26K，可能混合了消息状态、工具调用状态、分页状态等多种职责 | 低 | chatStore.ts | 评估是否需要拆分为 messageStore + toolCallStore |
| 2 | `useMultiServerSocket` 同时支持 facade 和 gateway 两套连接路径 | 低 | useMultiServerSocket.ts | 明确迁移目标（最终是否全 facade 路径），设定删除 gateway 路径的时间点 |

### 决策结论

- **Desktop 架构整体健康**，保留现状
- chatStore 拆分和 useMultiServerSocket 路径统一列为技术债务，不紧急

---

## R9: 插件系统定位

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 4/5 | plugins/ 是纯基础设施，无对 domains/ 的依赖 |
| 依赖正确性 | 5/5 | plugins/ 零 domain import，依赖方向正确 |
| 内聚性 | 3/5 | loader.ts 1394 行，职责过多 |
| 耦合度 | 4/5 | domains 通过注册接口使用 plugins 能力，解耦良好 |
| 可演进性 | 3/5 | loader.ts 过大导致修改风险高 |
| 语言一致性 | 4/5 | tool-registry / workflow-step-registry 命名一致 |

**综合评分：3.8/5**

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | `loader.ts` 1394 行/49K，职责混杂（发现/加载/激活/停用/验证/通信） | 高 | plugins/loader.ts | 拆分为 loader-discovery.ts + loader-lifecycle.ts + loader-validation.ts |
| 2 | `workflow-step-registry.ts` 在 plugins/ 中，但服务于 workflows 域 | 低 | plugins/workflow-step-registry.ts | 保留现状（注册点属于基础设施），在文档中说明插件扩展工作流的方式 |

### 决策结论

- **插件系统定位**：基础设施（Infrastructure），不是独立领域——**结论正确**
- **loader.ts**：P2 级别拆分，不紧急但应纳入技术债务列表

---

## R10: Provider 层架构

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 4/5 | adapter/sdk 两层结构清晰，cli-jobs/ 定位合理 |
| 依赖正确性 | 3/5 | conversation 域对 providers 有 14 处 import，部分可通过 PCP 抽象 |
| 内聚性 | 4/5 | 每个 provider 自包含（adapter + sdk + review job） |
| 耦合度 | 3/5 | `providerRegistry` 单例被 conversation 直接 import |
| 可演进性 | 4/5 | 新增 provider 只需实现 adapter 接口并注册 |
| 语言一致性 | 4/5 | 命名规范：`*-adapter.ts`, `*-sdk.ts` |

**综合评分：3.7/5**

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | conversation 域 14 处 import providers，包含 `providerRegistry` 单例直接引用 | 中 | ws/run-lifecycle.ts, run-events.ts, run-handler.ts | 通过 DI 注入 ProviderAdapter 接口，而非直接访问 providerRegistry |
| 2 | PCP 协议有定义（shared/core/pcp.ts）但仅在 5 个 interaction tool 上使用，大量 provider 能力差异仍硬编码 | 低 | providers/pcp-capability.ts | 长期目标：扩大 PCP 覆盖范围，减少特殊判断分支 |

### 决策结论

- **Provider 层整体设计良好**，adapter 模式规范
- `providerRegistry` 的 DI 化是 P1 改进项

---

## R11: @deprecated 领域迁移评估

### 评分（废弃域本身不参与评分，评估迁移就绪度）

| 评估维度 | scheduled-tasks | agent-triggers |
|---|---|---|
| 功能被覆盖程度 | ✅ 100% 被 workflows 覆盖 | ✅ 100% 被 workflows event trigger 覆盖 |
| 外部依赖数 | server-setup.ts（1处），routes/agent-triggers（错误引用） | server-setup.ts（1处），routes/agent-triggers.ts |
| Desktop 依赖 | 需确认 | 需确认 |
| DB 表 | `scheduled_tasks`, `task_runs` | `agent_triggers` |
| 数据迁移需求 | 有（用户数据需迁移至 workflows） | 有（用户触发器需迁移至 workflows） |
| 删除步骤数 | ~6 步 | ~4 步 |

### 删除步骤（建议执行顺序）

**scheduled-tasks 删除计划**：
1. 确认 `routes/system-tasks.ts` 中的 `TaskRunRepository` 引用是否应保留（system-tasks 不等于 scheduled-tasks）
2. 从 server-setup.ts 移除 `registerScheduledTaskDomain()` 调用
3. 删除 `domains/scheduled-tasks/`、`routes/agent-triggers.ts`（如果仅服务该域）
4. 添加 DB migration 删除 `scheduled_tasks` 和 `task_runs` 表（**需先确认是否有用户数据**）
5. 删除 `shared/src/features/scheduled-tasks.ts`

**agent-triggers 删除计划**：
1. 从 server-setup.ts 移除 `AgentTriggerService` 创建和 `createAgentTriggerRoutes()` 调用
2. 删除 `domains/agent-triggers/`、`routes/agent-triggers.ts`
3. 添加 DB migration 删除 `agent_triggers` 表（**需先确认是否有用户数据**）
4. 删除 `shared/src/features/agent-triggers.ts`（与 R7 联动）

### 决策结论

- **scheduled-tasks**：删除。数据迁移是阻塞点，需产品侧确认旧数据处理策略
- **agent-triggers**：删除。同上，DB 数据迁移需确认
- **时间线**：建议在 workflows 功能稳定后（1-2 个版本内）执行删除

---

## R12: DDD 战术模式评估

### ���分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | 2/5 | 完全无 Entity/VO/AR，纯贫血模型 |
| 依赖正确性 | 3/5 | Service 承载了本应在领域对象上的行为 |
| 内聚性 | 2/5 | 任务状态流转分散在 task-lifecycle.ts 的 10+ 个方法中 |
| 耦合度 | 3/5 | Service 之间通过 DI 组合，尚可 |
| 可演进性 | 3/5 | 没有状态机实体，状态转换路径不可见 |
| 语言一致性 | 3/5 | SupervisionTask 状态名清晰（14 个状态），但分散 |

**综合评分：2.7/5**

### 核心发现：完全贫血模型

代码库中 **零个** `Entity` / `AggregateRoot` / `ValueObject` 类。
所有业务对象均为纯数据接口（`interface`），所有行为集中在 `Service` 类中。

**SupervisionTask 状态流转（14 个状态）**分散在 `task-lifecycle.ts` 的 10+ 个方法中：

```
proposed → pending → queued → planning → running
       ↘ cancelled               ↓
                               reviewing
                             ↙     ↘
                      approved     rejected → queued（重试）
                          ↓
                      integrated ← merge_conflict（解决冲突后）
```

每个状态转换是一个独立方法（`retryTask`, `cancelTask`, `approveTaskResult` 等），
没有统一的状态机守卫，理论上可以构造非法的状态转换序列。

### 问题清单

| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | SupervisionTask 的 14 个状态流转逻辑分散在 service 层，无单一状态机 | 高 | task-lifecycle.ts | 引入 TaskStateMachine 类，集中管理有效状态转换 |
| 2 | 完全贫血模型：所有领域行为在 Service 中，Interface 只有数据 | 中 | 整体 | 渐进式改进：先为 SupervisionTask 建立状态机，其他域可保持现状 |
| 3 | OrchestratorTask 和 SupervisionTask 的 `status` 枚举值不同（无统一定义） | 中 | orchestration/types.ts | 在 shared 中统一 TaskStatus，或明确两者的不同语义 |

### 决策结论

- **贫血模型**：接受现状，不强制引入 DDD 战术模式（改造成本极高，收益有限）
- **SupervisionTask 状态机**：P1 改进项，引入状态机守卫防止非法状态转换
- **OrchestratorTask 状态统一**：P2 项，文档化两套 status 的不同语义

---

## R13: 统一语言一致性检查

### 评分

| 维度 | 分数 | 说明 |
|---|---:|---|
| 语言一致性 | 2/5 | "Task"/"Run"/"Agent" 在多处含义不同，无统一词汇表 |
| 边界清晰度 | 2/5 | 概念歧义导致域边界理解困难 |
| 其他维度 | - | 不适用 |

**综合评分：2/5**

### 核心概念歧义

| 术语 | 出现位置 | 各自含义 |
|---|---|---|
| **Run** | `ActiveRun`（ws/types）| 正在执行的会话-客户端运行时上下文 |
| **Run** | `TaskRun`（scheduled-tasks）| 单次定时任务执行的历史记录 |
| **Run** | `WorkflowRun`（workflows）| 单次工作流执行的历史记录 |
| **Task** | `SupervisionTask` | 长流程工作，有 14 个状态，可能需要人工审批 |
| **Task** | `ScheduledTask` | 定时/事件触发的自动化任务 |
| **Task** | `OrchestratorTask` | 统一调度层内部抽象（含 4 种 kind） |
| **Task** | `SystemTask` | 系统内部任务（system-task-registry） |
| **Agent** | `ProjectAgent`（supervision）| AI 监督代理实例，有生命周期阶段 |
| **Agent** | `AgentTrigger`（agent-triggers）| 事件驱动的自动触发器（废弃） |
| **Agent** | `conversation/agent/`（子目录）| 权限评估、委托决策相关逻辑 |

### 建议统一语言词汇表（草案）

| 术语 | 建议定义 | 归属域 |
|---|---|---|
| **Run** | 单次 AI 会话执行上下文，有生命周期（started→running→completed/error） | conversation |
| **Execution** | 任何可执行单元（Task/Workflow/ScheduledJob）的单次执行记录 | 共享术语 |
| **WorkflowRun** | Workflow 的单次 Execution | workflows |
| **Task** | SupervisionTask 的简称，指长流程人机协作工作单元 | supervision |
| **Job** | 自动化执行单元（替代 ScheduledTask），强调无人工介入 | workflows |
| **Agent** | AI 自主执行代理（仅指 supervision 的 supervisor agent） | supervision |
| **Trigger** | 触发工作流或任务的条件（事件/调度），属于 Workflow 配置项 | workflows |
| **Orchestration** | 跨域任务调度协调层，不是业务域 | orchestration（协调层）|

### 决策结论

- 制定词汇表（见预期产出），规范后续新代码的命名
- 现有代码不做大规模重命名，保持向后兼容
- 在 `docs/ubiquitous-language.md` 中维护词汇表

---

## R14: 顶层孤立文件归属

### 问题清单

| 文件 | 职责 | 建议归属 | 优先级 |
|---|---|---|---|
| `terminal-manager.ts` | PTY 终端管理（node-pty），30min idle timeout | 保留顶层，作为基础设施；或移入 `infrastructure/terminal/` | P3 |
| `loop-detection.ts` | 工具调用循环检测，生成 tool 签名 | 移入 `utils/` 或 `domains/conversation/ws/` | P3 |
| `auth.ts` | 认证逻辑 | 与 `middleware/auth.ts` 合并，或保留顶层（职责不重叠则无需合并） | P3 |
| `commands/registry.ts` | Slash 命令注册中枢（类似 ToolRegistry） | 保留，定位为基础设施注册点 | 不需要处理 |

### 决策结论

- `loop-detection.ts`：移入 `utils/`（P3，不紧急）
- `terminal-manager.ts`：保留顶层或提取至 `infrastructure/`，不紧急
- `commands/`：保留，定位为命令注册基础设施

---

## R15: 历史迁移产物清理

| 文件 | 状态 | 建议 |
|---|---|---|
| `verification/phase1-verify.ts` | 手写断言测试，不在任何 CI/构建脚本中 | **删除**，功能由 e2e 测试覆盖 |
| `verification/phase2-verify.ts` | 同上 | **删除** |

**决策结论**：下一次清理任务中删除 `verification/` 目录。

---

## R16: utils/ 领域逻辑泄漏

| 文件 | 实际内容 | 归属判断 | 建议 |
|---|---|---|---|
| `utils/run-state.ts` | 判断"是否有前台活跃 Run"，调用者是 UI 逻辑 | **桌面端 UI 逻辑**，不应在 server/src/utils | 移入 desktop/utils/ 或确认 server 是否也需要 |
| `utils/workflow-layout.ts` | BFS 图布局算法（workflow editor 可视化） | **纯 UI 渲染逻辑**，不应在 server | 移入 desktop/utils/ 或 shared/utils（若多端共用）|
| `utils/git-worktrees.ts` | worktree Git 操作 | 属于 supervision 域基础工具 | 可保留 utils，但应在 supervision/ 的 README 中引用 |
| `utils/git-operations.ts` | Git 命令封装 | 通用工具，无业务语义 | 保留 utils |

**决策结论**：
- `run-state.ts` 和 `workflow-layout.ts` 是 UI 逻辑误放 server，移入 desktop/utils（P2）
- `git-worktrees.ts` / `git-operations.ts` 保留 utils

---

## R17: `commands/` 目录定位

`commands/registry.ts`（254 行）是 slash 命令注册中枢，与 `ToolRegistry` 模式相同——
提供 `register(meta)`、`execute(commandName)` 接口，支持 builtin 和 plugin 来源。

**定位**：基础设施层（Infrastructure），类比 `ToolRegistry`，**不是域**。

**决策结论**：保留 `commands/` 目录，在架构文档中标注为基础设施注册点。

---

## 总报告（Executive Summary）

### DDD 成熟度结论

| 层面 | 评估 |
|---|---|
| **战略设计（Bounded Context 划分）** | 中等（3/5）。大多数域职责合理，但 conversation 过宽，orchestration 定位模糊，2 个废弃域待清理 |
| **上下文映射（Context Map）** | 良好（4/5）。跨域依赖远少于预期，conversation 是唯一有跨域 import 的域 |
| **基础设施边界** | 待改善（2.5/5）。运行时 DB 直接 import、全局单例 import 是主要违规点 |
| **战术模式（Entity/VO/AR）** | 薄弱（2/5）。完全贫血模型，状态机分散 |
| **统一语言** | 薄弱（2/5）。Task/Run/Agent 三个核心��语均有歧义 |
| **事件系统** | 中等（3.5/5）。pluginEvents 使用合理，但职责边界模糊 |

**综合 DDD 成熟度：3/5**（具备 DDD 的"形"，但战术实践层薄弱）

---

### 最严重的 5 个架构问题

| 优先级 | 问题 | 影响 |
|---|---|---|
| **P0** | 运行时 `initDatabase` 和全局单例直接 import 到域文件（run-handler, gateway/manager, run-context, supervisor-service）| 域对基础设施产生硬依赖，无法单元测试，DB 切换困难 |
| **P1** | `repositories/session.ts` 6260 行，最大单文件，职责混杂 | 修改风险极高 |
| **P1** | SupervisionTask 14 个状态的流转逻辑分散，无状态机守卫 | 可构造非法状态转换，bug 难以追踪 |
| **P1** | 2 个废弃域（scheduled-tasks, agent-triggers）仍在运行，占用注册和 DB 资源 | 技术债务，新人困惑 |
| **P2** | 核心术语歧义（Task/Run/Agent），无统一语言词汇表 | 跨域沟通成本高，新功能命名混乱 |

---

### Decision Log

| 领域/组件 | 决策 |
|---|---|
| conversation | 保留，ws/ 内部重组（runs/ 独立子模块）|
| supervision | 保留 |
| workflows | 保留（主力域，架构最成熟）|
| orchestration | 保留，标注为协调层（非 Bounded Context）|
| notification-feed | 保留，拆出 notification-service.ts 为推送基础设施 |
| gateway | 保留，重新归类为技术适配层（非业务域）|
| local-pr | 保留 |
| scheduled-tasks | **删除**（数据迁移后）|
| agent-triggers | **删除**（数据迁移后）|
| pluginEvents | 保留，定位为 best-effort 进程内总线 |
| shared/facade/ | 保留在 shared |
| shared/features/{delegation,agent-triggers} | 与服务端废弃域联动删除 |
| shared/interaction/permissions v1/v2 | 查验 DB 数据后删除 |
| plugins/ | 基础设施，保留；loader.ts 需拆分 |
| 全局 repositories/ | 保留为共享内核数据访问层，文档化使用规则 |
| verification/ | 删除 |
| utils/run-state.ts, workflow-layout.ts | 移入 desktop/utils |

---

### Refactor Roadmap

#### P0：立即处理（不影响功能，纯架构修复）

1. **DI 化运行时 initDatabase**：`run-handler.ts`、`gateway/manager.ts` 通过 DI 接收 `Database` 实例
2. **DI 化全局单例**：`workspaceService`、`systemTaskRegistry` 通过构造函数注入
3. **反转 routes 依赖**：`workflows/register.ts` 不再 import `createAutomationRoutes`，改由 `server-setup.ts` 主动组合

#### P1：下个版本内（需要计划和测试）

4. **删除废弃域**：scheduled-tasks + agent-triggers（含 DB migration 和 shared 类型）
5. **拆分 session.ts**：6260 行拆分为 SessionCoreRepository + SessionMessageRepository
6. **SupervisionTask 状态机**：引入 TaskStateMachine 类集中管理状态转换
7. **DI 化 providerRegistry**：conversation 域通过 DI 接收 ProviderAdapter 接口
8. **ClaudiaBranchService 接口化**：conversation → orchestration 运行时依赖改为接口注入

#### P2：长期方向

9. **移动 run-state.ts / workflow-layout.ts** 至 desktop/utils
10. **统一语言词汇表**：创建 `docs/ubiquitous-language.md`
11. **拆分 plugins/loader.ts**：loader-discovery + loader-lifecycle + loader-validation
12. **清理 permissions v1/v2**：共享权限类型清理
13. **ws/ 内部重组**：conversation/ws/ → conversation/runs/ 子模块

---

**Review 完成日期：2026-04-01**
**下一步行动：按 Roadmap P0 项开始整改**
