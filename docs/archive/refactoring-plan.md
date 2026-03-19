# 大文件拆分优化方案

## 概览

| 文件 | 行数 | 耦合度 | 优先级 | 拆分后目标行数 |
|------|------|--------|--------|----------------|
| `server/src/server.ts` | 3175 | 78 imports | P0 | ~400 |
| `shared/src/index.ts` | 2492 | 被 161 文件导入 | P0 | ~100 (纯 re-export) |
| `apps/desktop/src/services/api.ts` | 1807 | 被 49 文件导入 | P1 | ~150 (纯 re-export) |
| `apps/desktop/src/components/chat/ChatInterface.tsx` | 2543 | 39 imports | P1 | ~500 |
| `apps/desktop/src/components/SettingsPanel.tsx` | 1616 | 23 imports | P2 | ~300 |
| `apps/desktop/src/components/Sidebar.tsx` | 1571 | 26 imports | P2 | ~300 |

---

## 1. `server/src/server.ts` (3175 行 → ~400 行)

### 现状问题
- `createServer()` 占 2713 行 (85.5%)，是整个后端的"上帝函数"
- `handleRunStart()` 单独就有 1162 行
- 混合了路由注册、WebSocket 管理、中间件、业务逻辑、后台服务初始化
- 78 个 import，所有路由/服务都在此汇聚

### 拆分方案

```
server/src/
├── server.ts                    # ~400 行：createServer() 只做组装
├── middleware/
│   ├── auth.ts                  # authMiddleware (24 行)
│   ├── local-only.ts            # localOnlyMiddleware (12 行)
│   ├── logging.ts               # routerLoggingMiddleware
│   └── error-handler.ts         # 全局错误处理
├── ws/
│   ├── ws-server.ts             # WebSocket 服务器初始化 + 连接管理
│   ├── ws-client-lifecycle.ts   # 客户端连接生命周期 (141 行)
│   ├── message-router.ts        # 消息解析与路由 (82 行)
│   └── run-handler.ts           # handleRunStart 核心逻辑 (拆为多个子函数)
│       ├── context-assembler.ts # 上下文组装 (system prompt, mentions, etc.)
│       ├── provider-runner.ts   # provider 消息处理 switch (8 case, 342 行)
│       └── permission-handler.ts # 权限决策逻辑 (82 行)
├── services/
│   ├── background-services.ts   # 后台服务初始化 (148 行)
│   └── gateway-state.ts         # Gateway 状态管理 (84 行)
└── helpers/
    ├── command-normalizer.ts    # normalizeSessionWorkingDirectory 等
    └── permission-policy.ts     # 权限策略常量 + 辅助函数 (12 个函数)
```

### 执行步骤

1. **Phase 1 - 提取中间件** (低风险，不影响逻辑)
   - 将 `authMiddleware`、`localOnlyMiddleware` 移到 `middleware/`
   - server.ts 改为 `import { authMiddleware } from './middleware/auth'`

2. **Phase 2 - 提取 WebSocket 层**
   - 将 WS 连接管理、消息路由、客户端生命周期提取到 `ws/`
   - server.ts 只调用 `setupWebSocket(server, services)`

3. **Phase 3 - 拆解 handleRunStart** (最复杂)
   - 按职责拆分：上下文组装 → provider 调用 → 消息处理 → 权限决策
   - 每个 provider message case 提取为独立处理函数

4. **Phase 4 - 提取后台服务**
   - 将后台服务初始化、gateway 状态管理移到专用文件

---

## 2. `shared/src/index.ts` (2492 行 → ~100 行纯 re-export)

### 现状问题
- 183+ 类型/接口全堆在一个文件里
- 被 161 个文件导入，改一个类型全项目重编
- 没有按领域分模块，无法按需导入
- 部分类型只被 server 或 desktop 单侧使用

### 拆分方案

```
shared/src/
├── index.ts              # ~100 行：纯 export * from './xxx'
├── protocol/
│   ├── correlation.ts    # 已有
│   ├── messages.ts       # ClientMessage, ServerMessage 联合类型 + 30+ 消息接口
│   └── gateway.ts        # 所有 Gateway*Message 类型 (20+ 接口)
├── core/
│   ├── session.ts        # Session, SessionType, SessionDraft (12 项)
│   ├── project.ts        # Project, ProjectType, PermissionPolicy (5 项)
│   ├── message.ts        # Message, MessageRole, ContentBlock, ToolCall (10 项)
│   ├── provider.ts       # ProviderConfig, ProviderType, ProviderCapabilities (6 项)
│   └── server.ts         # BackendServer, ServerInfo, ServerFeature (9 项)
├── features/
│   ├── supervision.ts    # SupervisionTask, AgentType 等 (20+ 项)
│   ├── workflows.ts      # Workflow*, WorkflowRun 等 (25+ 项)
│   ├── local-pr.ts       # LocalPR, LocalPRStatus (10 项)
│   ├── scheduled-tasks.ts # ScheduledTask, ActionConfig (17 项)
│   ├── system-tasks.ts   # SystemTask* (4 项)
│   └── commands.ts       # SlashCommand, CommandType (7 项)
├── interaction/
│   ├── permissions.ts    # PermissionPolicy, AgentPermissionPolicy (7 项)
│   ├── forms.ts          # AskUserForm*, InteractionMessage (8 项)
│   └── notifications.ts  # NotificationConfig (3 项)
├── files.ts              # FileEntry, DirectoryListing (5 项)
└── plugin-types.ts       # 已有，70+ plugin 类型
```

