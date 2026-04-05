# MyClaudia DDD 架构 Review 计划

日期：2026-03-31
更新：2026-04-01（校准基线数据 + 新增 R14-R17）
状态：In Progress

---

## 目标

评估当前项目按 DDD 思路划分的领域抽象是否合理，识别：
1. 领域边界是否清晰
2. 依赖方向是否正确（domain 不应依赖 infra）
3. 是否存在贫血模型或逻辑泄漏
4. 共享内核（shared/）的类型归属是否恰当
5. 跨域通信是否通过正确的机制（事件/服务/端口）
6. 废弃领域的迁移路径是否明确
7. 统一语言（Ubiquitous Language）在代码与类型中是否一致

## 执行前说明

这份计划不是重复 2026-03-28 的 Post-DDD 结论，而是基于 2026-04-01 当前代码树做一次**校准型复审**。需要明确两点：

1. 旧结论可作为历史参考，但**不直接视为当前事实**
   - `docs/review/archive/POST-DDD-REVIEW.md` 认为跨域依赖“仅 9 处，均可接受”，而本计划的 2026-04-01 静态扫描已经发现 `conversation -> notification-feed` 等直接依赖明显增多。
   - 因此本轮 review 的目标不是证明“DDD 已完成”，而是确认哪些结论仍然成立，哪些已经回退或演进失控。

2. 本计划输出的是**可执行的架构结论**
   - 每个问题都应落到“保留 / 合并 / 拆分 / 降级为 infra / 引入 port / 迁移到 workflows / 暂缓处理”之一。
   - 不接受只有现象、没有决策建议的 review 结果。

### 入口标准

- review 范围以当前 `main` 工作树为准，而不是历史报告的文件列表
- 所有结论优先基于代码事实：import、调用链、注册点、schema、运行时单例、shared 类型依赖
- `@deprecated`、兼容层、re-export 文件需要单独标记，避免把迁移过渡层误判为目标架构

### 退出标准

- 完成一份最新的 Context Map，明确上游/下游/协作方式
- 每个 R 项都有评分、问题清单、建议动作、影响范围
- 所有 P0/P1 问题都给出处理建议与建议优先级
- 对废弃领域、共享内核、事件系统三类问题给出明确去留结论

---

## 当前架构概览

### 代码规模

| 层 | 行数 | 说明 |
|---|---:|---|
| domains/ | 24,417 | 9 个领域 |
| providers/ | 7,895 | AI 提供商适配 |
| routes/ | 5,129 | HTTP API 层 |
| plugins/ | 4,900 | 插件系统 |
| utils/ | 3,071 | 工具函数 |
| services/ | 2,778 | 应用服务 |
| storage/ | 1,870 | 存储基础设施 |
| repositories/ | 1,453 | 数据访问 |
| middleware/ | 541 | HTTP 中间件 |

### 领域规模

| 领域 | 行数 | 文件数 | 职责 | 备注 |
|---|---:|---:|---|---|
| conversation | 8,668 | 36 | 会话引擎（agent、工具、上下文、WS） | 6 个子目录，Hub 领域 |
| supervision | 4,977 | 20 | 任务监督、checkpoint、worktree | |
| workflows | 3,398 | 25 | 工作流引擎、步骤执行、模板 | 唯一使用 ports/ 模式 |
| gateway | 2,769 | 12 | 网关连接管理、适配器 | adapter 模式良好 |
| local-pr | 1,818 | 6 | 本地 PR 管理 | |
| orchestration | 1,077 | 4 | 任务编排、分支服务 | 可能过小 |
| scheduled-tasks | 965 | 7 | 定时任务 | **@deprecated → workflows** |
| notification-feed | 550 | 5 | 通知流 | 被多领域直接引用 |
| agent-triggers | 345 | 2 | Agent 触发器 | **@deprecated → workflows** |

### 非领域层

