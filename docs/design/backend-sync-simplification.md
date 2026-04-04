# Backend 同步机制简化方案

## 现状分析

### Backend List 同步链路

```
Backend (server)
  │  注册 BackendPresence (backendId, name, epoch, capabilities...)
  ▼
Gateway
  │  维护 Registry: Map<backendId, BackendPresence>
  │  每次变更 revision++
  ▼
  │  同步方式:
  │  ├── snapshot: 全量 (revision + items[])
  │  ├── delta:    增量 (fromRevision → toRevision + events[])
  │  └── event:    单条 (revision + upsert/remove)
  ▼
GatewayClient (server 端) / GatewayTransport (client 端)
  │  registryItems: Map<backendId, BackendPresence>
  ▼
FacadeRegistryStore → assembleSnapshot()
  │  BackendPresence → BackendRuntimeRecord → BackendSnapshot
  ▼
facadeStore.backends: BackendSnapshot[]
  │
  ├── recoveryStore.applySnapshot()    (桌面端: per-backend 状态跟踪)
  └── mobileRecoveryStore              (移动端: 粗粒度 phase)
```

### Channel 机制

当前客户端要和 backend 交互，必须先建立 channel：

```
Client                      Gateway                     Backend
  │                           │                           │
  ├─ openBackendChannel ─────>│                           │
  │  (backendId, epoch)       │  创建 ChannelState        │
  │                           │  { channelId, backendId,  │
  │<── channelId ─────────────│    epoch, openStreams }    │
  │                           │                           │
  ├─ openSessionStream ──────>│  openStreams.add(sid)      │
  │  (channelId, sessionId)   │                           │
  │                           │                           │
  │                           │<── run_stream_event ──────│
  │                           │  查 openStreams 过滤       │
  │<── run_stream_event ──────│  只转发匹配的 session      │
  │                           │                           │
  ├─ channel_client_message ─>│  按 channelId 路由        │
  │                           │──────────────────────────>│
```

Gateway 维护的状态：

```typescript
interface ChannelState {
  channelId: string;
  backendId: string;
  epoch: number;              // 绑定 backend epoch
  peerSessionId: string;      // 所属 client
  openStreams: Set<string>;    // 订阅的 session ids
}

// channels: Map<channelId, ChannelState>
```

### Registry Revision 机制

```typescript
// Gateway 内部
let revision = 0;

// backend 上线
revision++;  // → 1
emit('registry_event', { revision: 1, item: backendA, action: 'upsert' });

// backend 下线
revision++;  // → 2
emit('registry_event', { revision: 2, item: backendA, action: 'remove' });

// 客户端收到 event 时检查
if (event.revision !== myRevision + 1) {
  // 漏了消息，请求 resync
  requestRegistrySnapshot();
} else {
  myRevision = event.revision;
  applyEvent(event);
}
```

三种同步方式：
- **Snapshot**：首次连接或 gap 检测后，全量下发 `{ revision, items[] }`
- **Delta**：断线重连时，`{ fromRevision, toRevision, events[] }`
- **Event**：运行时单条推送，带 revision 用于 gap 检测

## 问题识别

### 1. Registry Revision — 过度设计

Backend 数量通常为个位数，full snapshot 数据量极小。Revision + delta + gap detection 这套机制适用于 registry 有大量节点的场景，对我们没有必要。

纯 snapshot 对比的唯一风险是：backend 下线又上线（epoch 变了），如果两次 snapshot 的 backend list 看起来一样，客户端可能不知道 epoch 变了。但这个问题可以通过在 snapshot 中携带 epoch 字段直接解决——客户端对比 epoch 即可，不需要 revision。

### 2. Channel — 不必要的间接层

Channel 的核心作用是 per-session 过滤：gateway 只把客户端订阅的 session 事件转发给它。但实际场景中：

- 一个 backend 同时活跃的 session 通常 1-2 个
- 全部转发的额外带宽可以忽略
- 客户端过滤 `if (sessionId !== mySessionId) return` 零成本

Channel 引入的额外复杂度：
- openBackend/closeBackend 握手
- Epoch 绑定和生命周期管理
- openStreams 状态维护
- 恢复时需要重建 channel（移动端前后台切换的主要痛点之一）

### 3. 对恢复系统的连锁影响

Channel 机制是恢复系统复杂度的重要来源。桌面端 recoveryStore 需要跟踪每个 backend 的 channel 状态（opening/ready/degraded），移动端 RecoveryJobManager 需要 ensureActiveBackendReady 步骤来重建 channel。如果去掉 channel，恢复流程直接简化。

