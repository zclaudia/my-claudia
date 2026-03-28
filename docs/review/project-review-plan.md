# MyClaudia 项目 Review & 优化计划

日期：2026-03-28
状态：Ready for Execution

## 执行前说明

这份文档已按当前代码树重新整理。现阶段项目结构不再适合用旧的“按历史文件路径”方式 review，尤其是 `server/` 已明显收敛为 `infra + domains` 双层结构：

- `server/src/domains/` 已成为主要业务边界，当前包含 `conversation`、`gateway`、`supervision`、`workflows`、`scheduled-tasks`、`local-pr`、`notification-feed`、`orchestration`、`agent-triggers`
- 旧文档中提到的 `server/src/orchestration/` 已不存在，相关能力已迁入 `server/src/domains/orchestration/`
- 旧文档中按 `ws/`、`services/supervision/`、`gateway-client.ts` 根目录文件组织的 review 范围已经过时，必须改为按当前 domain 边界和 infra 边界 review

执行原则：
- 先做基线核对，再进入分批 review，避免按过期范围审查
- 每个 Batch 同时关注代码质量、架构、性能、安全、可维护性
- 对 1 行 store / service / re-export 文件，默认视为迁移兼容层候选，不直接判定为废弃代码
- 当前 `server` 采用 “infra + domains” 结构，`desktop` 采用 “foundation + features + components” 结构，review 方案必须反映这个现实

## Phase 0: Review Baseline（执行基线）

**目标**: 在进入正式 review 前，先确认范围、热点和兼容层，确保后续结论基于当前代码现实。

**输出物**:
- 各 Batch 的实际文件清单
- 当前超大文件清单（建议关注 >500 行，重点关注 >1000 行）
- 兼容层 / 转发层清单（1 行导出、deprecated wrapper、migration shim）
- 当前工作区改动热点，作为 review 排期参考

**完成标准**:
- Batch 范围与代码树一致
- 已识别需要后置 review 的高变更区域
- 已区分“兼容层”与“废弃代码”

## 当前结构概览

### Shared

| 模块 | 当前结构 |
|------|---------|
| shared | `core/`、`features/`、`interaction/`、`protocol/`、`facade/` + 根级类型文件 |

### Gateway

| 模块 | 当前结构 |
|------|---------|
| gateway | 独立 relay 服务，核心仍集中在 `gateway/src/server.ts`、`storage.ts`、`state.ts`、`proxy-body.ts` |

### Server

| 层级 | 当前结构 |
|------|---------|
| Domain 层 | `domains/conversation`、`gateway`、`supervision`、`workflows`、`scheduled-tasks`、`local-pr`、`notification-feed`、`orchestration`、`agent-triggers` |
| Infra 层 | `providers`、`plugins`、`storage`、`middleware`、`routes`、`router`、`repositories`、`events`、`commands`、`mcp`、`utils`、`services` |

### Desktop

| 层级 | 当前结构 |
|------|---------|
| Foundation | `stores`、`services`、`hooks`、`facade`、`contexts`、`config`、`utils`、`plugins` |
| Feature Domains | `features/workflows`、`supervision`、`local-pr`、`scheduled-tasks`、`automation` |
| UI Shell | `components/chat`、`claudia`、`dashboard`、`draft`、`fileviewer`、`permission`、`settings`、`sidebar`、`terminal` 等 |

---

## 模块清单 & Review 批次

### Batch 1: Shared Contract & Facade（共享契约层）

**范围**: `shared/src/`