| 目录 | 文件数 | 说明 |
|---|---:|---|
| services/ | 11 | 应用服务（file、session、plugin、workspace） |
| repositories/ | 10 | 数据访问（session、project、provider 等），含 supervision-task.ts / worktree-config.ts |
| providers/ | ~25 | AI provider SDK 适配（Claude、Codex、Cursor、Kimi、OpenCode）+ cli-jobs/ |
| plugins/ | 12 | 插件运行时（worker、MCP bridge、tool registry） |
| routes/ | ~28 | HTTP API 端点（不含各域自带的 routes.ts） |
| router/ | 2 | 消息路由注册器（index.ts + README），与 routes/ 共存，关系待厘清 |
| events/ | 1 | pluginEvents 事件总线（14.5KB） |
| mcp/ | 1 | MCP server 实现（mcp-server.ts），独立于 domains/plugins/mcp-bridge.ts |
| handlers/ | 1 | CRUD Handler Factory，基于 Repository 接口生成标准 handler |
| commands/ | 3 | 命令注册（init.ts + registry.ts），无对应领域 |
| utils/ | ~27 | 工具函数，含 run-state.ts / workflow-layout.ts / git-worktrees.ts 等疑似领域逻辑 |

> **顶层孤立文件**（未归属任何领域或层）：
> - `terminal-manager.ts` — 终端生命周期管理，无领域归属
> - `loop-detection.ts` — 循环检测，无领域归属
> - `auth.ts` — 认证逻辑，与 middleware/auth.ts 关系未明
> - `verification/phase1-verify.ts`, `phase2-verify.ts` — **历史迁移验证脚本，疑似死代码**

### 已发现的跨域依赖基线（import 静态分析）

以下依赖图基于 2026-04-01 的代码扫描，作为各 R 项 review 的基线数据：

> ⚠️ **数据说明**：import 计数需区分 `type-only import` 和运行时 import，两者的耦合严重度不同。
> 例如 `conversation → notification-feed` 经实际扫描为 **3 处 type-only import**（均在 `ws/` 子目录），
> 而非早期估计的"10+"。以下表格需在 R2 阶段用 `rg` 重新精确计数并补全分类。

```
conversation ──→ notification-feed   （3 处 type-only import，ws/ 子目录）
conversation ──→ orchestration       （1 处：ClaudiaBranchService 运行时 import）
conversation ──→ gateway             （1 处：getGatewayClient 单例）
agent-triggers ──→ orchestration     （1 处：TaskOrchestrator）
agent-triggers ──→ notification-feed （1 处：NotificationFeedService）
workflows ──→ notification-feed      （1 处：NotificationService via register.ts）
```

> 注：`conversation/ws/handlers/notification-feed.ts` 是 WS 消息分发 handler，其中的
> `NotificationFeedService` 通过构造函数注入（type import），与直接 import 具体实现有本质区别，
> 不应计入"高严重度"跨域依赖，需在 R2 中单独说明。

基础设施泄漏：
```
13 个域文件 ──→ storage/db.ts        （直接 import initDatabase）
3 个域文件 ──→ routes/               （register.ts 引入路由定义）
5 个域文件 ──→ services/             （systemTaskRegistry, workspaceService）
```

---

## 上下文映射（Context Map）

Review 前需先建立 Bounded Context 关系图，明确领域间的协作模式：

| 上游 | 下游 | 当前关系 | 理想关系 |
|---|---|---|---|
| conversation | notification-feed | 直接调用（Conformist） | 发布-订阅（Published Language） |
| conversation | orchestration | 直接 import 具体类 | 端口/接口（Anti-Corruption Layer） |
| conversation | gateway | 直接 import 单例 | 依赖注入 |
| orchestration | supervision | 待确认 | 共享内核或 ACL |
| workflows | scheduled-tasks | scheduled-tasks @deprecated | 吸收合并 |
| workflows | agent-triggers | agent-triggers @deprecated | 吸收合并 |
| pluginEvents (事件总线) | 多领域 | 发布-订阅 | 保持（良好模式） |

**补充要求：**
- Context Map 不能只画“有依赖”，还要标注依赖类型：同步调用、事件、共享类型、共享存储、单例访问
- 对每条关系都要判断它是 `Conformist / Shared Kernel / Published Language / ACL / Open Host Service` 中的哪一种
- 若当前关系与理想关系不一致，需要说明改造成本和收益，而不是默认一律上事件总线

---

## Review 批次

### Phase 1: 领域边界与职责（核心问题）

#### R1: 领域划分合理性

**审查问题：**
- conversation vs orchestration vs supervision 的边界是否清晰？
- conversation 领域 8600+ 行是否过于臃肿？6 个子目录（agent/agent-tools/context/interactions/memory/ws）是否应拆分为独立子域？
  - 特别关注：ws/ 子目录包含 run-handler、run-lifecycle、run-events 等 — 这些是"会话"还是"运行时"？