## 简化方案

### Registry 同步：去掉 Revision，只用 Snapshot

```
现状:
  连接时    → snapshot (revision + items)
  运行时    → event (revision + item)  → gap 检测 → 可能 resync
  断线重连  → delta (fromRevision → toRevision + events)

简化后:
  连接时       → full snapshot (items，包含 epoch)
  运行时变更   → full snapshot (每次变更都发全量)
  定时轮询     → full snapshot (gateway 定期推送，兜底防丢失)
  移动端恢复   → full snapshot (从后台恢复后立即请求一次)
  断线重连     → full snapshot
```

#### 定时轮询

Gateway 每隔一定时间（如 30s）向所有已连接客户端推送一次 full snapshot，作为兜底机制：

- 防止因 WebSocket 消息丢失导致客户端状态与 gateway 不一致
- 替代现有 revision + gap detection 的功能，但实现简单得多
- 如果 snapshot 内容与上次相同，客户端对比后直接跳过，无额外开销

```typescript
// Gateway 端
setInterval(() => {
  const snapshot = buildRegistrySnapshot();
  for (const client of connectedClients) {
    client.send({ type: 'registry_snapshot', items: snapshot });
  }
}, REGISTRY_POLL_INTERVAL);  // 30s
```

#### 移动端从后台恢复

移动端从后台恢复时，可能已经错过了若干变更。不依赖定时轮询的下一次触发，而是**立即请求一次 full snapshot**：

```
Client (resume)                Gateway
  │                              │
  ├─ request_registry_snapshot ─>│
  │<── registry_snapshot ────────│  立即回复当前全量
  │                              │
  │  对比 epoch，清理 stale 状态   │
```

这样移动端恢复不需要等待下一个轮询周期，可以在毫秒级拿到最新 backend list。

客户端对比逻辑：

```typescript
function applyRegistrySnapshot(items: BackendPresence[]) {
  const prev = currentBackends;
  currentBackends = new Map(items.map(b => [b.backendId, b]));

  for (const [id, backend] of currentBackends) {
    const old = prev.get(id);
    if (!old) {
      // 新 backend 上线
    } else if (old.epoch !== backend.epoch) {
      // backend 重启过，需要重新订阅
    }
  }
  for (const [id] of prev) {
    if (!currentBackends.has(id)) {
      // backend 下线
    }
  }
}
```

去掉的代码：
- Gateway: revision 计数器、delta 生成、gap 检测处理
- Client: revision 跟踪、gap 检测、delta 应用逻辑
- Protocol: `registry_delta`、`registry_event` 消息类型（只保留 `registry_snapshot`）

### Channel → Subscription

```
现状:
  Client                    Gateway                   Backend
    ├─ openBackendChannel ─>│  创建 ChannelState       │
    │<── channelId ─────────│                          │
    ├─ openSessionStream ──>│  注册到 openStreams       │
    │<── filtered events ───│  per-session 过滤        │

简化后:
  Client                    Gateway                   Backend
    ├─ subscribe(backendId)>│  subscriptions.add(cid)  │
    │<── all events ────────│  按 backendId 广播       │
    │  自己过滤 session      │                          │
```

Gateway 状态简化：

```typescript
// 现状
channels: Map<channelId, {
  backendId: string;
  epoch: number;
  peerSessionId: string;
  openStreams: Set<string>;
}>

// 简化后
subscriptions: Map<backendId, Set<clientId>>
```

### Epoch 处理变化

```
现状:
  channel 绑定 epoch → epoch 变了 → channel 关闭 → 客户端重建 channel

简化后:
  snapshot 中携带 epoch → 客户端对比发现 epoch 变了 → 清理本地状态 → 重新订阅
```

不需要 gateway 主动关闭什么，客户端自己处理即可。

### 流控保持不变

```
现状:  第一个 channel open  → stream_demand { active: true }
       最后一个 channel close → stream_demand { active: false }

简化后: 第一个 subscriber   → stream_demand { active: true }
        最后一个 unsubscribe → stream_demand { active: false }
```

逻辑完全一样，只是触发条件从 channel 生命周期变成 subscription 生命周期。

## 对恢复系统的影响

### 移动端恢复流程简化

```
现状 (3 步):
  ensureTransportConnected   (12s)  → WebSocket 重连
  ensureActiveBackendReady   (12s)  → openBackend 重建 channel + catalog sync
  ensureActiveSessionReady   (15s)  → openSessionStream + catch up

简化后 (2 步):
  ensureTransportConnected   (12s)  → WebSocket 重连
  ensureBackendSubscribed           → subscribe + catalog sync
  (session 处理变成纯客户端逻辑，不需要和 gateway 交互)
```

