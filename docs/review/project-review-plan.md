# MyClaudia 项目 Review & 优化计划

日期：2026-03-26
状态：Draft

## 项目规模概览

| 包 | 业务代码 | 测试代码 | 测试/业务比 |
|---|---------|---------|-----------|
| server | ~48.7k | ~53.7k | 1.10 |
| desktop | ~47.3k | ~41.7k | 0.88 |
| shared | ~4.5k | — | — |
| gateway | ~1.6k | ~3.7k | 2.34 |
| **合计** | **~102k** | **~99k** | **0.97** |

---

## 模块清单 & Review 批次

### Batch 1: Shared Types & Protocol（基石层）

**范围**: `shared/src/`（~4.5k 行）

| 子模块 | 文件 | 职责 |
|--------|------|------|
| core/ | server, provider, session, message, project, api, mcp, pcp | 核心实体类型 |
| features/ | workflows, supervision, scheduled-tasks, local-pr, agent-triggers, delegation, commands, notification-feed, system-tasks | 功能特性类型 |
| interaction/ | permissions, forms, notifications | 用户交互类型 |
| protocol/ | messages/\*, correlation, gateway | WebSocket 消息协议 & Gateway 协议 |
| plugin-types | plugin-types.ts | 插件类型定义 |
| files | files.ts | 文件浏览器类型 |

**Review 重点**:
- 类型命名一致性（是否有重复/歧义的类型）
- protocol/messages/ 的消息分类是否合理
- 核心实体（Session, Message, Project）的字段是否有冗余
- 是否有 `any` 逃逸
- shared 对外 export 是否干净（有没有不该暴露的内部类型）

**预计耗时**: 0.5 天

---

### Batch 2: Gateway（中继层）

**范围**: `gateway/src/`（~1.6k 行业务 + ~3.7k 行测试）

| 文件 | 行数 | 职责 |
|------|------|------|
| server.ts | 核心 | WebSocket 中继、Backend 注册、Client 认证、消息转发 |
| storage.ts | | SQLite 设备→Backend ID 映射 |
| state.ts | | 连接状态管理 |
| proxy-body.ts | | HTTP 代理请求体处理 |
| index.ts | | 入口 |

**Review 重点**:
- 消息转发的正确性 & 边界处理
- 认证流程的安全性
- HTTP 代理的流式传输处理
- 断连/重连的健壮性
- Docker 部署配置

**预计耗时**: 0.5 天

---

### Batch 3: Server — Core Platform（核心平台）

**范围**: ~5k 行

| 子模块 | 关键文件 | 行数 | 职责 |
|--------|---------|------|------|
| storage | db.ts, fileStore.ts | | SQLite 初始化 & 文件存储 |
| middleware | auth, logging, error, express-auth, local-only, base | | HTTP/WS 中间件 |
| ws/ | types, broadcast, message-handler, permission-handler | ~680 | WebSocket 连接管理、消息分发、广播 |
| router/ | index.ts | | Phase 2 CRUD 路由框架 |
| routes/ | sessions, projects | | REST API 端点 |
| server.ts | | ~490 | 服务器主入口、WS 连接管理 |
| index.ts | | ~425 | 进程入口、启动流程、Gateway 连接 |
| terminal-manager.ts | | | 远程 PTY 会话管理 |

**Review 重点**:
- `server.ts` 模块级状态太多（module-level mutable state），是否该收敛到 class/context
- server-setup.ts 的职责边界
- WS message-handler 的路由逻辑（Phase 2 router vs legacy handler 双路径）
- 认证流程（local vs remote）
- 数据库 schema 管理（migration 策略）

**预计耗时**: 1 天

---

### Batch 4: Server — AI Provider Layer（AI 提供者层）

**范围**: `server/src/providers/`（~6.3k 行）

| 文件 | 行数 | 职责 |
|------|------|------|
| claude-sdk.ts | 930 | Claude Code SDK 封装 |
| opencode-sdk.ts | 1666 | OpenCode SDK（最大单文件） |
| kimi-sdk.ts | 818 | Kimi SDK |
| codex-sdk.ts | 651 | Codex SDK |
| codex-app-server.ts | 728 | Codex App Server 模式 |
| cursor-sdk.ts | 426 | Cursor SDK |
| claude-adapter.ts | 382 | Claude → 统一接口适配 |
| manifests.ts | 163 | Provider 能力声明 |
| pcp-\*.ts | ~207 | Provider Capability Protocol |
| registry.ts | 46 | Provider 注册表 |
| \*-adapter.ts (其余) | ~165 | 其余 Provider 适配器 |