- orchestration（1077 行，仅 4 文件）是否过小，应归入 supervision 或 conversation？
- agent-triggers（345 行）和 scheduled-tasks（965 行）已标记 @deprecated，迁移到 workflows 的路径和时间表？
- notification-feed（550 行）作为被动接收方，是否应升级为独立的通知领域，还是降级为基础设施？

**决策准则（何时合并/拆分）：**
- **合并信号**：两个领域之间存在 5+ 处直接 import、共享大量类型、无法独立部署或测试
- **拆分信号**：单个领域 > 5000 行且内部子目录有独立的 types/repository/service 结构
- **独立存在信号**：有独立的生命周期、独立的持久化需求、可以被其他领域替换

**本项必须回答的决策问题：**
- `conversation` 是否还是单一领域，还是已经演化为“会话 + 运行时执行 + 交互编排”的复合域
- `orchestration` 是独立域、conversation 的下游能力，还是 supervision/workflows 的协调层
- `notification-feed` 是领域、应用服务，还是基础设施通知投递器
- `gateway` 在 server 侧是业务域还是技术适配域

#### R2: 领域间依赖分析

**已知问题（基于基线扫描）：**

| 源领域 | 目标领域 | import 数 | 是否通过端口 | 严重度 |
|---|---|---:|---|---|
| conversation | notification-feed | 10+ | 否，直接 import 具体 Service | **高** |
| conversation | orchestration | 3 | 否，import TaskOrchestrator 具体类 | **高** |
| conversation | gateway | 2 | 否，import getGatewayClient 单例 | 中 |
| agent-triggers | orchestration | 1 | 否 | 低（已废弃） |
| agent-triggers | notification-feed | 1 | 否 | 低（已废弃） |
| workflows | notification-feed | 1 | 否 | 中 |

**待深入分析：**
- 是否存在循环依赖（A → B → A）？
- supervision ↔ orchestration 之间的实际依赖方向
- conversation → supervision 是否存在隐式依赖（通过 shared types）
- workflows 域的 ports/step-executor.ts 是唯一的端口定义 — 其他域是否需要类似机制？

**补充判定口径：**
- 类型依赖、运行时依赖、单例依赖、注册期依赖分开统计，不能混成一个数字
- “引用次数少”不等于“问题轻”；如果 import 的是单例、协调器、DB 初始化入口，严重度仍然可能很高
- 对每条跨域依赖都要回答：是否业务必然、是否可被端口替换、是否需要 ACL

#### R3: 领域 vs 基础设施边界

**已知违规（基于基线扫描）：**

| 违规类型 | 涉及域 | 具体文件 | 严重度 |
|---|---|---|---|
| domain → storage/db | conversation, local-pr, scheduled-tasks, supervision, workflows, gateway | 各域的 register.ts + ws/ 多文件 | **高** |
| domain → routes/ | scheduled-tasks, workflows, gateway | register.ts 引入路由定义 | **高** |
| domain → services/ | supervision, local-pr, scheduled-tasks, workflows, conversation | systemTaskRegistry, workspaceService | 中 |
| domain → storage/metadata-extractor | conversation | run-lifecycle.ts | 中 |

**待深入分析：**
- repositories/ 全局目录 vs domains 内部 repository.ts 的职责划分规则是什么？
  - 全局：session.ts, project.ts, provider.ts 等（跨域共享的实体）
  - 域内：local-pr/repository.ts, orchestration/repository.ts 等（域专属）
  - 这个划分是否一致？是否有跨域 repository 混入了业务逻辑？
- providers/ 的定位：conversation 直接依赖 provider 实现还是通过端口？
  - PCP（Provider Capability Protocol）在 shared/src/core/pcp.ts 中定义 — 是否被实际使用？
- register.ts 模式（DI 注册点）是否应该成为标准：所有域必须通过 register 暴露，不允许域内文件被外部直接 import？

**本项输出要求：**
- 给出一份“允许依赖清单”和“禁止依赖清单”
- 明确 `register.ts`、`routes.ts`、`repository.ts`、`service.ts` 分别属于哪一层
- 区分“过渡期容忍”与“最终目标架构”，避免把迁移中的妥协写成长期规范

### Phase 2: 分层架构评估

#### R4: Routes → Services → Domains 的调用链