`ensureActiveSessionReady` 不再需要通过 gateway 打开 session stream，因为订阅了 backend 就能收到所有事件。客户端只需要本地维护"我当前关注哪个 session"。

### 桌面端 recoveryStore 简化

去掉 backend 状态中与 channel 相关的字段：

```
现状:
  backends[backendId]: {
    status: 'absent' | 'visible' | 'opening' | 'ready' | 'degraded' | 'error'
    desiredOpen: boolean
    channelReady: boolean
    catalogReady: boolean
  }

简化后:
  backends[backendId]: {
    subscribed: boolean
    catalogReady: boolean
  }
```

不再需要跟踪 opening/ready/degraded 等 channel 生命周期状态。

## 变更范围总结

| 层级 | 去掉 | 保留 | 新增 |
|------|------|------|------|
| Protocol | `registry_delta`, `registry_event`, `open_backend_channel`, `backend_channel_*`, `open_session_stream`, `close_session_stream` | `registry_snapshot` (每次变更全量发) | `subscribe(backendId)`, `unsubscribe(backendId)` |
| Gateway | revision 计数器, ChannelState, openStreams, delta 生成, gap 检测 | stream_demand 流控 | subscriptions: `Map<backendId, Set<clientId>>` |
| Client | revision 跟踪, gap 检测, delta 应用, openBackend/closeBackend | catalog sync, session catch-up | 本地 epoch 对比, subscribe/unsubscribe |
| 恢复系统 | ensureActiveBackendReady 中的 channel 重建, per-backend channel 状态跟踪 | transport 恢复, catalog sync | 简化的 subscription 恢复 |

## 补充考虑

设计文档初稿遗漏了以下几个从 channel 路由改为 backendId 路由的场景：

1. **Client → Backend 消息路由**：`channel_client_message { channelId }` → `backend_client_message { backendId }`
2. **Catalog 订阅时机**：channel open 时自动订阅 → subscribe 时自动触发 catalog sync
3. **HTTP 代理**：gateway HTTP proxy 按 channelId 路由 → 按 backendId 路由
4. **Run 管理**：start/stop run 通过 channelId → 通过 backendId
5. **catch_up_session_content**：channelId 路由 → backendId 路由

本质上都是同一个变更：gateway 从"按 channelId 路由"统一改为"按 backendId 路由"。

## 实现计划

### Phase 1: Registry 同步简化

**目标**：去掉 revision/delta/gap detection，只用 full snapshot + 定时轮询 + 按需请求。

**变更范围**：

| 文件 | 操作 |
|------|------|
| `shared/src/protocol/gateway.ts` | 删除 `RegistryDeltaMessage`, `RegistryEventMessage`, `ResyncRegistryMessage`；`PeerHelloMessage` 删除 `lastRegistryRevision`；`PeerReadyMessage.registrySync` 简化为 `{ items: BackendPresence[] }`；`RegistrySnapshotMessage` 删除 `revision`；新增 `RequestRegistrySnapshotMessage` |
| `gateway/src/state.ts` | `RegistryState` 删除 `revision`, `eventLog`；删除 `getRegistryDelta()`, `appendRegistryEvent()` |
| `gateway/src/server.ts` | `broadcastRegistryEvent()` → `broadcastRegistrySnapshot()`；新增 30s 定时推送；新增 `handleRequestRegistrySnapshot`；删除 delta/event 相关处理 |
| `apps/desktop/src/hooks/transport/GatewayTransport.ts` | 删除 `registryRevision`、`handleRegistryDelta()`、`handleRegistryEvent()`、gap detection |
| `server/src/domains/gateway/gateway-client.ts` | 删除 revision 跟踪、delta/event 处理 |
| `shared/src/facade/runtime-core.ts` | 删除 `handleRegistryEvent()` |
| `shared/src/facade/adapter.ts` | 删除 `registry_event_received` 事件类型 |

### Phase 2: Channel → Subscription

**目标**：用 `subscribe(backendId)` / `unsubscribe(backendId)` 替换 channel 机制。

**协议变更**：

| 删除 | 新增 |
|------|------|
| `OpenBackendChannelMessage` | `SubscribeBackendMessage { backendId }` |
| `BackendChannelOpenedMessage` | `BackendSubscribedMessage { backendId, epoch, capabilities }` |
| `BackendChannelRejectedMessage` | （subscribe 失败直接在 snapshot 里体现） |
| `CloseBackendChannelMessage` | `UnsubscribeBackendMessage { backendId }` |
| `BackendChannelClosedMessage` | （backend 下线通过 snapshot 更新体现） |
| `ChannelClientMessage { channelId }` | `BackendClientMessage { backendId }` |
| `OpenSessionStreamMessage { channelId }` | （不需要，subscribe 后自动收所有事件） |
| `CloseSessionStreamMessage { channelId }` | （不需要） |

