# Codex App Server: MCP Session Routing 设计讨论

## 背景

我们将 Codex provider 从 exec 协议（`@openai/codex-sdk`）切换到 App Server 协议（`codex app-server`），以获得真正的流式文本输出（`item/agentMessage/delta`）。

切换后面临的核心问题：**MCP bridge 的 session 路由**。

## 问题描述

### 两条独立的通信路径

```
路径 1: run-handler（WebSocket，知道 sessionId）
──────────────────────────────────────────────
前端 ──WS──→ run-handler ──→ CodexAppServerAdapter.run()
                                  │
                                  ├─ stdin → codex app-server 进程
                                  └─ stdout ← JSON-RPC 通知
                                       │
                                       ├─ item/agentMessage/delta → yield { type: 'assistant' }
                                       ├─ item/started {mcpToolCall} → yield { type: 'tool_use' }
                                       └─ turn/completed → yield { type: 'result' }
                                  │
                              run-handler 知道 sessionId → sendRunEvent → WS → 前端


路径 2: MCP bridge（HTTP，不知道 sessionId）
──────────────────────────────────────────────
codex app-server 进程
  └─ 模型决定调 MCP 工具
      └─ 调用 MCP bridge 子进程（stdio MCP 协议）
          └─ bridge 收到 tools/call
              └─ HTTP POST http://127.0.0.1:3100/api/plugins/tools/xxx/execute
                  └─ plugin-tools.ts 需要 sessionId 来路由交互事件到前端
```

**路径 1 知道 sessionId，路径 2 不知道。两条路径之间没有共享上下文。**

### 为什么需要 sessionId

MCP bridge 调用交互工具（如 `ask_user_form`、`update_todo_list`、`request_approval`）时，server 需要通过 WebSocket 把 UI 事件发送到正确的前端窗口。`interactionDispatcher.dispatchAndWait(interactionId, sessionId, event)` 用 `sessionId` 决定发给哪个客户端连接。

### 为什么不能用文件/全局状态传递 sessionId

多个 Codex session 可以同时运行。如果用文件或全局变量存储 "当前 session ID"，并发时会互相覆盖。

## 已探讨的方案

### 方案 B: 共享进程 + resolveActiveSessionId fallback

- Bridge 不传 sessionId，server 端从 `activeRuns` 中找当前活跃的 run
- **被否决**：多个 session 同时运行时无法区分

### 方案 C: 共享进程 + pending queue 匹配

- 当 `item/started {type: mcpToolCall}` 通知到达时（路径 1），记录 `{threadId, sessionId, toolName}`
- 当 bridge HTTP 请求到达时（路径 2），从 pending queue 中按 toolName 匹配
- **被否决**：两个 session 同时调同一个工具时有歧义，过度复杂

### 方案 D: 将 sessionId 作为 MCP 工具的必填参数

- 在 `tools/list` 返回的工具 schema 中加 `_claudia_session_id` 参数
- 模型调用工具时自带 session ID → bridge 原样转发 → server 提取
- **被否决**：依赖模型正确传递参数，不可靠

### 方案 A: 每个 session 独立的 app-server 进程 ← 选定方案

- `CLAUDIA_SESSION_ID` 作为进程环境变量传给 app-server
- Bridge 子进程从父进程继承 env，自动拿到正确的 session ID
- 共享配置目录 `~/.my-claudia/codex-config/.codex/config.toml`（用户 MCP servers 只配一次）
- 优点：简单、无歧义、进程级隔离
- 缺点：每个进程 ~17MB 内存，需要清理机制

## 方案 A 详细设计

### 核心原理

```
Session X 创建:
  spawn codex app-server 进程 (env: CLAUDIA_SESSION_ID=session-x)
    └─ 模型调 MCP 工具
        └─ spawn bridge 子进程（继承父进程 env）
            └─ bridge 读 process.env.CLAUDIA_SESSION_ID → "session-x" ✓

Session Y 创建:
  spawn codex app-server 进程 (env: CLAUDIA_SESSION_ID=session-y)
    └─ bridge 子进程自动拿到 "session-y" ✓

两个 session 完全隔离，无竞态。
```

### 进程生命周期

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  session 创建  │────→│  spawn 进程   │────→│  多轮 turn    │
│  (首次 run)   │     │  + initialize │     │  复用进程     │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                │
                              ┌─────────────────┼─────────────────┐
                              │                 │                 │
                        ┌─────▼─────┐   ┌──────▼──────┐   ┌─────▼─────┐
                        │ 空闲超时   │   │ session 删除 │   │ server 退出│
                        │ (30 min)  │   │ (用户操作)   │   │ (SIGTERM)  │
                        └─────┬─────┘   └──────┬──────┘   └─────┬─────┘
                              │                │                 │
                              └────────────────┼─────────────────┘
                                               │
                                        ┌──────▼──────┐
                                        │ client.destroy() │
                                        │ SIGTERM → 进程退出 │
                                        │ 从 cache 移除    │
                                        └─────────────┘