- routes/ 是否直接调用 domain 内部逻辑（绕过 service 层）？
- services/ 11 个文件 vs routes/ ~28 个文件 — 是否有大量业务逻辑泄漏到 route handler？
- 评估哪些 routes 文件包含不应出现在 API 层的业务逻辑
- 部分域自带 routes.ts（local-pr/routes.ts, supervision/routes.ts, scheduled-tasks/routes.ts, workflows/routes.ts）— 这与顶层 routes/ 是什么关系？是否存在路由定义分散的问题？

**重点：`router/` vs `routes/` 的架构意图（必须澄清）**
- `server/src/router/index.ts`（有自己的 README）和 `server/src/routes/` 同时存在
- `router/` 是消息路由注册层，`routes/` 是 HTTP 端点定义 — 还是两者有功能重叠？
- `handlers/factory.ts` 提供通用 CRUD handler 生成能力，是否被 routes/ 和 router/ 一致使用？

**补充检查点：**
- Composition Root 是否清晰（server.ts / server-setup.ts 是否承担了过多职责）
- 请求校验、鉴权、事务边界、错误映射分别落在哪一层
- 如果 routes 只是转发层，应确认 service/domain API 是否稳定；如果 routes 承担编排逻辑，应显式记为架构债务
- `auth.ts`（顶层）与 `middleware/auth.ts` 的职责划分是否清晰

#### R5: Repository 层评估

- repositories/ 目录（10 文件，含 base.ts）vs domains 内部的 repository.ts — 两种位置的 repository 职责是否一致？
  - 已知域内 repository：local-pr, orchestration, notification-feed, scheduled-tasks（含 task-run-repository），workflows（含 workflow-run/schedule/step-run-repository）
- **关键不一致（需重点分析）**：
  - `repositories/supervision-task.ts` 在全局层 — 但 task 生命周期逻辑完全在 `domains/supervision/` 中
  - `repositories/worktree-config.ts` 在全局层 — 但 worktree 管理在 `domains/supervision/worktree-manager.ts`
  - 这两个 repository 为何未放入 supervision 域内？是共享需求还是历史遗留？
- 是否存在 repository 承载业务逻辑（而非纯数据访问）？
- storage/db.ts（53KB，最大单文件）的 schema 管理方式是否合理？是否应拆分？
- base.ts 提供了什么抽象？域内 repository 是否统一继承？

#### R6: 事件系统评估

**已知现状：**
- events/index.ts（14.5KB）定义了 `pluginEvents` 事件总线
- 事件发布者：conversation（run.started/completed/error/toolCall/toolResult）、scheduled-tasks（自定义事件）
- 事件消费者：local-pr（run.completed）、workflows（动态事件订阅）、agent-triggers（onPattern 模式匹配）

**待分析：**
- pluginEvents 是否承载了过多职责？是否应区分「领域事件」和「插件事件」？
- conversation → notification-feed 的 10+ 处直接 import 是否应改为事件驱动？
- 事件的定义和类型安全：事件名称是字符串还是枚举？是否有类型覆盖？
- 是否存在事件丢失风险（内存中 EventEmitter，无持久化）？

**补充判定口径：**
- 先区分“进程内通知”与“真正的领域事件”，不是所有发布订阅都属于 DDD 事件
- 若事件用于可靠业务流程，必须评估幂等、重放、持久化与顺序性；否则只能定位为 best-effort hook
- 若事件仅服务插件扩展，应避免反向侵入核心域

### Phase 3: 共享内核与协议

#### R7: shared/ 类型归属

**已知结构：**
| 目录 | 文件数 | 内容 |
|---|---|---|
| core/ | 8 | Server, Provider, Session, Project, Message, API, MCP, PCP |
| features/ | 9 | Commands, Supervision, Workflows, LocalPR, ScheduledTasks, NotificationFeed, Delegation, AgentTriggers, SystemTasks |
| interaction/ | 4 | Permissions（3 版本共存！）, Forms, Notifications |
| protocol/ | 8+10 | Gateway v2, Correlation, Messages（10 个子模块） |
| facade/ | 8 | BackendFacade, RuntimeCore, StreamManager, RegistryStore, Adapter |
| 顶层 | 3 | PluginTypes（19KB）, Files, Index |

**审查重点：**
- shared/src/core/ — 核心类型是否稳定、无业务逻辑？PCP 协议类型是否属于 core？
- shared/src/features/ — 按功能划分的类型是否与 server domains 一一对应？
  - 已发现：features/delegation.ts 标记 @deprecated、features/agent-triggers.ts 标记 @deprecated — 废弃类型仍在 shared 中