**Gateway 状态简化**：

```typescript
// 删除
channels: Map<ChannelId, ChannelState>

// 新增
subscriptions: Map<BackendId, Set<PeerSessionId>>
```

**消息路由变化**：
- Gateway 收到 backend 的 `run_stream_event` → 广播给该 backend 的所有 subscriber（不做 session 过滤）
- Gateway 收到 client 的 `backend_client_message` → 按 backendId 路由到 backend

**Facade 接口变化**：
- `openBackend(backendId)` → 发 `subscribe_backend` 而非 `open_backend_channel`
- `closeBackend(backendId)` → 发 `unsubscribe_backend`
- `openSessionStream` / `closeSessionStream` → 纯客户端本地状态管理，不再和 gateway 交互
- `BackendRuntimeState` 简化：`offline | visible | subscribing | ready | error`

### Phase 3: Recovery 简化

**目标**：从恢复流程中去掉 channel 生命周期管理。

**移动端**：
- `ensureActiveBackendReady` 简化为 `ensureBackendSubscribed`（subscribe + catalog sync）
- `ensureActiveSessionReady` 简化为纯客户端逻辑（不需要和 gateway 交互）

**桌面端**：
- `BackendRecoveryStatus` 简化：去掉 `opening`、`degraded`
- `BackendRecoveryState` 去掉 `channelReady`、`desiredOpen`
- Reconciliation 不再需要检查 channel 状态

### 实现顺序

Phase 1 → Phase 2 → Phase 3，每个 phase 完成后系统可运行。

## Phase 4: Catalog 同步简化 — Gateway 去缓存 + 合并订阅

### 现状

两套独立的订阅关系并存：

```
1. subscriptions: Map<BackendId, Set<PeerSessionId>>
   → 用于 run_stream_event / backend_server_message 广播
   → 通过 subscribe_backend / unsubscribe_backend 管理

2. BackendCatalogState.subscribers: Set<PeerSessionId>
   → 用于 catalog_snapshot / catalog_event 广播
   → 通过 subscribe_backend_catalog / unsubscribe_backend_catalog 管理
   → Gateway 还缓存完整 catalog 数据：items Map + eventLog + revision
```

### 问题

1. **两套订阅没有必要分开**——subscribe 一个 backend 就应该收到它的所有数据，没有"只要 run event 不要 session list"的场景
2. **Gateway 缓存 catalog 数据是冗余的**——Backend 是唯一数据源，gateway 副本增加一致性风险
3. **Catalog 的 revision / delta / eventLog 机制复杂**——和已简化的 registry 不一致

### 简化方案

三个关键变化：

1. **合并为一套订阅**——`subscribe_backend` = 收到一切（run event + catalog + backend message）
2. **Gateway 不缓存 catalog**——纯转发，所有数据由 backend 提供
3. **Catalog snapshot 包含 session 的 run 状态**——snapshot 是状态真相，event 只是加速更新

#### 统一订阅模型

```
现状（两套订阅）:
  subscribe_backend         → 收 run event + backend message
  subscribe_backend_catalog → 收 catalog snapshot/event

简化后（一套订阅）:
  subscribe_backend         → 收所有数据
```

Gateway 只维护一套 `subscriptions: Map<BackendId, Set<PeerSessionId>>`，同时用于：
- `run_stream_event` 广播
- `backend_data_snapshot` / `backend_data_event` 广播
- `backend_server_message` 广播

#### 重命名：Catalog → Backend Data

"Catalog" 这个名字是 channel 时代的产物，特指 session 列表。现在它包含 sessions + projects + run 状态，实际上是 **backend 的业务数据摘要**。重命名为 `backend_data`：

```typescript
// Backend → Gateway: 推送完整数据快照
interface BackendDataSnapshotMessage {
  type: 'backend_data_snapshot';
  sessions: SessionItem[];
  projects: ProjectItem[];
}

interface SessionItem {
  sessionId: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  runStatus: 'idle' | 'running' | 'waiting' | 'failed' | 'completed';
}

interface ProjectItem {
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

// Backend → Gateway: 推送增量变更
type BackendDataEventMessage =
  | { type: 'backend_data_event'; op: 'session_upsert'; item: SessionItem }
  | { type: 'backend_data_event'; op: 'session_remove'; sessionId: string }
  | { type: 'backend_data_event'; op: 'project_upsert'; item: ProjectItem }
  | { type: 'backend_data_event'; op: 'project_remove'; projectId: string }

// Client → Gateway → Backend: 按需请求
interface RequestBackendDataSnapshotMessage {
  type: 'request_backend_data_snapshot';
  backendId: BackendId;
}
```