**Review 重点**:
- SDK 文件过大（opencode-sdk 1666 行），是否需要拆分
- 各 Provider 的适配器模式一致性
- PCP 协商流程的完整性
- 错误处理 & 重试策略
- Provider 注册/切换的生命周期

**预计耗时**: 1.5 天

---

### Batch 5: Server — Conversation Engine（对话引擎）

**范围**: ~4k 行

| 子模块 | 关键文件 | 行数 | 职责 |
|--------|---------|------|------|
| ws/run | run-handler.ts | 1477 | 对话启动（**最复杂的单文件**） |
| ws/run | run-lifecycle.ts | 250 | 对话取消、进程管理 |
| context/ | engine.ts, types.ts | | 上下文注入引擎 |
| interactions/ | interaction-normalizer, interaction-dispatcher, interaction-tools, todo-normalizer | | 用户交互处理 |
| agent-tools/ | browser, network-guard, task-tools, index | | Agent 工具注册 |
| memory/ | memory-store, activity-log | | Agent 记忆 & 活动日志 |
| agent/ | permission-evaluator, delegation-evaluator | | 权限 & 委托评估 |

**Review 重点**:
- `run-handler.ts` 1477 行——核心复杂度集中点，需重点 review 错误恢复、流处理、状态机
- interaction 处理链路的可靠性
- context engine 的扩展性
- memory store 的持久化 & 过期策略
- agent-tools 的安全边界（network-guard 的白名单机制）

**预计耗时**: 1.5 天

---

### Batch 6: Server — Supervision（监督执行系统）

**范围**: `server/src/services/supervision/` + `server/src/domains/supervision/`（~4.1k 行）

| 文件 | 行数 | 职责 |
|------|------|------|
| supervisor-service.ts | 1705 | 监督者主服务（**第二大单文件**） |
| review-engine.ts | 459 | 代码审查引擎 |
| context-manager.ts | 396 | 上下文管理 |
| checkpoint-engine.ts | 371 | 检查点 & 回滚 |
| task-runner.ts | 246 | 子任务执行器 |
| state-recovery.ts | 232 | 状态恢复 |
| worktree-pool.ts | 183 | Git worktree 池管理 |
| plan-validator.ts | 82 | 计划验证 |
| domains/supervision/ | 475 | 路由 & 注册 |

**Review 重点**:
- `supervisor-service.ts` 1705 行——是否可拆分为状态管理 + 任务调度 + 生命周期
- worktree 池的资源管理（泄漏风险）
- checkpoint/recovery 的可靠性
- review-engine 的评审准确性
- 并发任务的竞态条件

**预计耗时**: 1.5 天

---

### Batch 7: Server — Automation（自动化引擎）

**范围**: `server/src/domains/{workflows,scheduled-tasks,agent-triggers}` + `server/src/orchestration/`（~5.5k 行）

| 子模块 | 行数 | 职责 |
|--------|------|------|
| domains/workflows/ | 3202 | 工作流引擎（engine、generator、templates、renderer） |
| domains/scheduled-tasks/ | 945 | 定时任务（cron） |
| domains/agent-triggers/ | 336 | 事件驱动触发器 |
| orchestration/ | ~TBD | Claudia 元 Agent 任务编排器 |
| services/claudia-branch-service.ts | 260 | Claudia 分支管理 |

**Review 重点**:
- workflow engine 的执行模型 & 错误恢复
- workflow generator（自然语言→工作流）的可靠性
- template renderer 的安全性（注入风险）
- scheduled-tasks 的调度精度 & 容错
- orchestrator 的任务状态机完整性

**预计耗时**: 1 天

---

### Batch 8: Server — Plugin System（插件系统）

**范围**: `server/src/plugins/`（~4.8k 行）

| 文件 | 行数 | 职责 |
|------|------|------|
| loader.ts | 1394 | 插件发现、加载、生命周期（**大文件**） |
| worker-host.ts | 601 | Worker 沙箱宿主 |
| worker-runner.ts | 408 | Worker 进程运行器 |
| permissions.ts | 421 | 插件权限管理 |
| skill-tools.ts | 395 | Skill 工具注册 |
| mcp-bridge.ts | 393 | MCP 桥接 |
| provider-api.ts | 354 | 插件调 Provider API |
| tool-registry.ts | 267 | 工具注册表 |
| storage.ts | 177 | 插件持久化存储 |
| workflow-step-registry.ts | 175 | 工作流步骤注册 |
| scheduler.ts | 159 | 插件定时器 |
| skill-selector.ts | 105 | Skill 选择器 |

**Review 重点**:
- `loader.ts` 1394 行——插件生命周期管理是否可拆分
- worker 沙箱的安全隔离（权限边界）
- 插件间通信机制
- MCP bridge 的协议一致性
- skill-tools 的发现 & 注入机制