- shared/src/interaction/permissions.ts — **3 个版本的权限策略并存**（v1 AgentPermissionPolicy、v2 CategoryPermissionPolicy、v3 UnifiedPermissionPolicy）— 这是否需要清理？
- shared/src/facade/ — facade 层包含完整的运行时逻辑（RuntimeCore、StreamManager、RegistryStore）— 这些是否应该在 shared 中？还是应移至 desktop？
- shared/src/protocol/ — 网关协议 v2 类型定义详尽（Peer Handshake、Registry、Catalog、Flow Control）— 抽象层级是否合适？

**本项必须落地的结论：**
- `shared` 中哪些内容是共享契约，哪些其实是某一端的实现便利层
- 哪些 `features/*` 应保留，哪些应迁移、删除或标记冻结
- `facade/` 如果保留在 shared，需要给出所有权与版本演进规则

#### R8: Desktop 端架构
- apps/desktop/src/stores/ 的职责划分
- hooks 层是否存在应属于 store 的逻辑？
- desktop 对 shared 的依赖是否合理？
- facade 层逻辑在 shared 中定义但主要由 desktop 消费 — 这种所有权模型是否正确？

### Phase 4: 横切关注点

#### R9: 插件系统定位
- plugins/ 是基础设施还是独立领域？
- 插件与 domain 的交互机制（tool-registry、workflow-step-registry）
- MCP bridge 的抽象是否合理？
- plugins/loader.ts（50KB）— 是否过于庞大？职责是否单一？

#### R10: Provider 层架构
- 5 种 AI provider（Claude/Codex/Cursor/Kimi/OpenCode）的适配模式
- adapter vs sdk 的分层是否一致？
  - 已知结构：每个 provider 有 `*-adapter.ts` + `*-sdk.ts`，部分有 `*-app-server.ts`
  - cli-jobs/ 子目录包含 5 个 provider 的 review job — 这属于 provider 层还是业务逻辑？
- PCP（Provider Capability Protocol）在 shared 中定义，server 中有 pcp-capability/negotiator/permission — 是否被充分使用？
- provider 选择与切换的机制：registry.ts 的职责

### Phase 6: 顶层孤立模块与历史遗留（新增）

#### R14: 顶层孤立文件归属

**背景**：以下文件存在于 `server/src/` 根目录，未归属任何 domain/service/infra 层：

| 文件 | 内容 | 问题 |
|---|---|---|
| `terminal-manager.ts` | 终端生命周期管理 | 是独立 domain 还是属于 conversation 或 supervision？ |
| `loop-detection.ts` | AI 调用循环检测 | 是属于 conversation 还是通用基础设施？ |
| `auth.ts` | 认证逻辑 | 与 `middleware/auth.ts` 的职责划分是否清晰？ |

**命令辅助：**
```bash
# 检查这些文件被谁 import
rg -n "from.*terminal-manager|from.*loop-detection|from.*server/src/auth" server/src --glob "*.ts"
```

**本项输出要求：**
- 每个孤立文件给出归属决策：升级为 domain / 移入 infra / 移入 utils / 保留顶层（说明理由）

#### R15: 历史迁移产物清理

**背景**：`verification/phase1-verify.ts` 和 `verification/phase2-verify.ts` 是早期 DDD 迁移验证脚本，
内容为手写断言测试（非 vitest），可能是死代码。

**审查问题：**
- 这两个文件是否仍在生产构建/测试流程中使用（package.json scripts / CI 配置）？
- 它们揭示了早期架构的哪些约束（可作为历史参考）？
- 是否可以安全删除，由正式 e2e 测试替代？

#### R16: `utils/` 领域逻辑泄漏

`server/src/utils/` 包含 27 个文件，其中部分明显是领域关联工具而非通用工具：

| 文件 | 疑似归属域 |
|---|---|
| `run-state.ts` | conversation（Run 生命周期状态） |
| `workflow-layout.ts` | workflows（工作流布局计算） |
| `git-worktrees.ts` | supervision（worktree 管理） |
| `git-operations.ts` | supervision 或 local-pr |

**审查问题：**
- 这些文件是"纯工具函数（无业务语义）"还是"领域逻辑被误放入 utils"？
- 若属于领域逻辑，应移入对应 domain 的内部子目录
- 区分判定：工具函数不依赖领域类型、不包含业务规则；否则属于领域逻辑

#### R17: `commands/` 目录定位