#### Session runStatus 的处理

Session 的 `runStatus` 放在 snapshot 里，作为状态真相：

- **Snapshot（30s 定时 + subscribe 时 + 按需请求）** = 完整状态，永远正确
- **Event（实时推送）** = 低延迟更新，可能丢失
- **Run event（run_stream_event）** = 内容流，用于渲染聊天，不用于状态判断

即使 event 丢了，下一次 snapshot 会修正状态。Client 以最近一次 snapshot 为准，event 只做乐观更新。

#### Gateway 状态变化

```typescript
// 删除整个结构
BackendCatalogState { revision, items, eventLog, subscribers }

// 删除 PeerSession 字段
catalogSubscriptions: Set<BackendId>

// 保留（Phase 2 已引入，无变化）
subscriptions: Map<BackendId, Set<PeerSessionId>>
```

#### Stream Demand 统一控制

Stream demand 的语义扩展为：**active = 有 subscriber，推一切数据；inactive = 没有 subscriber，什么都不推**。

```
第一个 client subscribe backend-A → subscriberCount 0→1
  → gateway 发 stream_demand { active: true } 给 backend-A
  → backend-A 开始推送：
    ├─ backend_data_snapshot（立即 + 每 30s）
    ├─ backend_data_event（变更时）
    └─ run_stream_event（run 进行中）

最后一个 client unsubscribe backend-A → subscriberCount 1→0
  → gateway 发 stream_demand { active: false } 给 backend-A
  → backend-A 停止推送所有数据
```

没有 subscriber 时，backend 不推任何消息给 gateway（节省带宽和 gateway 处理开销）。

#### 消息流

**Client 订阅 backend（自动获取所有数据）：**
```
Client                    Gateway                   Backend
  │                         │                         │
  ├─ subscribe_backend ────>│                         │
  │                         │  添加到 subscriptions    │
  │<── backend_subscribed ──│                         │
  │                         ├─ stream_demand(active) ─>│  (如果是第一个 subscriber)
  │                         │<── backend_data_snapshot │
  │<── backend_data_snapshot│  透传                    │
```

**Session/Project 变更推送：**
```
Backend                   Gateway                   Client
  │                         │                         │
  ├─ backend_data_event ──>│                         │
  │                         ├─ backend_data_event ──>│  广播给 subscriptions 中所有 subscriber
```

**定时轮询兜底（30s）：**
```
Backend                   Gateway                   Client
  │                         │                         │
  ├─ backend_data_snapshot >│  (仅 stream_demand      │
  │                         │   active 时才推)         │
  │                         ├─ backend_data_snapshot >│  广播给所有 subscriber
  │                         │                         │  Client 按 updatedAt 过滤
```

**按需请求（移动端恢复 / 打开 session）：**
```
Client                    Gateway                   Backend
  │                         │                         │
  ├─ request_backend_data ─>│                         │
  │                         ├─ (转发) ───────────────>│
  │                         │<── backend_data_snapshot │
  │<── backend_data_snapshot│  透传                    │
```

#### 去掉的内容

| 类别 | 具体内容 |
|------|---------|
| Gateway 状态 | `BackendCatalogState` 整个结构、`PeerSession.catalogSubscriptions` |
| 协议消息 | `SubscribeBackendCatalogMessage`、`UnsubscribeBackendCatalogMessage`、`BackendCatalogDeltaMessage`、`BackendCatalogResetMessage` |
| 协议类型 | `CatalogDeltaEvent`、`CatalogRevision`、`SessionCatalogItem`（替换为 `SessionItem`） |
| Gateway 方法 | `setCatalogSnapshot()`、`resetCatalog()`、`catalogUpsert()`、`catalogRemove()`、`getCatalogDelta()`、`addCatalogSubscriber()`、`removeCatalogSubscriber()`、`appendCatalogEvent()` |
| 消息处理 | `handleCatalogSnapshot()`、`handleCatalogEvent()`、`handleSubscribeBackendCatalog()`、`handleUnsubscribeBackendCatalog()` |

#### 重命名的内容