**预计耗时**: 1 天

---

### Batch 9: Server — Gateway Client + 其余（连接 & 辅助）

**范围**: ~2k 行

| 文件 | 职责 |
|------|------|
| gateway-client.ts | Gateway WebSocket 客户端 |
| gateway-client-mode.ts | 客户端模式 |
| gateway-instance.ts | 全局实例 |
| gateway-channel-cleanup.ts | Channel 清理 |
| domains/notification-feed/ | 通知动态（~252 行） |
| domains/local-pr/ | 本地 PR（~1.8k 行） |
| mcp/mcp-server.ts | MCP Server 实现 |
| events/ | 事件总线 |
| commands/ | 内置命令注册 |
| utils/ | 工具函数 |

**Review 重点**:
- Gateway Client 的重连策略 & 消息可靠性
- local-pr 的代码审查流程完整性
- MCP Server 的协议兼容性
- 事件总线的内存管理（listener 泄漏）

**预计耗时**: 1 天

---

### Batch 10: Desktop — Stores & API Layer（状态管理 & 数据层）

**范围**: `apps/desktop/src/stores/` + `apps/desktop/src/services/`（~5k 行）

| 关键 Store | 行数 | 职责 |
|-----------|------|------|
| chatStore | 668 | 对话状态（最大 store） |
| serverStore | 367 | 服务器连接状态 |
| draftEditorStore | 341 | 草稿编辑器 |
| gatewayStore | 325 | Gateway 连接状态 |
| claudiaStore | 291 | Claudia 元 Agent 状态 |
| pluginStore | 288 | 插件状态 |
| sessionsStore | 269 | Session 列表 |
| projectStore | 257 | 项目状态 |
| shortcutStore | 212 | 快捷键 |
| backgroundTaskStore | 192 | 后台任务 |
| terminalStore | 164 | 终端状态 |
| permissionStore | 151 | 权限状态 |
| 其余 stores | ~600 | UI、toast、update 等 |

**API Layer**: `services/api/*.ts` — sessions, files, projects, providers, commands, supervision, notifications 等

**Review 重点**:
- chatStore 的复杂度（668 行，消息缓存 + 流式更新 + 乐观更新）
- store 间的依赖关系（是否有循环依赖）
- API 层的错误处理统一性
- 数据同步策略（WS push vs HTTP poll 的一致性）
- 有 4 个 store 只有 1 行（localPRStore、scheduledTaskStore、supervisionStore、workflowStore）——是否是废弃代码

**预计耗时**: 1.5 天

---

### Batch 11: Desktop — Chat & Core UI（聊天核心 UI）

**范围**: `apps/desktop/src/components/chat/` + hooks（~8k+ 行）

| 文件/目录 | 行数 | 职责 |
|----------|------|------|
| components/chat/ | 7732 | 聊天界面全部组件 |
| hooks/chat/ | | useSessionActions, useCommandHandler |
| hooks/useMultiServerSocket.ts | | 多服务器 WS 连接管理 |
| hooks/useGatewayConnection.ts | | Gateway 连接 hook |
| hooks/transport/ | | GatewayTransport |
| services/messageHandler.ts | | 消息处理服务 |
| services/sessionSync.ts | | Session 同步 |

**Review 重点**:
- ChatInterface/ChatInputArea/MessageInput 的职责划分（当前有改动中）
- ToolCallItem 的渲染性能（大量工具调用时）
- 多 server 连接的状态管理复杂度
- 消息流的背压处理
- 移动端适配质量

**预计耗时**: 1.5 天

---

### Batch 12: Desktop — Features & 其余 UI

**范围**: ~10k 行

| 模块 | 行数 | 职责 |
|------|------|------|
| features/workflows/ | 3085 | 工作流编辑器（React Flow 可视化） |
| features/supervision/ | 1620 | 监督执行 UI |
| features/local-pr/ | 1367 | 本地 PR UI |
| features/automation/ | 1174 | 自动化面板 & 弹窗 |
| features/scheduled-tasks/ | 850 | 定时任务面板 |
| components/claudia/ | 1537 | Claudia 聊天 & 任务卡片 |
| components/settings/ | 1009 | 设置面板 |
| components/permission/ | 742 | 权限管理 UI |
| components/fileviewer/ | 580 | 文件浏览器 |
| components/dashboard/ | 547 | 项目仪表盘 |
| components/sidebar/ | 545 | 侧边栏 |
| components/draft/ | 499 | 草稿面板 |
| components/terminal/ | 486 | 终端面板 |
| components/notifications/ | 213 | 通知面板 |
| Sidebar.tsx, App.tsx 等顶层 | | 应用入口 & 布局 |

