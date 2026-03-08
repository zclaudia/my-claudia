# WebSocket 消息清单与 HTTP 可迁移性分析

## 一、必须保留 WebSocket 的消息

这些消息涉及流式传输、服务端主动推送或实时交互，HTTP 请求-响应模型无法满足。

### 1.1 连接生命周期

| # | 消息类型 | 方向 | 说明 |
|---|---------|------|------|
| 1 | `auth` | C→S | 客户端发送 API Key 认证 |
| 2 | `auth_result` | S→C | 认证结果（success/error, isLocalConnection） |
| 3 | `ping` | C→S | 心跳（每30秒） |
| 4 | `pong` | S→C | 心跳响应 |

### 1.2 Claude 执行（流式）

| # | 消息类型 | 方向 | 说明 |
|---|---------|------|------|
| 5 | `run_start` | C→S | 启动执行（含 sessionId, input, permissionMode） |
| 6 | `run_started` | S→C | 执行已启动（含 runId） |
| 7 | `delta` | S→C | 流式文本片段（多次推送） |
| 8 | `tool_use` | S→C | 工具调用通知（toolName, toolInput） |
| 9 | `tool_result` | S→C | 工具执行结果 |
| 10 | `permission_request` | S→C | 请求用户授权工具执行（有超时） |
| 11 | `permission_decision` | C→S | 用户授权决定（allow/deny） |
| 12 | `run_completed` | S→C | 执行完成（含 usage 信息） |
| 13 | `run_failed` | S→C | 执行失败（含 error） |
| 14 | `run_cancel` | C→S | 取消当前执行 |
| 15 | `system_info` | S→C | SDK 初始化系统信息 |
| 16 | `error` | S→C | 服务端错误推送 |

### 1.3 Gateway 协议

| # | 消息类型 | 方向 | 说明 |
|---|---------|------|------|
| 17 | `gateway_auth` | C→GW | 客户端认证 Gateway |
| 18 | `gateway_auth_result` | GW→C | Gateway 认证结果 |
| 19 | `list_backends` | C→GW | 请求后端列表 |
| 20 | `backends_list` | GW→C | 可用后端列表 |
| 21 | `connect_backend` | C→GW | 连接到指定后端 |
| 22 | `backend_auth_result` | GW→C | 后端连接结果 |
| 23 | `send_to_backend` | C→GW | 转发消息到后端 |
| 24 | `backend_message` | GW→C | 后端消息转发给客户端 |
| 25 | `backend_disconnected` | GW→C | 后端离线通知 |
| 26 | `gateway_error` | GW→C | Gateway 错误 |

---

## 二、可迁移到 HTTP 的消息

以下消息均为 CRUD 或数据查询操作，天然适合 HTTP 请求-响应模型。

### 2.1 Projects CRUD

| # | WS 消息 (C→S) | WS 响应 (S→C) | REST API 状态 | 前端发送位置 | 前端接收位置 |
|---|--------------|--------------|-------------|------------|------------|
| 1 | `get_projects` | `projects_list` | `GET /api/projects` **已有** | `useDataLoader.ts` | `useUnifiedSocket.ts:179` |
| 2 | `add_project` | `projects_created` | `POST /api/projects` **已有** | `useProjectManager.ts:14` | `useUnifiedSocket.ts:218` |
| 3 | `update_project` | `projects_updated` | `PUT /api/projects/:id` **已有** | `useProjectManager.ts:24` | `useUnifiedSocket.ts:219` |
| 4 | `delete_project` | `projects_deleted` | `DELETE /api/projects/:id` **已有** | `useProjectManager.ts:34` | `useUnifiedSocket.ts:220` |

### 2.2 Sessions CRUD

| # | WS 消息 (C→S) | WS 响应 (S→C) | REST API 状态 | 前端发送位置 | 前端接收位置 |
|---|--------------|--------------|-------------|------------|------------|
| 5 | `get_sessions` | `sessions_list` | `GET /api/sessions` **已有** | `useDataLoader.ts` | `useUnifiedSocket.ts:183` |
| 6 | `add_session` | `sessions_created` | `POST /api/sessions` **已有** | `useSessionManager.ts:14` | `useUnifiedSocket.ts:204` |
| 7 | `update_session` | `sessions_updated` | `PUT /api/sessions/:id` **已有** | `useSessionManager.ts:24` | `useUnifiedSocket.ts:205` |
| 8 | `delete_session` | `sessions_deleted` | `DELETE /api/sessions/:id` **已有** | `useSessionManager.ts:34` | `useUnifiedSocket.ts:206` |

### 2.3 Servers CRUD