| 旧名称 | 新名称 |
|--------|--------|
| `CatalogSnapshotMessage` | `BackendDataSnapshotMessage` |
| `CatalogEventMessage` | `BackendDataEventMessage` |
| `BackendCatalogSnapshotMessage` | （合并到 `BackendDataSnapshotMessage`，gateway 透传） |
| `BackendCatalogEventMessage` | （合并到 `BackendDataEventMessage`，gateway 透传） |
| `SessionCatalogItem` | `SessionItem` |

### Client 数据获取时机总览

subscribe_backend 成功后，client 收三类数据。以下列出每类数据的所有获取时机和方式。

#### 1. Backend List (Registry)

Backend 列表的获取与 backend subscription 无关，是更上层的发现机制。

| 时机 | 触发方 | 方式 | 说明 |
|------|--------|------|------|
| 初次连接 | Client | WS `peer_hello` → `peer_ready` 回复带 `registrySync` | Gateway 在握手中返回当前 backend 列表 |
| Backend 上下线 | Gateway | WS `registry_snapshot` 推送 | Gateway 检测到变更后广播 full snapshot |
| 定时兜底 | Gateway | WS `registry_snapshot` 推送（30s） | 防丢失，client 对比后跳过无变化的 |
| 移动端恢复 | Client | WS `request_registry_snapshot` | 从后台恢复后主动请求，不等 30s 轮询 |
| 断线重连 | Client | 同初次连接 | 重连后 `peer_ready` 带最新 registry |

#### 2. Backend Data (Sessions + Projects 元数据)

Client subscribe 某个 backend 后获取该 backend 的 sessions 和 projects。

| 时机 | 触发方 | 方式 | 说明 |
|------|--------|------|------|
| Subscribe 成功 | Backend | WS `backend_data_snapshot` | Gateway 通知 backend 有新 subscriber，backend 立即推 full snapshot |
| Session/Project 变更 | Backend | WS `backend_data_event` | 增删改时推送，gateway 透传广播。可能丢失 |
| Run 状态变更 | Backend | WS `backend_data_event` | session 的 `runStatus` 变化时推送 |
| 定时兜底 | Backend | WS `backend_data_snapshot`（30s） | Backend 定期推 full snapshot，包含最新 `runStatus`。**状态真相** |
| 移动端恢复 | Client | WS `request_backend_data_snapshot` | 主动请求，gateway 转发给 backend，backend 回 snapshot |
| 断线重连 | Client | 重新 `subscribe_backend` → 同 subscribe 成功 | 重连后重新订阅触发 fresh snapshot |

**关键原则**：`backend_data_snapshot` 是状态真相（包含 `runStatus`），`backend_data_event` 是加速更新（可能丢失，snapshot 兜底）。

#### 3. Run 内容流 (Run Stream Event)

Client subscribe 某个 backend 后，该 backend 所有 session 的 run 事件都会推过来，client 本地过滤感兴趣的 session。

| 时机 | 触发方 | 方式 | 说明 |
|------|--------|------|------|
| Run 进行中 | Backend | WS `run_stream_event` | 实时推送文本 delta、tool call 等，用于渲染聊天 |
| Run 状态变更 | Backend | WS `run_stream_event`（`run_started`/`run_completed`/`run_failed`） | Client 收到后**乐观更新** session 的 `runStatus` |
| 打开 Session | Client | WS `catch_up_session_content` → `session_content_patch` | 用户打开 session 时主动 catch-up，补消息 + 同步 `runStatus` |
| 内容缺口 | Client | WS `catch_up_session_content` → `session_content_patch` | Client 检测到 offset gap 时主动请求补全 |

#### Session 状态同步策略

Session 的 `runStatus` 通过**四层机制**保持一致，从快到慢：

```
1. run_stream_event（毫秒级）
   └─ run_started / run_completed / run_failed
   └─ Client 收到后立即乐观更新 runStatus
   └─ 可能丢失（断线、后台）

2. session_content_patch（秒级，用户打开 session 时）
   └─ 用户打开/切换 session 时主动 catch-up
   └─ Backend 在回复中附带该 session 的最新 runStatus
   └─ 补消息 + 同步状态同时完成

3. backend_data_event（秒级，实时推送）
   └─ Session runStatus 变更时 backend 推 event
   └─ 可能丢失，由 snapshot 兜底

4. backend_data_snapshot（30s 兜底）
   └─ 包含所有 session 的 runStatus
   └─ 状态真相，修正前三层可能的偏差
```