### 执行步骤

1. **Phase 1 - 创建子模块文件**，从 index.ts 剪切类型到对应文件
2. **Phase 2 - index.ts 改为纯 re-export**：`export * from './core/session'` 等
3. **Phase 3 - 验证**：所有消费者无需改 import（因为仍从 `@my-claudia/shared` 导入）
4. **长期 - 按需导入**：消费者可从 `@my-claudia/shared/core/session` 精确导入

> **关键**：此拆分对消费者完全透明，index.ts 仍 re-export 所有内容，无需改动 161 个导入方。

---

## 3. `apps/desktop/src/services/api.ts` (1807 行 → ~150 行)

### 现状问题
- 132 个导出函数，49 个组件依赖
- 所有 API 调用（sessions、providers、workflows、supervision 等）全在一个文件
- 任何新 API 都往这里加，文件只增不减

### 拆分方案

```
apps/desktop/src/services/
├── api.ts                      # ~150 行：re-export + 共享工具 (fetchApi, getBaseUrl, AuthError)
├── api/
│   ├── base.ts                 # fetchApi, fetchLocalApi, getBaseUrl, getAuthHeaders, AuthError
│   ├── sessions.ts             # 16 函数：getSessions, createSession, ...
│   ├── session-drafts.ts       # 6 函数：getSessionDraft, upsertSessionDraft, ...
│   ├── session-search.ts       # 4 函数：searchMessages, getSearchHistory, ...
│   ├── projects.ts             # 4 函数：getProjects, createProject, ...
│   ├── providers.ts            # 10 函数：getProviders, createProvider, ...
│   ├── supervision.ts          # 21 函数：initSupervisionAgent, createSupervisionTask, ...
│   ├── workflows.ts            # 15 函数：listWorkflows, triggerWorkflow, ...
│   ├── local-prs.ts            # 13 函数：listLocalPRs, createLocalPR, ...
│   ├── scheduled-tasks.ts      # 8 函数：listScheduledTasks, createScheduledTask, ...
│   ├── mcp-servers.ts          # 6 函数：getMcpServers, createMcpServer, ...
│   ├── workspace-skills.ts     # 7 函数：getWorkspaceSkills, saveWorkspaceSkill, ...
│   ├── servers.ts              # 4 函数：getServers, createServer, ...
│   ├── gateway.ts              # 5 函数：getServerGatewayConfig, connectServerToGateway, ...
│   ├── notifications.ts        # 3 函数：getNotificationConfig, sendTestNotification, ...
│   ├── files.ts                # 2 函数：listDirectory, getFileContent
│   └── commands.ts             # 2 函数：listCommands, executeCommand
```

### 执行步骤

1. **Phase 1 - 提取 `api/base.ts`**：共享工具函数
2. **Phase 2 - 逐模块提取**，每个文件 `import { fetchApi, getBaseUrl } from './base'`
3. **Phase 3 - api.ts 改为纯 re-export**：`export * from './api/sessions'` ���
4. 消费者无需改动（仍从 `../services/api` 导入）

> **关键**：与 shared 同理，api.ts 保持全量 re-export，49 个消费者零改动。

---

## 4. `ChatInterface.tsx` (2543 行 → ~500 行)

### 现状问题
- 65+ hook 实例（17 useState + 16 useEffect + 17 useCallback + 7 useMemo + 8 useRef）
- 15 个 Zustand store 订阅
- 40+ handler 函数
- `handleCommand` 单函数 360 行，`handleBuiltInCommand` 160 行
- 10 个可提取的 JSX 大块

### 拆分方案

#### 提取自定义 Hook

