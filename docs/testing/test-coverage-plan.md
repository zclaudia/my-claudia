# 单元测试覆盖率提升计划：达到 80%

## Context

当前项目单元测试覆盖率不足，尤其是 Desktop 前端部分。目标是将整体文件级测试覆盖率从约 49%（76/154）提升到 80%（124/154），需要新增约 **48 个测试文件**。

### 当前状态

| 包 | 源文件数 | 测试文件数 | 文件覆盖率 | 测试结果 |
|---|---------|----------|----------|---------|
| Server | 59 | 42 | 71% | 933 pass / 23 fail (5 files) |
| Desktop | 90 | 32 | 36% | 609 pass / 13 fail (3 files) |
| Gateway | 3 | 2 | 67% | pass |
| Shared | 2 | 0 | 0% | - |
| **总计** | **154** | **76** | **49%** | - |

---

## Phase 0: 基础设施修复（优先级最高）

### 0A. 安装覆盖率工具
- `pnpm --filter @my-claudia/server add -D @vitest/coverage-v8@^4.0.18`
- `pnpm --filter @my-claudia/gateway add -D @vitest/coverage-v8`
- 在 server 和 gateway 的 package.json 中添加 `test:coverage` 脚本

### 0B. 修复 Server 5 个失败的测试文件（23 个失败用例）
- `server/src/routes/__tests__/sessions.test.ts` — DELETE 端点返回 500
- 其他路由测试断言不匹配
- 策略：逐个运行失败测试，修复 DB schema 缺失或断言过期问题

### 0C. 修复 Desktop 3 个失败的测试文件（13 个失败用例）
- `apps/desktop/src/components/chat/__tests__/ToolCallItem.test.tsx` — 多元素匹配
- 策略：使用 `getAllByText()` 或 `within()` 收窄查询范围

---

## Phase 1: Shared + Server 纯逻辑层（+6 测试文件，~89 tests）

### 1A. `shared/src/protocol/correlation.ts` → NEW
- 新建 `shared/vitest.config.ts` 和 `shared/package.json` test 脚本
- 测试纯函数：`isRequest`, `isResponse`, `createRequest`, `createResponse`, `createErrorResponse`
- ~25 tests

### 1B. `server/src/handlers/factory.ts` → NEW `server/src/handlers/__tests__/factory.test.ts`
- 测试 `createCrudHandlers()` 返回的 CRUD handler
- Mock Repository 接口
- ~20 tests

### 1C. `server/src/router/index.ts` → NEW `server/src/router/__tests__/index.test.ts`
- `MessageRouter` 的 register/route/crud/middleware 功能
- ~18 tests

### 1D. `server/src/middleware/logging.ts` → NEW `server/src/middleware/__tests__/logging.test.ts`
- 日志中间件的请求/响应/错误记录
- ~10 tests

### 1E. `server/src/routes/import-shared.ts` → NEW `server/src/routes/__tests__/import-shared.test.ts`
- `expandTilde()`, `checkDuplicateSession()` 纯函数
- ~10 tests

### 1F. `server/src/gateway-instance.ts` → NEW `server/src/__tests__/gateway-instance.test.ts`
- getter/setter 单例模式
- ~6 tests

---

## Phase 2: Server 服务 & 工具层（+4 测试文件，~51 tests）

### 2A. `server/src/services/notification-service.ts` → NEW
- Mock DB 和 fetch，测试通知配置 CRUD 和发送逻辑
- ~15 tests

### 2B. `server/src/utils/sdk-version-check.ts` → NEW
- Mock fs 和 fetch（npm registry），测试版本检查
- ~12 tests

### 2C. `server/src/utils/claude-config.ts` → NEW
- Mock fs/os，测试 MCP servers 和 plugins 配置解析
- ~14 tests

### 2D. `server/src/routes/notifications.ts` → NEW
- supertest 测试 REST 端点
- ~10 tests

**Phase 2 后 Server 覆盖率：52/59 = 88%**

---

## Phase 3: Desktop Stores & 工具函数（+8 测试文件，~83 tests）

### 3A. `stores/filePushStore.ts` → NEW (~12 tests)
### 3B. `stores/fileViewerStore.ts` → NEW (~12 tests)
### 3C. `utils/filterHelpers.ts` → NEW (~8 tests)
### 3D. `utils/migrateServers.ts` → NEW (~10 tests)
### 3E. `services/logger.ts` → NEW (~10 tests)
### 3F. `services/gatewayProxy.ts` → NEW (~8 tests)
### 3G. `contexts/ThemeContext.tsx` → NEW (~8 tests)
### 3H. `stores/chatStore.ts` → 检查是否已存在，如无则新建 (~15 tests)

模式：参考 `apps/desktop/src/stores/__tests__/permissionStore.test.ts` 的 Zustand 测试模式。

---

## Phase 4: Desktop Services 核心业务逻辑（+4 测试文件，~58 tests）

### 4A. `services/messageHandler.ts` (452 lines) → NEW (~25 tests)
- **最高优先级**：中央消息分发器
- 测试每个消息类型分支：run_start, run_end, message, tool_use, tool_result, permission_request, session_list 等
- Mock 所有 store

### 4B. `services/sessionSync.ts` (381 lines) → NEW (~15 tests)
- 测试增量/全量同步、消息间隙填充、并发防护
- Mock api 和 stores，使用 `vi.useFakeTimers()`

### 4C. `services/fileUpload.ts` (176 lines) → NEW (~8 tests)
### 4D. `services/fileDownload.ts` (194 lines) → NEW (~10 tests)

---