**原则**：
- **Run event 做乐观更新**——大多数情况下 client 能实时感知状态变化（run 完成即知道）
- **打开 session 时主动 catch-up**——用户打开一个 session 时，即使没有 offset gap，也主动请求一次 `catch_up_session_content`。Backend 回复中附带 `runStatus`，确保用户看到的 session 状态是最新的
- **Snapshot 是最终真相**——即使前几层全丢了，最多 30s 后 snapshot 修正

`session_content_patch` 响应扩展：

```typescript
interface SessionContentPatchMessage {
  type: 'session_content_patch';
  backendId: BackendId;
  sessionId: string;
  messages: SessionMessage[];
  latestOffset: Offset;
  runStatus: 'idle' | 'running' | 'waiting' | 'failed' | 'completed';  // 新增
}
```

这样 client 补完消息后立即能更新 session 状态，不需要等下一次 snapshot。

### 多通道状态更新的时序保护

Session/Project 的状态通过多个通道更新（snapshot、event、run event、content patch），可能出现旧数据覆盖新数据的问题：

```
t=100ms  Client 收到 run_completed event → runStatus = 'completed' ✓
t=200ms  一个在 t=50ms 生成的 stale snapshot 到达 → runStatus = 'running' ✗
```

#### 解决方案：基于 `updatedAt` 的乐观保护

每个 `SessionItem` / `ProjectItem` 已有 `updatedAt` 字段（由 backend 在每次变更时更新）。Client 应用更新时比较 `updatedAt`，拒绝更旧的数据：

```typescript
function applySessionUpdate(incoming: SessionItem) {
  const current = sessions.get(incoming.sessionId);
  if (current && current.updatedAt > incoming.updatedAt) return; // 拒绝旧数据
  sessions.set(incoming.sessionId, incoming);
}
```

#### 各通道的处理规则

| 通道 | 处理方式 |
|------|---------|
| `backend_data_snapshot` | 逐条比较 `updatedAt`，只接受更新的。列表成员以 snapshot 为准（处理增删） |
| `backend_data_event` | 比较 `updatedAt`，只接受更新的 |
| `run_stream_event` | `run_started/completed/failed` 更新 `runStatus` 时，设 `updatedAt = event.timestamp`，同样比较 |
| `session_content_patch` | 附带的 `runStatus` 同样带 `updatedAt`，比较后决定是否接受 |

#### Snapshot 处理列表成员变化

Snapshot 除了逐条更新，还负责**增删**（某个 session 被删了、新 session 被创建了）。处理逻辑：

```typescript
function applyBackendDataSnapshot(snapshot: BackendDataSnapshot) {
  const newIds = new Set(snapshot.sessions.map(s => s.sessionId));

  // 删除 snapshot 中不存在的 session（被删了）
  for (const id of sessions.keys()) {
    if (!newIds.has(id)) sessions.delete(id);
  }

  // 逐条对比 updatedAt，只接受更新的
  for (const incoming of snapshot.sessions) {
    applySessionUpdate(incoming);
  }

  // projects 同理
}
```

#### 为什么用 `updatedAt` 而不是 revision

- 所有数据来自同一个 backend（同一个时钟），`updatedAt` 天然有序
- `updatedAt` 是 per-item 粒度，比 per-snapshot 的 revision 更精确
- 不需要额外的计数器或状态跟踪，复用已有字段

### 数据获取方式对比

| 数据类型 | 获取方式 | 状态真相 | 定时兜底 |
|---------|---------|---------|---------|
| Backend List | Gateway 推送 + 30s 轮询 + 按需请求 | snapshot | 30s |
| Sessions + Projects | Backend 推送 + 30s 轮询 + 按需请求（经 gateway 透传） | snapshot（含 runStatus） | 30s |
| Run 内容 | Backend 推送 + 按需 catch-up（经 gateway 透传） | — | 无（按需补全） |
| Session runStatus | run event 乐观更新 + content patch 顺带 + snapshot 兜底 | snapshot | 30s |

三类数据共享同一个 `subscriptions` 订阅关系，subscribe 一次就收到一切。Gateway 对所有数据只做转发，不缓存。Backend 只在 `stream_demand { active: true }` 时才推送数据（没有 subscriber 时什么都不推）。所有通道的状态更新通过 `updatedAt` 比较防止旧数据覆盖新数据。

## 移动端特别考虑

### 订阅不跨连接保持

Gateway 的 subscription 是内存状态，不持久化。WebSocket 断开 → gateway 清理 peer + 所有 subscription → client 重连后需要重新 subscribe。

Client 本地在 `gatewayStore.lastActiveBackendId` 中持久化了上次选择的 backend。重连后根据这个值自动重新 `subscribe_backend`，不需要 gateway 记住之前的订阅。