| # | WS 消息 (C→S) | WS 响应 (S→C) | REST API 状态 | 前端发送位置 | 前端接收位置 |
|---|--------------|--------------|-------------|------------|------------|
| 9 | `get_servers` | `servers_list` | **缺少** | `useDataLoader.ts` | `useUnifiedSocket.ts:187` |
| 10 | `add_server` | `servers_created` | **缺少** | `useServerManager.ts:14` | `useUnifiedSocket.ts:190` |
| 11 | `update_server` | `servers_updated` | **缺少** | `useServerManager.ts:24` | `useUnifiedSocket.ts:191` |
| 12 | `delete_server` | `servers_deleted` | **缺少** | `useServerManager.ts:34` | `useUnifiedSocket.ts:192` |

### 2.4 Providers CRUD

| # | WS 消息 (C→S) | WS 响应 (S→C) | REST API 状态 | 前端发送位置 | 前端接收位置 |
|---|--------------|--------------|-------------|------------|------------|
| 13 | `get_providers` | `providers_list`（隐含） | `GET /api/providers` **已有** | `useDataLoader.ts` | 无明确处理 |
| 14 | `add_provider` | `providers_created` | `POST /api/providers` **已有** | `useProviderManager.ts:14` | `useUnifiedSocket.ts:232` |
| 15 | `update_provider` | `providers_updated` | `PUT /api/providers/:id` **已有** | `useProviderManager.ts:24` | `useUnifiedSocket.ts:233` |
| 16 | `delete_provider` | `providers_deleted` | `DELETE /api/providers/:id` **已有** | `useProviderManager.ts:34` | `useUnifiedSocket.ts:234` |

### 2.5 数据查询

| # | WS 消息 (C→S) | WS 响应 (S→C) | REST API 状态 | 前端发送位置 | 前端接收位置 |
|---|--------------|--------------|-------------|------------|------------|
| 17 | `get_session_messages` | `session_messages` | `GET /api/sessions/:id/messages` **已有** | `ChatInterface.tsx:79` | `useUnifiedSocket.ts:247` |
| 18 | `get_provider_commands` | `provider_commands` | `GET /api/providers/:id/commands` **已有** | `ChatInterface.tsx:147` | `useUnifiedSocket.ts:255` |

---

## 三、汇总

| 类别 | 数量 | 详情 |
|------|------|------|
| 必须保留 WS | 26 | 连接管理(4) + 流式执行(12) + Gateway(10) |
| 可迁移 HTTP — REST 已有 | 14 | Projects(4) + Sessions(4) + Providers(4) + 查询(2) |
| 可迁移 HTTP — 需建 REST | 4 | Servers CRUD(4) |
| **可迁移总计** | **18** | 全部为 CRUD / 数据查询 |

---

## 四、已有的 REST API 端点参考

以下端点已在服务端实现，可直接使用：

### 认证 & 服务器信息
- `GET /health` — 无需认证
- `GET /api/server/info` — 无需认证
- `POST /api/auth/verify` — authMiddleware
- `GET /api/auth/key` — localOnly（获取 API Key）
- `POST /api/auth/key/regenerate` — localOnly

### Projects
- `GET /api/projects` | `GET /api/projects/:id` | `POST /api/projects` | `PUT /api/projects/:id` | `DELETE /api/projects/:id` — 全部 authMiddleware

### Sessions
- `GET /api/sessions` | `GET /api/sessions/:id` | `POST /api/sessions` | `PUT /api/sessions/:id` | `DELETE /api/sessions/:id` — 全部 authMiddleware
- `GET /api/sessions/:id/messages` | `POST /api/sessions/:id/messages` — authMiddleware

### Providers
- `GET /api/providers` | `GET /api/providers/:id` | `POST /api/providers` | `PUT /api/providers/:id` | `DELETE /api/providers/:id` — 全部 authMiddleware
- `GET /api/providers/:id/commands` | `GET /api/providers/type/:type/commands` | `POST /api/providers/:id/set-default` — authMiddleware

### Files
- `POST /api/files/upload` | `GET /api/files/:fileId` | `GET /api/files/list` | `GET /api/files/content` — 全部 authMiddleware

### Commands
- `POST /api/commands/list` | `POST /api/commands/execute` — 全部 authMiddleware

### Gateway 配置
- `GET/PUT /api/server/gateway/config` | `GET /api/server/gateway/status` | `POST /api/server/gateway/connect` | `POST /api/server/gateway/disconnect` — 全部 localOnly

### Import
- `POST /api/import/claude-cli/scan` | `POST /api/import/claude-cli/import` — 全部 localOnly

### Servers（缺少）
- 无 REST 端点，仅通过 WebSocket 操作
