# MyClaudia 项目 Review & 优化计划

日期：2026-03-31
状态：✅ Completed

## 当前执行进度（2026-03-31）

已完成：
- Phase 0: Review Baseline
- Batch 1: Shared Contract & Facade — [batch-01-shared-types.md](./batch-01-shared-types.md)
- Batch 2: Gateway Relay Service — [batch-02-gateway.md](./batch-02-gateway.md)
- Batch 3: Server Infra — Runtime Core — [batch-03-server-core.md](./batch-03-server-core.md)
- Batch 4: Server Infra — API Surface — [batch-04-api-surface.md](./batch-04-api-surface.md)
- Batch 5: Server Domain — Gateway — [batch-05-gateway-domain.md](./batch-05-gateway-domain.md)
- Batch 6: Server Domain — Conversation — [batch-06-conversation-engine.md](./batch-06-conversation-engine.md)
- Batch 7: Server Domain — Supervision — [batch-07-supervision.md](./batch-07-supervision.md)
- Batch 8: Server Domains — Workflow Automation — [batch-08-automation.md](./batch-08-automation.md)（第二轮修复 + DDD P1 重构已落地）
- Batch 9: Server Domains — Orchestration & Collaboration — [batch-09-orchestration-collab.md](./batch-09-orchestration-collab.md)

当前下一批：
- Batch 10: Server Infra — Providers & Plugin System

说明：
- Batch 8 完成内容：6 项 bug 修复、1 项降级、DDD P1（Engine step handler 拆分 + Port/Adapter 注入），详见报告。
- Batch 9 完成内容：3 项 HIGH（反向依赖×2、裸 SQL 绕过 repo）、7 项 MEDIUM、5 项 refactor candidate，详见报告。

## 编号对齐说明（2026-03-31）

所有 `docs/review/batch-*.md` 报告文件已统一重命名，**文件编号与本计划的批次编号一一对应**，不再存在新旧编号错位问题。

## 执行前说明

这份文档基于 2026-03-29 当前代码树重新校准。相比上一版，结构层级没有再次翻转，但代码量分布已经明显变化，因此本次调整重点不是“改命名”，而是“重估批次粒度与耗时”。

当前最重要的现实：
- `server/` 仍然是 `infra + domains` 双层结构
- `server/src/routes`、`providers`、`plugins` 体量持续增长，已经不适合放在一个宽泛的 infra 批次里一起 review
- `server/src/domains/conversation`、`supervision` 仍是最重的业务域
- `apps/desktop/src/components` 已达到桌面端最大代码块，`stores / hooks / services` 也已经形成独立大批次
- `local-reviewer` 已经形成一条新的横切链路，跨越 `shared`、`server/src/domains/conversation/agent` 与 `apps/desktop/src/stores`

执行原则：
- 先做基线核对，再进入分批 review，避免按过期范围审查
- 每个 Batch 同时关注代码质量、架构、性能、安全、可维护性
- 对 1 行 store / service / re-export 文件，默认视为迁移兼容层候选，不直接判定为废弃代码
- Batch 粒度必须服从当前代码量现实，而不是服从历史目录印象

## Phase 0: Review Baseline（执行基线）

**目标**: 在进入正式 review 前，先确认范围、热点、兼容层和高变更区域，确保后续结论基于当前代码现实。

**输出物**:
- 各 Batch 的实际文件清单
- 当前超大文件清单（建议关注 >500 行，重点关注 >1000 行）
- 兼容层 / 转发层清单（1 行导出、deprecated wrapper、migration shim）
- 当前工作区改动热点，作为 review 排期参考

**完成标准**:
- Batch 范围与代码树一致
- 已识别需要后置 review 的高变更区域
- 已区分“兼容层”与“废弃代码”

## Phase 0 当前发现（2026-03-29）

1. **计划缺口已确认**: `local-reviewer` 已进入共享契约与运行时实现，现有 review 计划必须显式覆盖这条链路。
2. **高变更区域明确**: 最近 3 天改动主要集中在 `apps/desktop/src/components`、`stores`、`hooks`、`services`，以及 `server/src/domains/conversation`、`domains/gateway`、`domains/local-pr`。这些区域适合在基线完成后再进入深度审查。
3. **兼容层候选已确认**: 当前至少存在 4 个明显的一行转发文件：
   - `apps/desktop/src/services/api/local-prs.ts`
   - `apps/desktop/src/services/api/scheduled-tasks.ts`
   - `apps/desktop/src/services/api/workflows.ts`
   - `apps/desktop/src/stores/supervisionStore.ts`