### 移动端 Resume 完整流程

```
App 从后台恢复
  │
  ├─ 1. 检测 WebSocket 状态
  │     ├─ 还活着 → 跳到步骤 3
  │     └─ 断了 → 自动重连
  │
  ├─ 2. 重连握手
  │     ├─ peer_hello → peer_ready
  │     └─ 收到 registry snapshot（当前 backend 列表）
  │
  ├─ 3. 重新订阅 backend
  │     ├─ subscribe_backend (lastActiveBackendId)
  │     ├─ 收到 backend_subscribed
  │     └─ 收到 backend_data_snapshot（sessions + projects + runStatus）
  │
  ├─ 4. 恢复当前查看的 session（如果有）
  │     ├─ catch_up_session_content（补消息 + 同步 runStatus）
  │     └─ 恢复完成
  │
  └─ 5. 后续数据自动流入
        ├─ backend_data_event（变更推送）
        ├─ run_stream_event（实时内容流）
        └─ backend_data_snapshot（30s 兜底）
```

### 前后台切换与 Stream Demand

30s 定时 snapshot 只在 `stream_demand { active: true }` 时才推送。前后台切换对推送的影响：

```
App 进入后台
  → WebSocket 断开（或被系统回收）
  → Gateway 检测到 peer 断线，清理 subscription
  → subscriberCount 1→0，发 stream_demand { active: false }
  → Backend 停止推送所有数据
  → 后台零流量

App 回到前台
  → 重连 + 重新 subscribe
  → subscriberCount 0→1，发 stream_demand { active: true }
  → Backend 重新开始推送
```

即使 WebSocket 没断（短暂后台），backend 仍然在推 30s snapshot。但这个开销很小（几 KB），且移动端短暂后台（<5s）不触发恢复流程。

### 前后台检测

使用 `document.visibilityState` API 判断：

| 场景 | 触发 `visibilitychange`？ | 影响 |
|------|--------------------------|------|
| 按 Home / 切换 App | 是 | 正常检测 |
| 锁屏 | 是 | 正常检测 |
| 下拉通知栏 | 不一定 | 无影响（短暂，不触发恢复） |
| 分屏模式 | 不一定 | 无影响（保持连接即可） |
| 系统弹窗 | 不一定 | 无影响（短暂） |
| 进程被杀 | 否 | 冷启动重新走完整初始化 |

`BACKGROUND_THRESHOLD_MS = 5s` 过滤了短暂的 visibility 切换（通知栏、系统弹窗），只有真正进入后台 >5s 才触发恢复流程。

如果未来需要更精确的检测，可以接入 Tauri 的原生 Android lifecycle event（`onPause`/`onResume`），但当前方案已足够。

### Backend 离线时的行为

| 场景 | 行为 |
|------|------|
| Client subscribe 一个离线的 backend | Gateway 返回 `BACKEND_OFFLINE` 错误。Client 不重试，等 registry snapshot 通知 backend 重新上线后再 subscribe |
| Client 已 subscribe 的 backend 离线 | Gateway 发 `backend_unsubscribed { reason: 'backend_offline' }` + registry snapshot（backend 消失）。Client 更新 UI |
| Client 请求 `request_backend_data_snapshot` 但 backend 离线 | Gateway 返回 error。Client 忽略，等 backend 上线后重新 subscribe |

Gateway 不"记住"订阅等 backend 上线——这会增加 gateway 状态复杂度，违背简化原则。Client 通过 registry snapshot 感知 backend 上线，主动重新 subscribe。

## 风险评估

- **带宽**：backend 活跃 session 多时（>10），全量广播会增加移动端流量。但实际使用中单 backend 并发 session 极少（1-2 个），且事件本身很小。如果未来出现高并发场景，可以在客户端加 session 级别的过滤请求（告诉 gateway 只推哪些 session），但这是优化，不是必须。
- **不做向前兼容**：需要同时升级 gateway 和客户端。
- **Gateway 不缓存**：新 client 订阅时需要 gateway → backend 往返，但 backend 通常在线，延迟可忽略。Backend 离线时数据本身无意义。
- **runStatus 延迟**：正常情况下 run event 实时更新（毫秒级）；断线后 catch-up 时 content patch 附带状态（秒级）；最坏情况 30s snapshot 修正。
- **时序安全**：所有通道通过 `updatedAt` 比较保证只接受更新的数据，不会出现旧状态覆盖新状态。
- **前后台检测**：`visibilitychange` API 在少数场景（通知栏、分屏）可能不触发，但 5s 阈值过滤了这些短暂场景，不影响恢复正确性。