`server/src/commands/` 包含 `init.ts`、`registry.ts`，没有对应的领域目录。

**审查问题：**
- "命令"的语义是 CQRS 中的 Command 还是 CLI 命令还是其他含义？
- 它与 `domains/` 中哪个领域最相关？
- 是否应合并到某个领域，还是升级为独立的命令总线基础设施？

### Phase 5: 废弃领域与迁移（新增）

#### R11: @deprecated 领域迁移评估

**背景**：shared/src/features/ 中 agent-triggers.ts 和 scheduled-tasks.ts 均标记 @deprecated，指向 Workflows。

**审查问题：**
- agent-triggers（345 行）和 scheduled-tasks（965 行）的功能是否已完全被 workflows 覆盖？
- 是否存在外部依赖这些废弃领域的代码（routes/、desktop/）？
- 迁移的阻塞点是什么？是否有数据迁移需求（SQLite schema）？
- 建议迁移时间表和步骤

#### R12: DDD 战术模式评估（新增）

**审查问题：**
- 领域内是否区分了 Entity、Value Object、Aggregate Root？
  - 或者当前是否是纯过程式/贫血模型（DTO + Service 逻辑）？
- Domain Service vs Application Service 的边界：
  - domains/ 内的 service.ts 是领域服务还是应用服务？
  - services/ 目录中的 11 个文件是否都是应用服务？
- 是否存在该有的领域行为被放在了 service 中（贫血模型反模式）？
  - 例：SupervisionTask 的状态流转逻辑在哪里？在 task-lifecycle.ts（service）还是在 task 实体自身？

#### R13: 统一语言一致性检查（新增）

**审查问题：**
- server domains 命名 vs shared features 命名是否一致？
  - 例：server 有 `supervision/`，shared 有 `features/supervision.ts` — 一致
  - 例：server 有 `conversation/`，shared 无对应的 `features/conversation.ts` — 不一致？
- 同一概念在不同层是否用了不同的名称？
  - "Run" vs "Session" vs "Conversation" — 生命周期相关术语是否清晰？
  - "Task" 在 supervision（SupervisionTask）、orchestration（TaskOrchestrator）、scheduled-tasks（ScheduledTask）、system-tasks（SystemTaskInfo）中各自含义是否有歧义？
  - "Agent" 在 agent-triggers、conversation/agent/、supervision（SupervisorAgent）中各自含义
- shared/src/protocol/messages/ 中 10 个子模块的命名是否与后端域对齐？

---

## 评估维度

每个 Review 项将从以下维度评分（1-5）：

| 维度 | 说明 | 评分标准 |
|---|---|---|
| 边界清晰度 | 领域/模块的职责是否单一、边界是否明确 | 5=职责单一无歧义 1=职责模糊严重重叠 |
| 依赖正确性 | 依赖方向是否符合 DDD 分层，是否通过 port/interface | 5=全部通过端口 1=大量直接 import |
| 内聚性 | 领域内部逻辑是否高度内聚 | 5=修改不出域 1=散落在多层 |
| 耦合度 | 跨域/跨层的耦合是否最小化 | 5=仅通过事件/端口 1=广泛直接依赖 |
| 可演进性 | 架构是否支持功能的独立演进 | 5=可独立替换/重构 1=牵一发动全身 |
| 语言一致性 | 命名、概念在各层是否统一 | 5=全栈一致 1=同概念多名 |

**评分使用说明：**
- 3 分表示“基本可接受但存在明确架构债务”，不是中性占位分
- 1-2 分必须附带修复建议和优先级
- 4-5 分应明确说明为什么当前设计值得保留，避免 review 只会挑问题

---

## 执行方式

### 每个 R 项的输出模板

```markdown
## Rx: [标题]

### 评分
| 维度 | 分数 | 说明 |
|---|---:|---|
| 边界清晰度 | x/5 | ... |
| ... | | |

### 依赖图
[Mermaid 或文字描述的 import 关系]

### 问题清单
| # | 问题 | 严重度 | 涉及文件 | 建议 |
|---|---|---|---|---|
| 1 | ... | 高/中/低 | file:line | ... |

### 改进建议
[按优先级排列的具体行动项]

### 决策结论
[保留 / 合并 / 拆分 / 降级为 infra / 引入 port / 延后处理]

### 影响范围
[修改涉及的文件数、是否需要数据迁移、是否影响 API 兼容性]
```

### 工具辅助