**Review 重点**:
- workflow 编辑器的复杂度 & UX 流畅度
- 各 feature 模块的独立性（是否可以 lazy load）
- 组件复用率（settings/permission 是否有重复模式）
- Claudia UI 的交互完整性
- 整体 bundle size & code splitting 策略

**预计耗时**: 1.5 天

---

### Batch 13: E2E Tests & Scripts

**范围**: `e2e/` + `scripts/`

**Review 重点**:
- E2E 测试覆盖的场景完整性
- 测试稳定性（flaky test 情况）
- 部署脚本的健壮性
- CI/CD 流程

**预计耗时**: 0.5 天

---

## Review 总时间表

| 批次 | 模块 | 预计耗时 | 累计 |
|------|------|---------|------|
| Batch 1 | Shared Types & Protocol | 0.5 天 | 0.5 天 |
| Batch 2 | Gateway | 0.5 天 | 1 天 |
| Batch 3 | Server — Core Platform | 1 天 | 2 天 |
| Batch 4 | Server — AI Provider | 1.5 天 | 3.5 天 |
| Batch 5 | Server — Conversation Engine | 1.5 天 | 5 天 |
| Batch 6 | Server — Supervision | 1.5 天 | 6.5 天 |
| Batch 7 | Server — Automation | 1 天 | 7.5 天 |
| Batch 8 | Server — Plugin System | 1 天 | 8.5 天 |
| Batch 9 | Server — Gateway Client & 其余 | 1 天 | 9.5 天 |
| Batch 10 | Desktop — Stores & API | 1.5 天 | 11 天 |
| Batch 11 | Desktop — Chat Core | 1.5 天 | 12.5 天 |
| Batch 12 | Desktop — Features & UI | 1.5 天 | 14 天 |
| Batch 13 | E2E & Scripts | 0.5 天 | 14.5 天 |

**总计：约 14.5 个工作日（~3 周）**

---

## Review 维度检查清单

每个 Batch Review 时统一关注以下维度：

### 代码质量
- [ ] 单一职责：文件/函数是否过大（>500 行需关注）
- [ ] 命名一致性：变量、函数、类型命名是否统一
- [ ] 错误处理：是否有未处理的 Promise rejection、空 catch
- [ ] TypeScript 严格性：any 逃逸、类型断言是否合理
- [ ] 死代码：未使用的 export、空壳文件（1 行 store）

### 架构
- [ ] 依赖方向：是否存在循环依赖
- [ ] 抽象层级：是否有跨层调用（UI 直接访问 DB 等）
- [ ] 模块内聚：domain 内代码是否自包含
- [ ] 接口设计：public API 是否最小化

### 性能
- [ ] 内存泄漏：事件监听器、定时器、Map 是否正确清理
- [ ] 渲染性能（Desktop）：不必要的重渲染、大列表虚拟化
- [ ] 数据库查询：是否有 N+1 查询、缺少索引
- [ ] WebSocket：消息频率、序列化开销

### 安全
- [ ] 认证/授权：API 端点是否全覆盖
- [ ] 输入校验：用户输入是否做了 sanitize
- [ ] 插件沙箱：Worker 隔离是否充分
- [ ] 敏感信息：日志中是否泄露 token/secret

### 可维护性
- [ ] 测试覆盖：关键路径是否有测试
- [ ] 文档：复杂逻辑是否有必要注释
- [ ] 配置管理：硬编码的 magic number
- [ ] 废弃代码：TODO/FIXME/HACK 标记的清理

---

## 已知的潜在优化点（初步观察）

### 高优先级
1. **大文件拆分**: `supervisor-service.ts`(1705行)、`run-handler.ts`(1477行)、`loader.ts`(1394行)、`opencode-sdk.ts`(1666行) 都超过 1000 行
2. **server.ts 模块级状态**: 大量 module-level `let` 变量，应收敛到 class 或 context 对象
3. **废弃 store 清理**: 4 个只有 1 行的 store 文件（localPRStore 等），疑似迁移残留
4. **双路由路径**: Phase 2 router 与 legacy message-handler 并存，应完成迁移

### 中优先级
5. **services/ 目录散落**: `workflow-service.ts`(1行)、`scheduled-task-service.ts`(1行) 等是重定向文件，应清理
6. **Provider SDK 一致性**: 各 SDK 的错误处理、重试、超时策略不统一
7. **Desktop store 整合**: chatStore(668行) 可考虑按子 domain 拆分

### 低优先级
8. **Gateway 单体**: gateway 代码量小，当前结构合理，暂不需拆分
9. **E2E 测试框架**: 从 docs 看有 Playwright 迁移进行中，需确认状态
