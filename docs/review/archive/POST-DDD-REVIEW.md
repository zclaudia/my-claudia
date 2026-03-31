# MyClaudia Post-DDD 代码质量 Review

日期：2026-03-28
范围：DDD 重构后全项目（server domains + infra + desktop）

---

## 总览

| 指标 | 值 |
|------|-----|
| Server domain 文件 | 81 |
| Server infra 文件 | 112 |
| Desktop 文件 | 384 |
| 大文件 (>500 行) | 24 |
| `any` 残留 (server) | ~118 (domain 10 + infra 108) |
| `any` 残留 (desktop 生产代码) | 6 |
| 循环依赖 | 0 |

---

## A. Domain 边界评估

### 跨域依赖（仅 9 处，均可接受）

| 源 domain | 目标 domain | 引用 | 性质 |
|-----------|------------|------|------|
| conversation → gateway | `getGatewayClient` | 运行时 |
| conversation → notification-feed | `NotificationFeedService` (type) × 3 | 类型 |
| conversation → orchestration | `ClaudiaBranchService` + types × 2 | 运行时+类型 |
| agent-triggers → orchestration | types × 2 | 类型 |
| agent-triggers → notification-feed | type × 1 | 类型 |

**评估**: 7/9 domain 零跨域耦合。conversation 是核心交汇点，3 个跨域引用是业务必然。agent-triggers 已 @deprecated。**边界评分: A-**

### 共享基础设施模式

所有 domain 统一通过以下方式接入基础设施（无反向依赖）：
- `conversation/ws/broadcast.js` — 消息广播（4 个 domain 使用）
- `repositories/*` — 数据访问（6 个 domain 使用）
- `events/index.js` — 事件总线（3 个 domain 使用）
- `server.js` → `createVirtualClient`/`handleRunStart` — 虚拟客户端（3 个 domain 使用）

---

## B. 发现汇总

### 按严重程度

| 严重程度 | Server Domains | Server Infra | Desktop | 总计 |
|---------|---------------|-------------|---------|------|
| CRITICAL | 0 | 0 | 1 | **1** |
| HIGH | 0 | 3 | 2 | **5** |
| MEDIUM | 3 | 8 | 8 | **19** |
| LOW | 2 | 15 | 6 | **23** |

### CRITICAL (1)

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| 1 | **Desktop 无 ErrorBoundary** | apps/desktop 全局 | 单个组件报错崩溃整个 app |

### HIGH (5)

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| 1 | Worker RPC 静默失败 | plugins/worker-runner.ts:113-241 | 13 处 `.catch(() => {})` 吞掉通信错误 |
| 2 | OpenCode 日志写入静默失败 | providers/opencode-sdk.ts:77-79 | 诊断工具自身故障不报告 |
| 3 | Worker 状态类型不安全 | plugins/worker-host.ts:94-97 | listener Map 无类型保障 |
| 4 | Desktop 无 Code Splitting | App.tsx | 0 个 React.lazy，所有 feature 同步加载 |
| 5 | Desktop Sidebar 过大 | Sidebar.tsx (1580 行) | 导航组件承担过多职责 |

### MEDIUM 精选 (Top 10)

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| 1 | Plugin event 错误被吞 | run-handler.ts:858,1115,1157,1297,1339 | 5 处 `.catch(() => {})` |
| 2 | session metadata JSON 解析错误被吞 | routes/sessions.ts:703 | 数据损坏不报告 |
| 3 | OpenCode sessionServerMap 无限增长 | opencode-sdk.ts:272 | 无 TTL 驱逐 |
| 4 | Debug 日志写入 /tmp | opencode-sdk.ts:75-81 | 敏感数据明文写磁盘 |
| 5 | 3 个路由 redirect 未清理 | routes/workflows, supervision, scheduled-tasks | 1 行 re-export |
| 6 | Desktop 4 个空壳 store | localPRStore 等 | 1 行 re-export |
| 7 | Desktop messageHandler 3 处 `any` | messageHandler.ts:552,1013,1035 | 可修复 |
| 8 | Desktop 多组件缺失 loading/error 状态 | FileViewerPanel, WorkflowEditor, ImportDialog | 用户无反馈 |
| 9 | loader.ts plugin context 返回 `any` | plugins/loader.ts:968+ | 6 处可修复 |
| 10 | codex-app-server `[key: string]: any` | codex-app-server.ts:64 | 应改为 `Record<string, unknown>` |

---

## C. 大文件清单（>500 行）

### Server（16 个）

| 文件 | 行数 | 所在层 | 拆分建议 |
|------|------|--------|---------|
| supervisor-service.ts | 1705 | domain | TaskScheduler + TaskLifecycle + ResourceManager |
| opencode-sdk.ts | 1666 | infra | ServerManager + EventMapper + SSEClient |
| run-handler.ts | 1528 | domain | StreamProcessor + PermissionBridge + EventEmitter |
| loader.ts | 1394 | infra | Discovery + Activation + ContextFactory |
| db.ts | 1343 | infra | Migrations 拆为独立文件 |
| codex-app-server.ts | 1257 | infra | Spawn + Protocol + MessageParser |
| permission-evaluator.ts | 1217 | domain | PolicyNormalizer + PolicyEvaluator + MemoryStore |
| local-pr/service.ts | 1165 | domain | PRLifecycle + ReviewRunner + ConflictResolver |
| workflows/engine.ts | 1099 | domain | 可接受（handler 模式清晰） |
| gateway-client.ts | 1041 | domain | PeerProtocol + CatalogManager + ChannelManager |
| claude-sdk.ts | 919 | infra | 可接受 |
| kimi-sdk.ts | 842 | infra | 可接受 |
| sessions.ts (route) | 746 | infra | 可接受 |
| files.ts (route) | 705 | infra | 可接受 |
| server-setup.ts | 668 | top | 可接受（Composition Root） |
| worker-host.ts | 645 | infra | 可接受 |