## Phase 5: Desktop UI 组件 — 关键交互（+12 测试文件，~73 tests）

**策略**：只测试关键交互行为，不追求完整渲染。Mock 所有 store 依赖。

### 5A. `components/SearchFilters.tsx` → NEW (~8 tests)
### 5B. `components/chat/InlineAskUserQuestion.tsx` → NEW (~8 tests)
### 5C. `components/chat/FilePushNotification.tsx` → NEW (~8 tests)
### 5D. `components/chat/CodeViewer.tsx` → NEW (~6 tests)
### 5E. `components/chat/TokenUsageDisplay.tsx` → NEW (~4 tests)
### 5F. `components/chat/FontSizeSelector.tsx` → NEW (~4 tests)
### 5G. `components/chat/WorktreeSelector.tsx` → NEW (~8 tests)
### 5H. `components/agent/AgentPanel.tsx` → NEW (~8 tests)
### 5I. `components/agent/AgentSidePanel.tsx` → NEW (~4 tests)
### 5J. `components/chat/ModeSelector.tsx` → NEW (~5 tests)
### 5K. `components/chat/ModelSelector.tsx` → NEW (~5 tests)
### 5L. `components/ThemeToggle.tsx` → NEW (~5 tests)

---

## Phase 6: 中等规模文件补充（+10 测试文件，~57 tests）

### 6A. `components/fileviewer/FileViewerPanel.tsx` → NEW (~6 tests)
### 6B. `components/fileviewer/FileSearchInput.tsx` → NEW (~5 tests)
### 6C. `components/BottomPanel.tsx` → NEW (~5 tests)
### 6D. `components/permission/PermissionDetailView.tsx` → NEW (~6 tests)
### 6E. `components/chat/InlinePermissionRequest.tsx` → NEW (~6 tests)
### 6F. `components/chat/SystemInfoPanel.tsx` → NEW (~5 tests)
### 6G. `components/chat/SystemInfoButton.tsx` → NEW (~4 tests)
### 6H. `server/src/providers/opencode-sdk.ts` → PARTIAL (~12 tests)
- 只测试可提取的纯函数：`prepareOpenCodeInput()` 等
### 6I. `gateway/src/storage.ts` → NEW (~8 tests)

---

## Phase 7: 大型 UI 组件选测（+7 测试文件，~46 tests）

**策略**：不做完整渲染测试，聚焦关键交互路径。

### 7A. `components/Sidebar.tsx` (1574 lines) → NEW (~8 tests)
### 7B. `components/SettingsPanel.tsx` (1446 lines) → NEW (~8 tests)
### 7C. `components/ImportDialog.tsx` (574 lines) → NEW (~8 tests)
### 7D. `components/ImportOpenCodeDialog.tsx` (553 lines) → NEW (~6 tests)
### 7E. `components/ServerGatewayConfig.tsx` (476 lines) → NEW (~6 tests)
### 7F. `components/ServerSelector.tsx` (294 lines) → NEW (~5 tests)
### 7G. `components/ProjectSettings.tsx` (292 lines) → NEW (~5 tests)

---

## 跳过的文件（E2E 覆盖或不可测试）

| 文件 | 原因 |
|------|------|
| `server/src/server.ts` (2083 lines) | WebSocket 编排，由 E2E 覆盖 |
| `server/src/index.ts` (388 lines) | 入口文件，进程生命周期 |
| `server/src/gateway-client-mode.ts` (429 lines) | WebSocket 客户端，集成测试领域 |
| `server/src/verification/phase*.ts` | 一次性验证脚本 |
| `server/src/providers/*-adapter.ts` (23-26 lines) | 薄代理层，无逻辑 |
| `server/src/providers/types.ts` | 纯类型文件 |
| `desktop/src/App.tsx` | 根组件，E2E 覆盖 |
| `desktop/src/components/chat/ChatInterface.tsx` (1364 lines) | 超大组件，E2E 主覆盖 |
| `desktop/src/hooks/useMultiServerSocket.ts` | WebSocket 生命周期 |
| `desktop/src/hooks/useGatewayConnection.ts` | WebSocket 生命周期 |
| `desktop/src/hooks/useEmbeddedServer.ts` | Tauri 特定，jsdom 不可测 |
| `desktop/src/components/terminal/*.tsx` | 依赖 xterm.js DOM |
| `desktop/src/components/MobileSetup.tsx` | Tauri 特定组件 |

---

## 预期覆盖率

| 包 | 当前 | 目标 | 覆盖率 |
|---|------|------|--------|
| Server | 42/59 | 52/59 | 88% |
| Desktop | 32/90 | 68/90 | 76% |
| Gateway | 2/3 | 3/3 | 100% |
| Shared | 0/2 | 1/2 | 50% |
| **总计** | **76/154** | **124/154** | **80.5%** |

---

## 测试模式参考

- **Zustand Store**: 参考 `apps/desktop/src/stores/__tests__/permissionStore.test.ts`
- **Express Route**: 参考 `server/src/routes/__tests__/sessions.test.ts`（supertest + 内存 SQLite）
- **React Component**: 参考 `apps/desktop/src/components/chat/__tests__/ToolCallItem.test.tsx`（@testing-library/react）
- **Transport Hook**: 参考 `apps/desktop/src/hooks/transport/__tests__/BaseTransport.test.ts`

---

## 验证方式

```bash
# 修复后运行全部单元测试
eval "$(fnm env)" && pnpm test

# 查看覆盖率报告
pnpm --filter @my-claudia/server run test:coverage
pnpm --filter @my-claudia/desktop run test:coverage

# E2E 测试确认无回归
pnpm test:e2e:playwright
```
