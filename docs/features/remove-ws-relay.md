# Remove WebSocket Relay — 统一 Gateway Backend 连接架构

## 背景

桌面端连接 gateway backend 时存在两条冗余的 WebSocket 路径：

1. **Relay WS**（`useMultiServerSocket`）：App → Local Server → Gateway → Backend
2. **Gateway WS**（`useGatewayConnection`）：App → Gateway → Backend

两条链路投递相同的流式事件（delta、tool_use、permission_request 等），导致 UI 重复渲染。

之前尝试用 `runOwners`/`claimRun`/`isRunOwner`（first-writer-wins per run）机制去重，但因 race condition 失败：delta 可能在 run_started 之前到达，导致合法事件被丢弃。

## 分析

### Relay 的实际作用

Relay 对消息做**零转换**——纯透传。完整链路：

```
App → DirectTransport
    → ws://localhost:3100/gateway-relay/{backendId}
      → Local Server 解析 JSON，原样转发
        → GatewayClientMode.sendToBackend(backendId, message)
          → Gateway → Backend
```

响应原路返回，同样零转换。

### 移动端验证

移动端没有 local server，没有 relay，所有 gateway backend 通信完全通过 Gateway WS 完成——已证明可行。

### 结论

Relay WS 没有存在的必要。桌面端应与移动端统一，使用 Gateway WS 连接所有 gateway backend。

## 改造后架构

### 连接拓扑

桌面端最多维持 **2 条 WebSocket**：

```
┌──────────┐
│ Gateway  │◄─── ② Gateway WS ──── Desktop App
│ Server   │                         │
└────┬─────┘                         │
     │                               │
     │                          ① Local WS
     ▼                               │
┌──────────┐                         │
│ Remote   │               ┌─────────┴──────┐
│ Backend  │               │  Local Server   │
└──────────┘               │  (port 3100)    │
                           └────────────────┘
```

- **① Local WS**：`ws://127.0.0.1:3100/ws` — 连本地 server（`useMultiServerSocket`）
- **② Gateway WS**：`ws://gateway:3200/ws` — 连 gateway，承载所有远程 backend 事件（`useGatewayConnection`）

每个 backend 只有一条路径，零重复。

### 消息流转

#### WebSocket（流式事件 + 消息发送）

```
发送（用户 → backend）:
  App
    → useMultiServerSocket.sendToServer()
      → gatewayConnection.sendToBackend(backendId, message)
        → Gateway WS → Gateway Server → Remote Backend

接收（backend → UI）:
  Remote Backend
    → Gateway Server
      → Gateway WS
        → useGatewayConnection.handleBackendMessage()
          → Zustand store → UI
```

#### HTTP / REST（session 列表、文件操作等）

```
  App
    → fetch(resolveGatewayBackendUrl(backendId) + "/api/...")
      → http://localhost:3100/api/gateway-proxy/{backendId}/api/...
        → Local Server（注入 auth header，支持 SOCKS5）
          → https://gateway:3200/api/proxy/{backendId}/api/...
            → Gateway Server → Remote Backend
```

HTTP proxy 保留不变——提供 auth header 注入和 SOCKS5 支持。移动端无 local server 时直连 gateway。

## 实施计划

### Step 1: 简化 `useMultiServerSocket` — 删除 relay 分支

**File:** `apps/desktop/src/hooks/useMultiServerSocket.ts`

| 函数 | 改动 |
|------|------|
| `connectServer` | 删除 relay DirectTransport 创建（~50 行），统一 `gatewayConnection.authenticateBackend(backendId)` |
| `sendToServer` | 删除 relay transport 检查，统一 `gatewayConnection.sendToBackend` |
| `disconnectServer` | 删除 relay transport 清理 |
| `isServerConnected` | 删除 relay transport 检查，统一 `gatewayConnection.isBackendAuthenticated` |
| imports | 删除 `resolveGatewayRelayWsUrl` |

### Step 2: 删除 `resolveGatewayRelayWsUrl`

**File:** `apps/desktop/src/services/gatewayProxy.ts`

删除函数。保留 `resolveGatewayBackendUrl` 和 `getGatewayAuthHeaders`（HTTP proxy 需要）。

### Step 3: 删除 server 端 relay WebSocket handler

**File:** `server/src/server.ts`

- 删除 `/gateway-relay/:backendId` WebSocket upgrade handler
- 删除 `relayWss` WebSocket server 及 connection handler（~100 行）
- 保留 `/api/gateway-proxy/*` HTTP proxy endpoint

### Step 4: 删除 `runOwners`/`claimRun`/`isRunOwner` 机制

Relay 删除后，每个 backend 只有一条事件路径，此去重机制不再需要。

| File | 删除内容 |
|------|---------|
| `apps/desktop/src/stores/chatStore.ts` | `runOwners` 状态、`claimRun` action、`isRunOwner` getter、`endRun` 中的清理 |
| `apps/desktop/src/hooks/useMultiServerSocket.ts` | `connectionId` 生成、6 处 `claimRun`/`isRunOwner` 调用 |
| `apps/desktop/src/hooks/useGatewayConnection.ts` | `gatewayConnectionId` ref、6 处 `claimRun`/`isRunOwner` 调用 |

### Step 5: 删除诊断日志

| File | 删除内容 |
|------|---------|
| `apps/desktop/src/hooks/useMultiServerSocket.ts` | `[MSS]` console.log |
| `apps/desktop/src/hooks/useGatewayConnection.ts` | `[GWC]` console.log |

## 验证

1. `pnpm build`（shared + server）编译通过
2. 重启 app
3. **本地模式**：发消息 → 文本和 tool calls 各出现一次
4. **Gateway 模式**：选择 gateway backend → 发消息 → 无重复
5. **REST API**：session 列表、文件操作等正常
6. 浏览器 console 无诊断日志残留