| 子模块 | 文件 | 职责 |
|--------|------|------|
| core/ | server, provider, session, message, project, api, mcp, pcp | 核心实体与协议基础类型 |
| features/ | workflows, supervision, scheduled-tasks, local-pr, agent-triggers, delegation, commands, notification-feed, system-tasks | 跨端 feature 类型 |
| interaction/ | permissions, forms, notifications | 用户交互类型 |
| protocol/ | messages/*, correlation, gateway | WebSocket / Gateway 协议 |
| facade/ | adapter, runtime-core, stream-manager, registry-store, snapshot, types | 共享 facade 运行时契约 |
| 根级文件 | `plugin-types.ts`、`files.ts`、`index.ts` | 插件类型、文件类型、总导出 |

**Review 重点**:
- 类型命名一致性
- `protocol/messages` 的消息分类是否合理
- facade 对外契约是否稳定
- shared 对外 export 是否干净
- 是否有 `any` 逃逸或过宽的类型守卫

**预计耗时**: 1 天

---

### Batch 2: Gateway Relay Service（中继服务）

**范围**: `gateway/src/`

| 文件 | 职责 |
|------|------|
| `server.ts` | WebSocket relay、backend 注册、client 认证、消息转发 |
| `storage.ts` | 设备 → backend ID 映射 |
| `state.ts` | 连接状态管理 |
| `proxy-body.ts` | HTTP 代理请求体处理 |
| `index.ts` | 入口 |

**Review 重点**:
- 消息转发正确性与边界处理
- 认证流程安全性
- HTTP 代理流式处理
- 重连与恢复能力
- 输入消息的 schema 边界与 `any` 收口位置

**预计耗时**: 0.5 天

---

### Batch 3: Server Infra — Platform Core（平台基础设施）

**范围**: `server/src/{storage,middleware,router,routes,repositories,events,commands,mcp,services,helpers,utils}` + 根级入口文件

| 子模块 | 当前职责 |
|--------|---------|
| storage | SQLite 初始化、文件存储、schema 管理 |
| middleware | HTTP / WS 认证、日志、错误处理 |
| router + routes | REST / Phase 2 路由 |
| repositories | 通用数据访问层 |
| events | 事件总线 |
| commands | 内置命令注册 |
| mcp | MCP 服务能力 |
| services | 现已收敛为少量平台 service（如 workspace、system-task-registry） |
| utils / helpers | 通用基础工具 |
| 根级入口 | `index.ts`、`server.ts`、`server-setup.ts`、`terminal-manager.ts` 等 |

**Review 重点**:
- `server.ts` / `index.ts` 的模块级状态是否过多
- `routes` 与 `router` 的职责边界
- storage schema / migration 策略
- repositories 抽象是否稳定
- 事件总线、工具层、MCP、命令注册是否存在跨层耦合

**预计耗时**: 1.5 天

---

### Batch 4: Server Domain — Conversation（对话域）

**范围**: `server/src/domains/conversation/`

| 子模块 | 关键文件 | 职责 |
|--------|---------|------|
| ws/ | `run-handler.ts`, `message-handler.ts`, `run-lifecycle.ts`, `handlers/*` | 对话启动、消息分发、生命周期控制 |
| context/ | `engine.ts`, `types.ts` | 上下文注入 |
| interactions/ | `interaction-*`, `todo-normalizer.ts` | 交互链路 |
| memory/ | `memory-store.ts`, `activity-log.ts` | 记忆与活动日志 |
| agent/ | `permission-evaluator.ts`, `delegation-evaluator.ts` | 权限与委托评估 |
| agent-tools/ | `browser.ts`, `network-guard.ts`, `task-tools.ts` | Agent 工具注册 |

**Review 重点**:
- `run-handler.ts` 的复杂度、错误恢复、状态机
- interaction 处理链路可靠性
- conversation domain 是否真正内聚，还是仍依赖大量 infra 泄漏
- memory / context / tools 的边界设计
- `network-guard` 等安全边界

**预计耗时**: 1.5 天

---

### Batch 5: Server Domain — Gateway（服务端网关域）

**范围**: `server/src/domains/gateway/`

| 文件 | 职责 |
|------|------|
| `gateway-client.ts` | Gateway WebSocket 客户端 |
| `manager.ts` | Gateway 管理协调 |
| `gateway-instance.ts` | 全局实例 |
| `gateway-channel-cleanup.ts` | channel 清理 |
| `embedded-*` | 嵌入式模式接入 |
| `standalone-*` | 独立模式接入 |
| `ws-hub.ts` | WebSocket hub 协调 |

**Review 重点**:
- gateway domain 与 relay service 的协议一致性
- 嵌入式 / 独立模式职责边界
- manager / instance / adapter 的生命周期是否清晰
- 重连、同步、清理策略是否闭环

**预计耗时**: 1 天

---

### Batch 6: Server Domain — Supervision（监督执行域）

**范围**: `server/src/domains/supervision/`

| 文件 | 职责 |
|------|------|
| `supervisor-service.ts` | 监督执行主服务 |
| `review-engine.ts` | 审查引擎 |
| `context-manager.ts` | 上下文管理 |
| `checkpoint-engine.ts` | 检查点与回滚 |
| `state-recovery.ts` | 状态恢复 |
| `task-runner.ts` | 子任务执行 |
| `worktree-pool.ts` | Git worktree 池 |
| `plan-validator.ts` | 计划验证 |
| `routes.ts` / `register.ts` | 对外注册与路由 |

**Review 重点**:
- `supervisor-service.ts` 是否需要继续拆分
- worktree / checkpoint / recovery 的可靠性
- review-engine 的评审准确性
- 并发任务与资源释放的竞态条件

**预计耗时**: 1.5 天

---

### Batch 7: Server Domains — Workflow Automation（工作流自动化域）

**范围**: `server/src/domains/{workflows,scheduled-tasks,agent-triggers}`

| 子域 | 当前职责 |
|------|---------|
| workflows | 工作流定义、生成、执行、模板、运行存储 |
| scheduled-tasks | cron 调度、任务实例、模板 |
| agent-triggers | 事件驱动触发 |

**Review 重点**:
- workflows / scheduled-tasks / agent-triggers 之间的职责边界
- workflow engine / generator / template renderer 的安全性与恢复能力
- automation 逻辑是否真正收敛到 domain 内，而不是散落在 infra 或 desktop
- repository、routes、register 的组织是否一致

**预计耗时**: 1.5 天

---

### Batch 8: Server Domains — Orchestration & Collaboration（编排与协作域）

**范围**: `server/src/domains/{orchestration,local-pr,notification-feed}`

| 子域 | 当前职责 |
|------|---------|
| orchestration | Claudia branch、task orchestrator、状态协调 |
| local-pr | 本地 PR 流程、仓储、路由、注册 |
| notification-feed | 通知流、service、repository、routes |

**Review 重点**:
- `domains/orchestration` 是否真正完成从旧路径迁移
- local-pr 的代码审查流程完整性
- notification-feed 的存储、广播、清理策略
- 这三个 domain 是否存在过度耦合

**预计耗时**: 1 天

---

### Batch 9: Server Infra — Providers & Plugins（扩展基础设施）

**范围**: `server/src/{providers,plugins}`

| 子模块 | 当前职责 |
|--------|---------|
| providers | Claude / Codex / Kimi / Cursor / OpenCode 等 provider 适配与能力协商 |
| plugins | 插件发现、加载、worker 宿主、权限、MCP bridge、工具注册 |

**Review 重点**:
- providers 的适配器模式、超时、取消、重试策略是否一致
- `opencode-sdk.ts` 等超大文件是否需要拆分
- plugin loader / worker-host / provider-api 的边界是否清晰
- 插件沙箱、安全隔离、动态注册、事件监听清理

**预计耗时**: 2 天

---

### Batch 10: Desktop Foundation（桌面端基础层）

**范围**: `apps/desktop/src/{stores,services,hooks,facade,contexts,config,utils,plugins}`

| 子模块 | 当前职责 |
|--------|---------|
| stores | 应用状态管理 |
| services | API、messageHandler、sessionSync、文件传输等 |
| hooks | 连接、数据加载、chat 行为、transport |
| facade | embedded facade client |
| contexts | 连接上下文等 |
| config / utils / plugins | 配置、辅助能力、桌面端插件层 |

**Review 重点**:
- store / service / hook 的职责边界
- 数据同步策略（WS push vs HTTP poll）
- facade / transport / store 三层是否清晰
- 1 行 store 是否仍是兼容导出层

**预计耗时**: 1.5 天

---

### Batch 11: Desktop UI Shell（桌面端壳层 UI）

**范围**: `apps/desktop/src/components/{chat,claudia,dashboard,draft,fileviewer,notifications,permission,settings,sidebar,terminal,ui}` + 顶层 `App.tsx`

| 子模块 | 当前职责 |
|--------|---------|
| chat | 聊天主界面 |
| claudia | Claudia 元 Agent UI |
| shell 组件 | dashboard、sidebar、settings、terminal、fileviewer、draft 等 |
| ui | 基础 UI 组件 |

**Review 重点**:
- Chat UI 的职责划分与性能
- shell 组件之间的复用率
- 壳层 UI 是否知道过多业务细节
- 顶层布局是否存在状态耦合和渲染压力

**预计耗时**: 1.5 天

---

### Batch 12: Desktop Feature Domains（桌面端业务域）

**范围**: `apps/desktop/src/features/{workflows,supervision,local-pr,scheduled-tasks,automation}`

| Feature | 当前职责 |
|---------|---------|
| workflows | 工作流可视化编辑与管理 |
| supervision | 监督执行 UI |
| local-pr | 本地 PR UI |
| scheduled-tasks | 定时任务 UI |
| automation | 自动化面板与弹窗 |

**Review 重点**:
- feature 内部的 `api / handlers / store / components` 分层是否统一
- desktop feature 是否与 server domain 一一映射
- workflows / supervision 这类复杂 feature 的边界是否清晰
- 是否具备进一步 lazy load / code split 的空间

**预计耗时**: 1.5 天

---

### Batch 13: E2E Tests & Scripts

**范围**: `e2e/` + `scripts/`

**Review 重点**:
- E2E 覆盖的场景完整性
- 测试稳定性（flaky test）
- 构建 / 部署脚本健壮性
- CI/CD 流程与实际结构是否匹配

**预计耗时**: 0.5 天

---

## 推荐执行顺序

优先按“共享契约 → gateway → server infra → server domains → desktop foundation → desktop features/UI → E2E”执行：

| 顺序 | 批次 | 模块 |
|------|------|------|
| 0 | Phase 0 | Review Baseline |
| 1 | Batch 1 | Shared Contract & Facade |
| 2 | Batch 2 | Gateway Relay Service |
| 3 | Batch 3 | Server Infra — Platform Core |
| 4 | Batch 5 | Server Domain — Gateway |
| 5 | Batch 4 | Server Domain — Conversation |
| 6 | Batch 6 | Server Domain — Supervision |
| 7 | Batch 7 | Server Domains — Workflow Automation |
| 8 | Batch 8 | Server Domains — Orchestration & Collaboration |
| 9 | Batch 9 | Server Infra — Providers & Plugins |
| 10 | Batch 10 | Desktop Foundation |
| 11 | Batch 11 | Desktop UI Shell |
| 12 | Batch 12 | Desktop Feature Domains |
| 13 | Batch 13 | E2E Tests & Scripts |

## Review 总时间表

| 批次 | 模块 | 预计耗时 | 累计 |
|------|------|---------|------|
| Phase 0 | Review Baseline | 0.5 天 | 0.5 天 |
| Batch 1 | Shared Contract & Facade | 1 天 | 1.5 天 |
| Batch 2 | Gateway Relay Service | 0.5 天 | 2 天 |
| Batch 3 | Server Infra — Platform Core | 1.5 天 | 3.5 天 |
| Batch 5 | Server Domain — Gateway | 1 天 | 4.5 天 |
| Batch 4 | Server Domain — Conversation | 1.5 天 | 6 天 |
| Batch 6 | Server Domain — Supervision | 1.5 天 | 7.5 天 |
| Batch 7 | Server Domains — Workflow Automation | 1.5 天 | 9 天 |
| Batch 8 | Server Domains — Orchestration & Collaboration | 1 天 | 10 天 |
| Batch 9 | Server Infra — Providers & Plugins | 2 天 | 12 天 |
| Batch 10 | Desktop Foundation | 1.5 天 | 13.5 天 |
| Batch 11 | Desktop UI Shell | 1.5 天 | 15 天 |
| Batch 12 | Desktop Feature Domains | 1.5 天 | 16.5 天 |
| Batch 13 | E2E Tests & Scripts | 0.5 天 | 17 天 |

**总计：约 17 个工作日**

---

## Review 维度检查清单

每个 Batch Review 时统一关注以下维度：

### 代码质量
- [ ] 单一职责：文件/函数是否过大（>500 行需关注）
- [ ] 命名一致性：变量、函数、类型命名是否统一
- [ ] 错误处理：是否有未处理的 Promise rejection、空 catch
- [ ] TypeScript 严格性：`any` 逃逸、类型断言、弱类型上下文是否合理
- [ ] 兼容层识别：1 行 store / service / re-export 是迁移 shim、兼容出口还是死代码
- [ ] 死代码：未使用 export、已无调用方的兼容层、无效 TODO

### 架构
- [ ] domain 边界：domain 内是否自包含，是否存在明显跨域耦合
- [ ] infra 边界：infra 是否泄漏业务语义，或被 domain 反向依赖
- [ ] public API：register / routes / repository / service 的暴露面是否最小化
- [ ] 依赖方向：是否存在循环依赖或跨层调用

### 性能
- [ ] 内存泄漏：事件监听器、定时器、Map 是否正确清理
- [ ] WebSocket：消息频率、序列化开销、流式背压
- [ ] 数据库查询：N+1、索引缺失、长事务
- [ ] Desktop 渲染：重渲染、大列表、窗口/弹层状态同步

### 安全
- [ ] 认证/授权：API / WS / gateway / plugin 权限是否全覆盖
- [ ] 输入校验：消息、表单、模板、脚本输入是否收口
- [ ] 插件沙箱：worker 隔离是否充分
- [ ] 敏感信息：日志中是否泄露 token / secret / path

### 可维护性
- [ ] 测试覆盖：关键路径是否有测试
- [ ] 文档与注释：复杂逻辑是否有必要说明
- [ ] 配置管理：硬编码 magic number 是否过多
- [ ] 输出统一：每个 batch 是否按 Findings / Refactor Candidates / Test Gaps 记录

---

## 已知的潜在优化点（基于当前结构）

### 高优先级
1. **Conversation 复杂度集中**: `domains/conversation/ws/run-handler.ts` 仍是核心复杂度热点
2. **Supervision 复杂度集中**: `domains/supervision/supervisor-service.ts` 仍是超大文件
3. **Providers / Plugins 仍是大型 infra**: 这两块尚未 domain 化，且文件规模大、接口复杂
4. **旧路径认知需要清理**: 文档、认知和代码实际结构已发生偏移，后续 review 与重构都应统一采用当前 domain 视角

### 中优先级
5. **Desktop foundation 边界需厘清**: `stores / services / hooks / facade` 可能存在职责交叠
6. **Server infra 体量仍大**: `routes`、`utils`、`storage`、`repositories` 等仍是 review 大头
7. **兼容层清理策略**: 1 行导出文件需要先确认调用方，再决定删除

### 低优先级
8. **Gateway relay 本身结构相对稳定**: 优先关注协议边界与恢复机制，不急于拆分
9. **E2E / Scripts 需要在结构稳定后收尾 review**

## 每个 Batch 的统一产出

每次 review 固定输出三部分：

1. **Findings**
   - 按严重级别排序
   - 给出文件位置、问题描述、影响范围、是否阻断
2. **Refactor Candidates**
   - 非阻断但值得纳入重构计划的结构问题
   - 标明“建议拆分 / 建议迁移 / 建议删除兼容层 / 建议补类型”
3. **Test Gaps**
   - 缺失的关键测试场景
   - 是否需要回归测试或补充集成测试