4. **当前建议起点**: Phase 0 结束后，优先进入 `Batch 1` 或 `Batch 2`，暂缓直接进入 desktop foundation / UI shell。

## 当前规模概览

### Server Domain 体量（当前）

| Domain | 约代码量 |
|--------|---------|
| supervision | ~12.4k |
| conversation | ~9.7k |
| workflows | ~5.6k |
| local-pr | ~4.0k |
| gateway | ~3.4k |
| scheduled-tasks | ~1.7k |
| orchestration | ~1.4k |
| notification-feed | ~1.1k |
| agent-triggers | ~0.3k |

### Server Infra 体量（当前）

| Infra | 约代码量 |
|-------|---------|
| routes | ~21.0k |
| providers | ~14.0k |
| plugins | ~9.4k |
| utils | ~5.4k |
| storage | ~3.4k |
| repositories | ~2.7k |
| middleware | ~2.0k |
| events / commands / router / services / mcp | ~3.1k 合计 |

### Desktop 体量（当前）

| 层级 | 约代码量 |
|------|---------|
| components | ~43.3k |
| features | ~12.9k |
| stores | ~10.7k |
| hooks | ~10.1k |
| services | ~8.9k |
| facade / contexts / utils / config / plugins | ~3.1k 合计 |

### 当前显著热点文件

| 文件 | 行数 |
|------|------|
| `server/src/providers/opencode-sdk.ts` | 1666 |
| `server/src/domains/conversation/ws/run-handler.ts` | 1628 |
| `server/src/plugins/loader.ts` | 1394 |
| `server/src/domains/supervision/supervisor-service.ts` | 1370 |
| `server/src/storage/db.ts` | 1343 |
| `apps/desktop/src/services/messageHandler.ts` | 1187 |
| `server/src/domains/local-pr/service.ts` | 1165 |
| `server/src/domains/workflows/engine.ts` | 1099 |
| `apps/desktop/src/components/SettingsPanel.tsx` | 1085 |
| `apps/desktop/src/App.tsx` | 1043 |
| `server/src/domains/gateway/gateway-client.ts` | 1041 |

---

## 模块清单 & Review 批次

### Batch 1: Shared Contract & Facade（共享契约层）

**范围**: `shared/src/`

**Review 重点**:
- 类型命名一致性
- `protocol/messages` 的消息分类是否合理
- facade 对外契约是否稳定
- shared 对外 export 是否干净
- `features/local-reviewer.ts` 是否与 server / desktop 实现保持一致
- 是否有 `any` 逃逸或过宽的类型守卫

**预计耗时**: 1 天

---

### Batch 2: Gateway Relay Service（中继服务）

**范围**: `gateway/src/`

**Review 重点**:
- 消息转发正确性与边界处理
- 认证流程安全性
- HTTP 代理流式处理
- 重连与恢复能力
- 输入消息的 schema 边界与 `any` 收口位置

**预计耗时**: 0.5 天

---

### Batch 3: Server Infra — Runtime Core（运行时基础设施）

**范围**: `server/src/{storage,middleware,events,commands,mcp,services,helpers,utils}` + 根级入口文件

**Review 重点**:
- `server.ts` / `index.ts` 的模块级状态是否过多
- storage schema / migration 策略
- middleware 的认证、日志、错误处理边界
- utils / helpers 是否承载过多业务语义
- events / commands / mcp / services 的平台角色是否清晰

**预计耗时**: 1.5 天

---

### Batch 4: Server Infra — API Surface（接口与路由层）

**范围**: `server/src/{router,routes,repositories}`

**报告**: [batch-04-api-surface.md](./batch-04-api-surface.md)

**Review 重点**:
- `routes` 与 `router` 的职责边界
- repositories 是否为 domain 提供了稳定抽象
- 是否存在过多“胖 route / 薄 domain”现象
- API surface 是否与 domain 边界一致

**预计耗时**: 2 天

---

### Batch 5: Server Domain — Gateway（服务端网关域）