### Desktop（8 个）

| 文件 | 行数 | 拆分建议 |
|------|------|---------|
| Sidebar.tsx | 1580 | SessionItem + WorktreeGroup + ProjectSection 拆出 |
| messageHandler.ts | 1111 | 可接受（service 文件） |
| App.tsx | 987 | 用 React.lazy 拆出 popout windows |
| MessageInput.tsx | 985 | FileHandler + MentionSystem 拆出 |
| ToolCallItem.tsx | 966 | 按 tool type 拆子组件 |
| MessageList.tsx | 925 | MarkdownRenderer 拆出 |
| AutomationWindow.tsx | 923 | WindowManager 拆出 |
| SettingsPanel.tsx | 908 | 各 tab 用 lazy 加载 |

---

## D. `any` 分布

### Server domains（10 个，均有正当理由或已注释）

| 来源 | 数量 | 说明 |
|------|------|------|
| better-sqlite3 variadic | 5 | SDK 限制，无法修复 |
| handleRunStart message 签名 | 3 | 需跨模块重构 |
| supervisor virtualClients | 1 | 可修复 |
| handleRunStart as any | 1 | 协变问题 |

### Server infra（~108 个）

| 来源 | 数量 | 说明 |
|------|------|------|
| Test 文件 | ~80 | mock 用途，可接受 |
| Provider SDKs | ~12 | 事件处理、JSON 解析 |
| Plugin loader/worker | ~14 | context 工厂、消息类型 |
| Routes | ~2 | JSON.parse 结果 |

### Desktop 生产代码（6 个）

- messageHandler.ts: 3 个（可修复）
- GatewayTransport.ts: 1 个（justified）
- ServerGatewayConfig.tsx: 1 个（justified）
- CreateScheduledTaskDialog.tsx: 1 个（justified）

---

## E. 内存泄漏风险

| 位置 | 风险 | 状态 |
|------|------|------|
| Domain Map/Set 集合 | 低 | ✅ 所有 domain 有 stop()/cleanup() |
| Domain timers | 低 | ✅ 所有 interval 有 clear |
| opencode sessionServerMap | 中 | ⚠️ 无 TTL，长期运行增长 |
| Plugin worker listeners | 中 | ⚠️ 崩溃时清理依赖 exit handler |
| Event bus regex cache | 低 | ⚠️ 无驱逐但增长有限 |
| Desktop useEffect cleanup | 低 | ✅ 95% 有正确 cleanup |

---

## F. 安全

| 维度 | 状态 |
|------|------|
| SQL 注入 | ✅ 全部参数化查询 |
| JWT 认证 | ✅ 完整 |
| 插件沙箱 | ✅ worker_threads + 资源限制 |
| Provider API supervision | ✅ 已修复（plan mode + deny） |
| 敏感信息日志 | ⚠️ OpenCode debug 写入 /tmp 明文 |
| 输入校验 | ⚠️ 部分 route 缺少 foreign key 预检 |

---

## G. 对比上次 Review

| 维度 | 上次（DDD 前） | 本次（DDD 后） | 变化 |
|------|---------------|---------------|------|
| Domain 边界 | 🔴 C | ✅ A- | +3 级 |
| `any` (domains) | ~130 | 10 | -92% |
| 循环依赖 | 0 | 0 | 持平 |
| 跨域耦合 | 未追踪 | 9 处 | 首次量化 |
| 测试通过率 | 114/123 (93%) | 123/123 (100%) | +9 文件修复 |
| index.ts 行数 | 511 | 195 | -62% |
| God File 数 | 3 | 1 (server-setup) | -66% |
| CRITICAL 问题 | 0 | 1 (ErrorBoundary) | 新发现 |
| HIGH 问题 | ~30 | 5 | -83% |

---

## H. GA 前建议修复优先级

### 必须做（CRITICAL + HIGH）

| # | 问题 | 工作量 | 影响 |
|---|------|--------|------|
| 1 | Desktop 添加 ErrorBoundary | 1h | 防止单组件崩溃整个 app |
| 2 | Worker RPC 错误添加日志 | 30min | 可观测性 |
| 3 | Plugin event .catch 添加日志 | 15min | 可观测性 |
| 4 | Desktop 实现 React.lazy | 2h | 减少首屏加载 |

### 建议做（MEDIUM 精选）

| # | 问题 | 工作量 |
|---|------|--------|
| 5 | 删除 3 个路由 redirect | 15min |
| 6 | 删除 4 个空壳 store | 15min |
| 7 | messageHandler 3 处 `any` 修复 | 30min |
| 8 | OpenCode debug 日志改用安全路径 | 30min |

### GA 后做

| # | 问题 | 工作量 |
|---|------|--------|
| 9 | Sidebar.tsx 拆分 (1580 行) | 4h |
| 10 | supervisor-service.ts 拆分 (1705 行) | 1d |
| 11 | run-handler.ts 拆分 (1528 行) | 1d |
| 12 | sessionServerMap TTL 驱逐 | 1h |
