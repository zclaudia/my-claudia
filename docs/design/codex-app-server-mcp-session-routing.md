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

### 方案 A: 每个 session 独立的 app-server 进程

- `CLAUDIA_SESSION_ID` 作为进程环境变量传给 app-server
- Bridge 子进程从父进程继承 env，自动拿到正确的 session ID
- 共享配置目录 `~/.my-claudia/codex-config/.codex/config.toml`（用户 MCP servers 只配一次）
- 优点：简单、无歧义
- 缺点：每个进程 ~17MB 内存，需要清理机制

### 方案 B: 共享进程 + resolveActiveSessionId fallback

- Bridge 不传 sessionId，server 端从 `activeRuns` 中找当前活跃的 run
- **被否决**：多个 session 同时运行时无法区分

### 方案 C: 共享进程 + pending queue 匹配

- 当 `item/started {type: mcpToolCall}` 通知到达时（路径 1），记录 `{threadId, sessionId, toolName}`
- 当 bridge HTTP 请求到达时（路径 2），从 pending queue 中按 toolName 匹配
- 优点：一个共享进程，精确匹配
- 缺点：两个 session 同时调同一个工具时有歧义（但可用 FIFO 顺序解决，因为 app-server 单线程按序发出事件）

### 方案 D: 将 sessionId 作为 MCP 工具的必填参数 ← 待深入探讨

- 在 `tools/list` 返回的工具 schema 中加 `_claudia_session_id` 参数
- 在 system prompt / 用户消息中注入 session ID
- 模型调用工具时自带 session ID → bridge 原样转发 → server 提取
- 优点：一个共享进程，无竞态，bridge 完全无状态
- 缺点：依赖模型正确传递参数
- 可降级：设为 optional，server 端有 fallback（resolveActiveSessionId）

## 配置目录方案（已确定）

不论选哪种 session 路由方案，MCP 配置目录已确定：

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

1. Session resume 在每次创建新进程时失败（`no rollout found`），需要复用进程或稳定 CODEX_HOME
2. MCP bridge 的 session ID 传递机制待确定（上述方案选择）
3. `turn/completed` 的 usage 字段可能为 undefined（token 信息在 `thread/tokenUsage/updated` 通知中）

## 下一步

1. 确定 MCP session 路由方案（A/C/D）
2. 实现所选方案
3. 验证并发 session 的 MCP 工具调用
4. 添加进程清理机制（如果选方案 A）
5. 提交并部署