**范围**: `server/src/domains/gateway/`

**Review 重点**:
- gateway domain 与 relay service 的协议一致性
- 嵌入式 / 独立模式职责边界
- manager / instance / adapter 的生命周期是否清晰
- 重连、同步、清理策略是否闭环

**预计耗时**: 1 天

---

### Batch 6: Server Domain — Conversation（对话域）

**范围**: `server/src/domains/conversation/`

**Review 重点**:
- `run-handler.ts` 的复杂度、错误恢复、状态机
- interaction 处理链路可靠性
- conversation domain 是否真正内聚
- memory / context / tools 的边界设计
- `ai-review-queue.ts`、`local-sensitivity-reviewer.ts` 与权限 / 委托评估链路是否一致
- `network-guard` 等安全边界

**预计耗时**: 1.5 天

---

### Batch 7: Server Domain — Supervision（监督执行域）

**范围**: `server/src/domains/supervision/`

**Review 重点**:
- `supervisor-service.ts` 是否需要继续拆分
- worktree / checkpoint / recovery 的可靠性
- review-engine 的评审准确性
- 并发任务与资源释放的竞态条件

**预计耗时**: 1.5 天

---

### Batch 8: Server Domains — Workflow Automation（工作流自动化域）

**范围**: `server/src/domains/{workflows,scheduled-tasks,agent-triggers}`

**Review 重点**:
- workflows / scheduled-tasks / agent-triggers 之间的职责边界
- workflow engine / generator / template renderer 的安全性与恢复能力
- automation 逻辑是否真正收敛到 domain 内
- repository、routes、register 的组织是否一致

**预计耗时**: 1.5 天

---

### Batch 9: Server Domains — Orchestration & Collaboration（编排与协作域）

**范围**: `server/src/domains/{orchestration,local-pr,notification-feed}`

**Review 重点**:
- `domains/orchestration` 是否真正完成从旧路径迁移
- local-pr 的代码审查流程完整性
- notification-feed 的存储、广播、清理策略
- 这三个 domain 是否存在过度耦合

**预计耗时**: 1.5 天

---

### Batch 10: Server Infra — Providers（模型接入基础设施）

**范围**: `server/src/providers/`

**报告**: [batch-10-server-providers.md](./batch-10-server-providers.md)

**Review 重点**:
- provider 适配器模式、超时、取消、重试策略是否一致
- `opencode-sdk.ts`、`codex-app-server.ts` 等超大文件是否需要拆分
- PCP / capability 协商是否完整
- provider 生命周期与切换策略是否清晰

**预计耗时**: 1.5 天

---

### Batch 11: Server Infra — Plugins（插件基础设施）

**范围**: `server/src/plugins/`

**Review 重点**:
- loader / worker-host / provider-api 的边界是否清晰
- 插件沙箱、安全隔离、动态注册、事件监听清理
- 插件生命周期是否可拆分
- MCP bridge、skill-tools、tool-registry 的一致性

**预计耗时**: 1.5 天

---

### Batch 12: Desktop Foundation — State & Data Flow（状态与数据流）

**范围**: `apps/desktop/src/{stores,services,hooks,facade,contexts,config,utils,plugins}`

**Review 重点**:
- store / service / hook 的职责边界
- 数据同步策略（WS push vs HTTP poll）
- facade / transport / store 三层是否清晰
- `localReviewerStore` 与 server conversation 侧的 AI review / local reviewer 链路是否对齐
- 1 行 store 是否仍是兼容导出层

**预计耗时**: 2 天

---

### Batch 13: Desktop UI Shell（桌面端壳层 UI）

**范围**: `apps/desktop/src/components/{chat,claudia,dashboard,draft,fileviewer,notifications,permission,settings,sidebar,terminal,ui}` + `App.tsx`

**Review 重点**:
- Chat UI 的职责划分与性能
- shell 组件之间的复用率
- 壳层 UI 是否知道过多业务细节
- 顶层布局是否存在状态耦合和渲染压力

**预计耗时**: 2 天

---

### Batch 14: Desktop Feature Domains（桌面端业务域）

**范围**: `apps/desktop/src/features/{workflows,supervision,local-pr,scheduled-tasks,automation}`