```

### 改动清单

#### 1. `codex-app-server.ts` — 进程管理改为 per-session

**Cache key 变更**：

```typescript
// 现在: cliPath + env signature（所有 session 共享一个进程）
function getCacheKey(options, env) {
  return `${options.cliPath}::${envSignature}`;
}

// 改为: 加入 claudiaSessionId（每个 session 独立进程）
function getCacheKey(options, env) {
  return `${options.cliPath}::${options.claudiaSessionId || 'default'}::${envSignature}`;
}
```

**Env 注入**：

```typescript
function buildEnv(options: CodexAppServerOptions): Record<string, string> {
  const mergedEnv = { ...process.env };
  sanitizeInheritedProviderEnv(mergedEnv);
  Object.assign(mergedEnv, options.env);
  // 方案 A: 直接注入 session ID 到进程 env
  if (options.claudiaSessionId) {
    mergedEnv.CLAUDIA_SESSION_ID = options.claudiaSessionId;
  }
  return mergedEnv;
}
```

**MCP bridge 配置变更**：

```typescript
// 现在: 用 sessionIdFile（文件传递，有竞态）
const bridgeEntry = buildMcpBridgeEntry(
  options.serverPort,
  undefined,              // no static session ID
  getSessionIdFilePath(), // bridge reads from file
);

// 改为: 不传 sessionId 给 bridge 配置
// bridge 从父进程继承的 CLAUDIA_SESSION_ID env 获取
const bridgeEntry = buildMcpBridgeEntry(options.serverPort);
```

**空闲清理**：

```typescript
class CodexAppServerClient {
  lastActivity: number = Date.now();

  async *runTurn(...) {
    this.lastActivity = Date.now();
    // ... existing logic ...
  }
}