1. **跨域依赖扫描**：
   ```bash
   # 扫描 domain A → domain B 的 import（全部）
   rg -n "from .*domains/|from '.*domains/" server/src/domains --glob "*.ts" -g "!**/__tests__/**"

   # 区分 type-only import（import type）vs 运行时 import
   rg -n "^import type.*from.*domains/" server/src/domains --glob "*.ts" -g "!**/__tests__/**"
   rg -n "^import \{.*from.*domains/" server/src/domains --glob "*.ts" -g "!**/__tests__/**"

   # 扫描 domain → infra 的违规 import
   rg -n "from .*storage/|from .*routes/|from .*middleware/|from .*services/|from .*repositories/" server/src/domains --glob "*.ts"

   # 查找顶层孤立文件的引用者
   rg -n "from.*terminal-manager|from.*loop-detection|from ['\"].*auth['\"]" server/src --glob "*.ts" -g "!**/__tests__/**"
   ```

2. **按文件统计行数**：
   ```bash
   find server/src/domains -name "*.ts" -not -path "*__tests__*" -print0 | xargs -0 wc -l | sort -rn
   ```

3. **检测循环依赖**：
   - 可用 `madge --circular server/src/domains/` 或手动分析 import 图
   - 若 `madge` 结果与人工判断冲突，以实际 import 链和运行时组合根为准

### 建议补充产物

1. **术语表**
   - 统一定义 `Conversation / Run / Session / Task / Workflow / Trigger / Notification / Agent`

2. **依赖分类表**
   - 每条依赖标记为 `type-only / runtime / singleton / register-time / shared-db`

3. **整改路线图**
   - `P0：边界纠偏`
   - `P1：端口化与 register 规范`
   - `P2：shared 清理与术语统一`

### 优先级矩阵

| 阶段 | Review 项 | 优先级 | 预估复杂度 | 可并行 |
|---|---|---|---|---|
| Phase 1 | R1 领域划分 | **P0** | 高 | 否（后续依赖） |
| Phase 1 | R2 领域间依赖 | **P0** | 中 | 与 R1 顺序执行 |
| Phase 1 | R3 领域 vs 基础设施 | **P0** | 中 | 与 R2 顺序执行 |
| Phase 2 | R4 调用链 | P1 | 中 | 是 |
| Phase 2 | R5 Repository 层 | P1 | 低 | 是 |
| Phase 2 | R6 事件系统 | P1 | 中 | 是 |
| Phase 3 | R7 shared/ 类型 | P1 | 高 | 是 |
| Phase 3 | R8 Desktop 架构 | P2 | 中 | 是 |
| Phase 4 | R9 插件系统 | P2 | 中 | 是 |
| Phase 4 | R10 Provider 层 | P2 | 中 | 是 |
| Phase 5 | R11 废弃迁移 | P1 | 低 | 是 |
| Phase 5 | R12 战术模式 | P2 | 高 | 是 |
| Phase 5 | R13 统一语言 | P2 | 低 | 是 |
| Phase 6 | R14 顶层孤立文件 | P2 | 低 | 是 |
| Phase 6 | R15 历史迁移产物 | P3 | 低 | 是 |
| Phase 6 | R16 utils 领域泄漏 | P2 | 低 | 是 |
| Phase 6 | R17 commands 定位 | P3 | 低 | 是 |

执行顺序：R1 → R2 → R3（串行），然后 R4-R17 按优先级并行

---

## 预期产出

1. **领域边界调整建议**（合并/拆分/重命名方案）
2. **上下文映射图**（Bounded Context Map，标注协作模式）
3. **依赖关系改进方案**（引入端口的具体设计）
4. **分层违规清单及修复优先级**
5. **废弃领域迁移计划**（agent-triggers + scheduled-tasks → workflows）
6. **架构演进路线图**（短期修复 → 中期重构 → 长期目标架构）
7. **统一语言词汇表**（核心领域术语的规范定义）

## 建议补充的最终汇总结构

为避免 review 报告很多、结论分散，建议在全部 R 项完成后再产出一份总报告，固定包含：

1. `Executive Summary`
   - 当前 DDD 成熟度结论
   - 最严重的 3-5 个架构问题

2. `Decision Log`
   - 哪些领域保留
   - 哪些领域合并/降级
   - 哪些依赖允许继续存在，哪些必须整改

3. `Refactor Roadmap`
   - 1 周内可完成
   - 1 个版本内可完成
   - 长期方向