**Review 重点**:
- feature 内部的 `api / handlers / store / components` 分层是否统一
- desktop feature 是否与 server domain 一一映射
- workflows / supervision 这类复杂 feature 的边界是否清晰
- 是否具备进一步 lazy load / code split 的空间

**预计耗时**: 1.5 天

---

### Batch 15: E2E Tests & Scripts

**范围**: `e2e/` + `scripts/`

**Review 重点**:
- E2E 覆盖的场景完整性
- 测试稳定性（flaky test）
- 构建 / 部署脚本健壮性
- CI/CD 流程与实际结构是否匹配

**预计耗时**: 0.5 天

---

## 推荐执行顺序

优先按“共享契约 → gateway → server infra → server domains → provider/plugin infra → desktop foundation → desktop UI/features → E2E”执行：

| 顺序 | 批次 | 模块 |
|------|------|------|
| 0 | Phase 0 | Review Baseline |
| 1 | Batch 1 | Shared Contract & Facade |
| 2 | Batch 2 | Gateway Relay Service |
| 3 | Batch 3 | Server Infra — Runtime Core |
| 4 | Batch 4 | Server Infra — API Surface |
| 5 | Batch 5 | Server Domain — Gateway |
| 6 | Batch 6 | Server Domain — Conversation |
| 7 | Batch 7 | Server Domain — Supervision |
| 8 | Batch 8 | Server Domains — Workflow Automation |
| 9 | Batch 9 | Server Domains — Orchestration & Collaboration |
| 10 | Batch 10 | Server Infra — Providers |
| 11 | Batch 11 | Server Infra — Plugins |
| 12 | Batch 12 | Desktop Foundation — State & Data Flow |
| 13 | Batch 13 | Desktop UI Shell |
| 14 | Batch 14 | Desktop Feature Domains |
| 15 | Batch 15 | E2E Tests & Scripts |

## 当前建议顺序

基于最新项目状态，接下来按下面顺序继续最稳：

1. Batch 6: Server Domain — Conversation
2. Batch 7: Server Domain — Supervision
3. Batch 8: Server Domains — Workflow Automation

原因：
- Batch 1-5 已经把 shared、gateway relay、server infra、API surface、gateway domain 这五层基座收了一遍。
- 下一步自然进入最重的核心业务域：`conversation`。
- `supervision` 与 `workflow automation` 紧随其后，都是高复杂度 server domain，适合连续处理。

## Review 总时间表

| 批次 | 模块 | 预计耗时 | 累计 |
|------|------|---------|------|
| Phase 0 | Review Baseline | 0.5 天 | 0.5 天 |
| Batch 1 | Shared Contract & Facade | 1 天 | 1.5 天 |
| Batch 2 | Gateway Relay Service | 0.5 天 | 2 天 |
| Batch 3 | Server Infra — Runtime Core | 1.5 天 | 3.5 天 |
| Batch 4 | Server Infra — API Surface | 2 天 | 5.5 天 |
| Batch 5 | Server Domain — Gateway | 1 天 | 6.5 天 |
| Batch 6 | Server Domain — Conversation | 1.5 天 | 8 天 |
| Batch 7 | Server Domain — Supervision | 1.5 天 | 9.5 天 |
| Batch 8 | Server Domains — Workflow Automation | 1.5 天 | 11 天 |
| Batch 9 | Server Domains — Orchestration & Collaboration | 1.5 天 | 12.5 天 |
| Batch 10 | Server Infra — Providers | 1.5 天 | 14 天 |
| Batch 11 | Server Infra — Plugins | 1.5 天 | 15.5 天 |
| Batch 12 | Desktop Foundation — State & Data Flow | 2 天 | 17.5 天 |
| Batch 13 | Desktop UI Shell | 2 天 | 19.5 天 |
| Batch 14 | Desktop Feature Domains | 1.5 天 | 21 天 |
| Batch 15 | E2E Tests & Scripts | 0.5 天 | 21.5 天 |

**总计：约 21.5 个工作日**

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
1. **Server API Surface 过大**: `routes` 已接近 ~21k 行，不能继续作为“顺手带过”的 infra 角落
2. **Conversation 复杂度仍在上升**: `run-handler.ts` 已增长到 1628 行
3. **Providers / Plugins 仍是大型扩展基础设施**: 两者合计超过 ~23k 行，应拆成独立批次
4. **Desktop Components 已成最大块**: `components` 超过 ~43k 行，不能再与 feature/domain review 混为一体