// 模块级清理定时器
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // scan every 5 minutes

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, client] of appServerClients) {
    if (now - client.lastActivity > IDLE_TIMEOUT_MS) {
      debugLog(`[Codex AppServer] Idle cleanup: ${key}`);
      client.destroy();
      appServerClients.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref(); // 不阻止 Node.js 退出
```

**Server 退出清理**：

```typescript
export function destroyAllAppServerClients(): void {
  for (const [key, client] of appServerClients) {
    client.destroy();
  }
  appServerClients.clear();
  clearInterval(cleanupTimer);
}

// 在 server.ts 的 gracefulShutdown() 中调用
```

#### 2. `mcp-bridge-launch.ts` — 简化，移除 sessionIdFile

```typescript
// 现在: 支持 sessionId 和 sessionIdFile 两种模式
export function buildMcpBridgeEntry(
  serverPort: number,
  sessionId?: string,
  sessionIdFile?: string,
): McpBridgeServerEntry | null {
  const env = { CLAUDIA_BRIDGE_URL: `http://127.0.0.1:${serverPort}` };
  if (sessionIdFile) {
    env.CLAUDIA_SESSION_ID_FILE = sessionIdFile;
  } else {
    env.CLAUDIA_SESSION_ID = sessionId || '';
  }
  return { command, args, env };
}

// 改为: 只需 serverPort，session ID 由父进程 env 传递
export function buildMcpBridgeEntry(
  serverPort: number,
): McpBridgeServerEntry | null {
  const env = { CLAUDIA_BRIDGE_URL: `http://127.0.0.1:${serverPort}` };
  // CLAUDIA_SESSION_ID 不在 bridge 配置中设置
  // bridge 子进程会从 codex app-server 父进程继承 CLAUDIA_SESSION_ID env
  return { command, args, env };
}
```

#### 3. `mcp-bridge.ts` — 简化 getSessionId()

```typescript
// 现在: 支持 SESSION_ID_FILE fallback
const STATIC_SESSION_ID = process.env.CLAUDIA_SESSION_ID || '';
const SESSION_ID_FILE = process.env.CLAUDIA_SESSION_ID_FILE || '';

function getSessionId(): string {
  if (SESSION_ID_FILE) {
    try { return readFileSync(SESSION_ID_FILE, 'utf-8').trim(); }
    catch { return STATIC_SESSION_ID; }
  }
  return STATIC_SESSION_ID;
}

// 改为: 只读 env（从父进程继承）
function getSessionId(): string {
  return process.env.CLAUDIA_SESSION_ID || '';
}
```

#### 4. `codex-app-server.ts` — 删除 session ID 文件相关代码

删除以下函数和引用：
- `getSessionIdFilePath()`
- `updateSessionIdFile()`
- `runCodexAppServer()` 中的 `updateSessionIdFile()` 调用

#### 5. `server.ts` — 注册退出清理

```typescript
import { destroyAllAppServerClients } from './providers/codex-app-server.js';

async function gracefulShutdown() {
  // ... existing cleanup ...
  destroyAllAppServerClients();
}
```

### MCP 配置共享

所有 per-session 进程共享同一个 MCP 配置目录，但各自有独立的 `CLAUDIA_SESSION_ID` env：

```
~/.my-claudia/codex-config/
└── .codex/config.toml          ← 所有进程共享此配置
                                   config.toml 中的 claudia-plugins bridge
                                   不再包含 CLAUDIA_SESSION_ID env
                                   （由父进程 env 传递）
```

`config.toml` 中 bridge 条目变为：

```toml
[mcp_servers.claudia-plugins]
command = "/path/to/node"
args = ["/path/to/mcp-bridge.js"]

[mcp_servers.claudia-plugins.env]
CLAUDIA_BRIDGE_URL = "http://127.0.0.1:3100"
# CLAUDIA_SESSION_ID 不在这里 — 由 codex app-server 进程 env 传递给 bridge 子进程
```

**关键点**：Codex app-server spawn bridge 子进程时，子进程继承父进程的全部 env。`config.toml` 中的 `env` 字段是 **追加**而非覆盖，所以父进程的 `CLAUDIA_SESSION_ID` 会自动传递到 bridge。

### Session Resume 的影响

方案 A 下每个 session 有独立进程，thread/resume 可以正常工作：
- 进程存活期间：resume 直接复用同一进程的 thread，rollout 文件仍在
- 进程被清理后：需要创建新进程 + 新 thread（resume 会失败，fallback 到 startThread）

现有代码已有这个 fallback 逻辑（`codex-app-server.ts:747-754`）：

```typescript
if (options.sessionId) {
  try {
    await client.resumeThread(options.sessionId);
    threadId = options.sessionId;
  } catch (err) {
    // Resume failed, start fresh
    threadId = await client.startThread(options.cwd);
  }
}
```

### 内存与资源预估

| 并发 session 数 | 进程数 | 内存占用 | 备注 |
|---------------|-------|---------|------|
| 1 | 1 | ~17MB | 最常见场景 |
| 3 | 3 | ~51MB | 多 session 并发 |
| 5 | 5 | ~85MB | 极端场景 |

- 空闲进程只占内存不占 CPU
- 30 分钟超时覆盖"用户离开但没关 session"
- 进程被清理后下次 run 自动 spawn 新进程，对用户透明

### 不需要改动的部分

- `codex-app-server-adapter.ts` — 无变化，已正确传递 `claudiaSessionId`
- `mcp-bridge.ts` 的 HTTP 通信逻辑 — 无变化，只简化 `getSessionId()`
- `config.toml` 的生成逻辑 — 只是不再传 `sessionIdFile` 参数
- 前端代码 — 无感知

## 配置目录方案（已确定）

```
~/.my-claudia/codex-config/          ← 稳定目录
└── .codex/config.toml                ← MCP server 配置
```

- 所有 Codex session 共享这份 MCP 配置
- 用户添加/修改 MCP server 后，修改此文件即可
- 不覆盖 `CODEX_HOME`（保留用户多登录支持）
- 不污染项目目录
- App-server 进程的 `cwd` 设为此目录，Codex 自动加载项目级 `.codex/config.toml`
- Auth 从全局 `CODEX_HOME`（默认 `~/.codex/`）加载

### 关键约束

- `-c` 参数传 JSON 值会导致 app-server hang（已验证）
- `CODEX_HOME` 不能覆盖（用户可能通过调整 `CODEX_HOME` 支持多 Codex 登录）
- 项目目录 `.codex/config.toml` 不能写入（尤其 cwd 是 `$HOME` 时会污染全局配置）

## 当前代码状态

- `server/src/providers/codex-app-server.ts` — App Server JSON-RPC 客户端已实现，流式 delta 工作正常
- `server/src/providers/codex-app-server-adapter.ts` — ProviderAdapter 包装已实现
- `server/src/providers/registry.ts` — 已切换到 CodexAppServerAdapter
- `server/scripts/test-codex-app-server.ts` — 测试脚本验证了流式事件（137 个 delta，EXACT MATCH）
- `server/scripts/test-codex-events.ts` — exec vs app-server 对比测试脚本

### 已知问题

1. Session resume 在进程清理后失败（`no rollout found`），已有 fallback 逻辑处理
2. `turn/completed` 的 usage 字段可能为 undefined（token 信息在 `thread/tokenUsage/updated` 通知中）

## 实施步骤

1. **`codex-app-server.ts`**：cache key 加入 `claudiaSessionId`，`buildEnv()` 注入 `CLAUDIA_SESSION_ID`
2. **`codex-app-server.ts`**：加 `lastActivity` 字段 + 30 分钟空闲清理定时器 + `destroyAllAppServerClients()`
3. **`codex-app-server.ts`**：删除 `getSessionIdFilePath()`、`updateSessionIdFile()` 及相关调用
4. **`mcp-bridge-launch.ts`**：简化 `buildMcpBridgeEntry()`，移除 `sessionId`/`sessionIdFile` 参数
5. **`mcp-bridge.ts`**：简化 `getSessionId()`，移除 `SESSION_ID_FILE` 逻辑
6. **`server.ts`**：在 `gracefulShutdown()` 中调用 `destroyAllAppServerClients()`
7. **测试**：验证并发 session 的 MCP 工具调用正确路由
8. **测试**：验证空闲清理后重新 spawn 进程正常工作