```
apps/desktop/src/hooks/chat/
├── useCommandHandler.ts        # handleCommand + handleBuiltInCommand (~500 行 → 独立)
├── useMessagePagination.ts     # loadMessages, loadMoreMessages, refreshLatest (~200 行)
├── useScrollManagement.ts      # scroll handlers, metrics, refs (~150 行)
├── useSessionActions.ts        # rename, export, archive, pop-out (~140 行)
├── usePlanStatus.ts            # task plan status, submit, discard (~100 行)
├── useProviderCapabilities.ts  # provider commands & capabilities fetch (~100 行)
└── useKeyboardShortcuts.ts     # Ctrl+`, Cmd+P handlers (~50 行)
```

#### 提取子组件

```
apps/desktop/src/components/chat/
├── ChatInterface.tsx           # ~500 行：组装 + 核心状态
├── SessionHeader.tsx           # 会话头部 + 操作按钮 (~160 行)
├── PlanStatusBar.tsx           # 计划状态指示器 (~120 行)
├── MessagesSection.tsx         # 消息列表区域 (~120 行)
├── QueuedMessageBanner.tsx     # 排队消息横幅 (~30 行)
├── InterruptedBanner.tsx       # 中断恢复横幅 (~40 行)
├── PoppedOutPlaceholder.tsx    # 弹出窗口占位 (~30 行)
└── InputSection.tsx            # 底部输入区 + 工具栏 (~200 行)
```

### 执行步骤

1. **Phase 1 - 提取 `useCommandHandler`** (最大收益：减少 500 行)
2. **Phase 2 - 提取 `useScrollManagement` + `useMessagePagination`** (减少 350 行)
3. **Phase 3 - 提取 JSX 子组件** (`SessionHeader`, `InputSection`, `PlanStatusBar`)
4. **Phase 4 - 提取剩余 hooks** (`useSessionActions`, `usePlanStatus`)

---

## 5. `SettingsPanel.tsx` (1616 行 → ~300 行)

### 现状问题
- 25+ useState，4 个嵌入式子组件作为函数定义
- 11 个设置 tab，每个 tab 的 UI 逻辑都在同一文件
- `ClientAISettings` (153 行) 和 `NotificationSettingsInline` 作为内嵌函数

### 拆分方案

```
apps/desktop/src/components/settings/
├── SettingsPanel.tsx            # ~300 行：tab 路由 + 布局
├── GeneralSettings.tsx          # 外观、权限、Agent 权限 (~200 行)
├── ClientAISettings.tsx         # Agent AI 配置 (~160 行，已有内嵌版本)
├── NotificationSettings.tsx     # 通知配置 (~100 行，已有内嵌版本)
├── DebugSettings.tsx            # 日志导出、进程清理 (~100 行)
├── ConnectionsSettings.tsx      # 直连服务器管理 (~80 行)
└── ServerPicker.tsx             # 服务器选择下拉 (~90 行)
```

### 执行步骤

1. **Phase 1 - 提取内嵌组件**：将 `ClientAISettings`、`NotificationSettingsInline` 移到独立文件
2. **Phase 2 - 提取 GeneralSettings**：外观 + 权限 + Agent 权限
3. **Phase 3 - 提取 DebugSettings + ServerPicker**
4. **Phase 4 - SettingsPanel 只负责 tab 路由和布局**

---

## 6. `Sidebar.tsx` (1571 行 → ~300 行)

### 现状问题
- 25+ useState，混合了搜索、项目管理、会话列表、表单
- 搜索功能 (~200 行) 内嵌在侧边栏中
- 创建项目/会话的表单 (~100 行) 内嵌
- Worktree 分组逻辑和 UI 混在一起

### 拆分方案

```
apps/desktop/src/components/sidebar/
├── Sidebar.tsx                  # ~300 行：布局 + 组装
├── SearchPanel.tsx              # 搜索输入 + 历史 + 结果 (~200 行)
├── ProjectList.tsx              # 项目列表 + 展开/折叠 (~200 行)
├── ProjectContextMenu.tsx       # 右键菜单 (~50 行)
├── CreateProjectForm.tsx        # 新建项目表单 (~60 行)
├── CreateSessionForm.tsx        # 新建会话表单 (~60 行)
└── hooks/
    └── useSearchSidebar.ts      # 搜索状态 + debounce + 翻页 (~100 行)
```

### 执行步骤

1. **Phase 1 - 提取 `SearchPanel` + `useSearchSidebar`** (最大收益)
2. **Phase 2 - 提取 `ProjectList`**（含 worktree 分组）
3. **Phase 3 - 提取表单组件** (`CreateProjectForm`, `CreateSessionForm`)
4. **Phase 4 - 提取 `ProjectContextMenu`**

---

## 执行优先级

| 阶段 | 任务 | 文件 | 影响 | 风险 |
|------|------|------|------|------|
| **Sprint 1** | shared/index.ts 拆分 | 创建 15+ 子模块 | 消费者零改动 | 低 |
| **Sprint 1** | api.ts 拆分 | 创建 17 子模块 | 消费者零改动 | 低 |
| **Sprint 2** | server.ts 提取中间件 | 创建 4 文件 | server.ts 减少 ~100 行 | 低 |
| **Sprint 2** | ChatInterface 提取 hooks | 创建 7 hook 文件 | 减少 ~1500 行 | 中 |
| **Sprint 3** | server.ts 提取 WS 层 | 创建 4 文件 | server.ts 减少 ~1500 行 | 中 |
| **Sprint 3** | SettingsPanel/Sidebar 拆分 | 创建 13 子组件 | 减少 ~2500 行 | 低 |
| **Sprint 4** | server.ts 拆解 handleRunStart | 创建 3 文件 | server.ts 减少 ~1200 行 | 高 |

### 原则

1. **保持 barrel export**：拆分后主文件仍 re-export 全部，消费者零改动
2. **逐步推进**：每次 PR 只拆一个模块，方便 review
3. **测试先行**：每步拆分前确认现有测试通过，拆分后再跑一遍
4. **不改公共接口**：只重组文件结构，不改函数签名或类型定义