### 中优先级
5. **Desktop Foundation 边界需厘清**: `stores / hooks / services` 三块都已超过 ~8k 行
6. **Supervision / Local-PR / Workflows 仍是稳定热点**: 这些域应保留独立审查优先级
7. **兼容层清理策略**: 1 行导出文件需要先确认调用方，再决定删除
8. **Local Reviewer 横切链路**: shared 类型、server agent 逻辑、desktop store 已形成新耦合点，应作为跨 batch 检查项

### 低优先级
8. **Gateway relay 本身结构相对稳定**: 优先关注协议边界与恢复机制，不急于拆分
9. **E2E / Scripts 仍应放在结构收敛后收尾 review**

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

---

## 已记录 Findings

### Batch 1: Shared Contract & Facade

**Findings**

1. `shared/src/protocol/correlation.ts` 的 `isEvent()` 会把合法 `Request` 误判为 `Event`，因为当前判断没有排除 request message，只排除了带 `metadata.requestId` 的响应类消息。
2. `shared/src/interaction/permissions.ts` 的 `normalizeToUnifiedPolicy()` 在 fallback 分支直接返回 `DEFAULT_UNIFIED_POLICY` 对象引用，调用方若原地修改会污染全局默认配置。
3. `shared/src/facade/stream-manager.ts` 在部分 close 路径把 stream 状态改为 `closed` 后，没有同步清空 `channelId`，会导致 facade snapshot 暴露状态不一致的数据。

**Refactor Candidates**

- `shared/src/index.ts` 当前通过大量 `export *` 暴露兼容层与 deprecated surface，公共 API 面积偏大，建议后续改成更显式的稳定导出面。
- `local-reviewer` 契约分散在 `features/local-reviewer.ts`、`interaction/permissions.ts`、`features/notification-feed.ts`、`core/server.ts`，建议后续抽统一 reviewer result/status contract。
- `shared/src/protocol/correlation.ts` 的 type guard 输入仍使用 `any`，建议后续收口到 `unknown` + 小型 shape guard。

**Test Gaps**

- 缺少 correlation type guard 的互斥性测试，尤其是 “Request 不应被识别为 Event”。
- 缺少 `normalizeToUnifiedPolicy()` 返回值不污染默认对象的测试。
- 缺少 facade stream close 场景的 snapshot 一致性测试，至少应覆盖 “closed stream 的 `channelId` 应为 null”。

### Batch 2: Gateway Relay Service

**Findings**

1. `gateway/src/server.ts` 对首个 `peer_hello` 消息没有做健壮的运行时校验；当 `gatewaySecret` 等字段类型错误时，异常会被外层 `catch` 吞掉，只返回 `gateway_error`，但连接不会关闭，而认证超时已提前清除，导致未认证连接可以长期占用一个 WebSocket 槽位。
2. `gateway/src/server.ts` 的流式 HTTP proxy 超时处理会直接 `res.end()` 结束响应，而不会向客户端返回明确错误，也不会标记为失败；一旦后端在 `http_proxy_response_start` 后长时间停顿，客户端会收到一个被静默截断的成功响应。

**Refactor Candidates**

- `handlePeerMessage(peerSessionId, message: any)` 仍使用 `any` 直接分发未校验消息，建议后续在 gateway 边界增加最小 schema 校验层。
- `gateway/src/server.ts` 当前同时承载 HTTP auth、WebSocket auth、relay、catalog、channel、stream、proxy 流程，已接近 800+ 行，适合按 handshake / relay / proxy / cleanup 拆分。

**Test Gaps**

- 缺少 malformed `peer_hello` 场景测试，尤其是“字段类型错误时连接应立即关闭，而不是仅返回错误消息”。
- 缺少 HTTP proxy 流式响应超时场景测试，尤其是“开始 streaming 后卡住”时的客户端可见行为。
- 现有 `gateway/src/__tests__/server-auth.test.ts` 仍基于旧的 `peer_hello_result` 语义，和当前 `peer_ready` / `gateway_error` 协议存在明显偏差，应统一到现行握手协议。
