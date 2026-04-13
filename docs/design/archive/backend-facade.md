# BackendFacade 设计草案

日期：2026-03-26
状态：Draft
目标：统一 desktop embedded server、mobile、Windows pure UI 的 backend 能力接入模型。

## 背景

当前 gateway 相关链路存在几个核心问题：

- UI 对 backend 能力的接入模型在 desktop 和 non-desktop 上不一致。
- desktop 模式同时依赖 embedded server 状态和 gateway transport 状态，存在双控制面。
- session stream 的模型默认偏向单 active session，但产品实际上支持多 active session。
- 现有抽象偏基础设施视角，UI 看到的是 gateway、embedded、本地 proxy 等概念，而不是统一的 backend 能力。

本设计的目标不是继续强化 gateway 抽象，而是定义一个统一的 backend capability surface。

## 核心结论

### 1. 统一抽象名称

使用 `BackendFacade` 作为 UI 侧唯一依赖的核心抽象。

`BackendFacade` 的语义是：

- UI 通过它发现 backend
- UI 通过它选择 backend
- UI 通过它建立 backend 实时通道
- UI 通过它访问 backend HTTP 能力
- UI 通过它消费 session catalog、run stream、content patch 等能力

UI 不应该再直接感知：

- gateway mode
- embedded mode
- local proxy
- desktop 与 mobile 的网络拓扑差异

### 2. provider 模型

`BackendFacade` 由不同 provider 提供实现：

- `EmbeddedBackendFacadeProvider`
- `DirectBackendFacadeProvider`

语义要求：

- desktop: UI 永远通过 embedded server 暴露的 facade 接入 backend 能力
- mobile / Windows pure UI: UI 直接通过 direct facade 接入 backend 能力

差异只允许存在于 provider 适配层，不允许渗透到 UI 和 store 主模型。

### 3. UI 侧唯一主状态

UI 只消费 `BackendFacadeSnapshot` 和 facade 事件。

不允许继续存在：

- 一份 gateway registry 状态
- 一份 embedded server status 驱动的 backend 列表状态

同一事实只能有一份主状态。

## BackendFacade 最小契约

```ts
export type BackendFacadeMode = 'embedded' | 'direct';

export type BackendConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type BackendRuntimeState =
  | 'offline'
  | 'visible'
  | 'opening'
  | 'ready'
  | 'degraded'
  | 'error';

export type BackendOpenState =
  | 'closed'
  | 'opening'
  | 'open'
  | 'closing'
  | 'error';

export type SessionStreamState =
  | 'closed'
  | 'opening'
  | 'open'
  | 'closing'
  | 'error';

export interface BackendHandle {
  id: string;
}

export interface BackendSnapshot {
  backendId: string;
  name: string;
  online: boolean;
  runtimeState: BackendRuntimeState;
  openState: BackendOpenState;
  channelId: string | null;
  instanceId: string;
  deviceId: string;
  channel: string;
  isThisInstance: boolean;
  isThisDevice: boolean;
  capabilities: string[];
  lastError?: string;
}

export interface SessionStreamSnapshot {
  streamKey: string;
  backendId: string;
  sessionId: string;
  state: SessionStreamState;
  channelId: string | null;
  lastError?: string;
  latestOffset?: number;
  updatedAt: number;
}

export interface BackendFacadeSnapshot {
  mode: BackendFacadeMode;
  connectionState: BackendConnectionState;
  localBackendId: string | null;
  currentInstanceId: string | null;
  currentDeviceId: string | null;
  backends: BackendSnapshot[];
  sessionStreams: Record<string, SessionStreamSnapshot>;
  registryRevision?: number;
}

export interface BackendFacade {
  connect(): void;
  disconnect(): void;

  getSnapshot(): BackendFacadeSnapshot;
  subscribe(listener: (snapshot: BackendFacadeSnapshot) => void): () => void;

  openBackend(backendId: string): void;
  closeBackend(backendId: string): void;
  getBackendChannelState(backendId: string): BackendChannelState;

  sendToBackend(backendId: string, message: ClientMessage): void;

  openSessionStream(backendId: string, sessionId: string): void;
  closeSessionStream(backendId: string, sessionId: string): void;
  getSessionStreamState(backendId: string, sessionId: string): SessionStreamSnapshot | undefined;

  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void;

  getHttpBaseUrl(backendId: string): string | null;
  getHttpHeaders(): Record<string, string>;
}
```

## 多 active session 设计

多 active session 是一等公民，不允许架构建立在“当前唯一 active session”前提上。

### 关键约束

- 同一个 backend 可以同时存在多个 active session stream
- 不同 backend 之间也可以同时存在多个 active session stream
- backend 掉线或 channel 关闭时，相关 stream 必须按 stream 粒度迁移状态
- stream 恢复按 stream 粒度执行，而不是全局单例恢复

### stream key

推荐使用稳定复合键：

```ts
streamKey = `${backendId}:${sessionId}`;
```

### stream 内部模型

provider 或 runtime 内部建议维护两份结构：

```ts
interface DesiredSessionStream {
  streamKey: string;
  backendId: string;
  sessionId: string;
  shouldBeOpen: boolean;
}

interface SessionStreamRuntime {
  streamKey: string;
  backendId: string;
  sessionId: string;
  state: SessionStreamState;
  channelId: string | null;
  latestOffset?: number;
  lastError?: string;
  updatedAt: number;
}
```

语义：

- `DesiredSessionStream` 表示业务意图
- `SessionStreamRuntime` 表示当前运行态

好处：

- backend 掉线时可以保留 `shouldBeOpen=true`
- backend 恢复后可以自动恢复 stream
- UI 不需要直接管理恢复细节

## 事件模型

UI 不直接消费底层 gateway 协议事件，而是消费 facade 语义事件。

```ts
export type BackendFacadeEvent =
  | { type: 'connection_state_changed'; state: BackendConnectionState; error?: string }
  | { type: 'snapshot_updated'; snapshot: BackendFacadeSnapshot }
  | { type: 'backend_state_changed'; backendId: string; state: BackendRuntimeState }
  | { type: 'catalog_snapshot'; backendId: string; items: SessionCatalogItem[] }
  | { type: 'catalog_event'; backendId: string; op: 'upsert' | 'remove'; item?: SessionCatalogItem; sessionId?: string }
  | { type: 'session_stream_state_changed'; stream: SessionStreamSnapshot }
  | { type: 'run_event'; backendId: string; sessionId: string; event: ServerMessage }
  | { type: 'content_patch'; backendId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number };
```

关键点：

- facade 内部吸收 `registry_event`、`backend_channel_opened`、`backend_catalog_reset` 等协议级事件
- UI 只消费高语义事件和 snapshot

## 状态机

### facade 主状态机

```ts
idle -> connecting -> connected
connecting -> error
connected -> reconnecting -> connected
reconnecting -> error
connected/reconnecting/error -> disconnected
```

说明：

- `connected` 仅表示 facade 主连接就绪
- 不表示所有 backend 已 ready

### backend 子状态机

```ts
closed -> opening -> open
opening -> error
open -> closing -> closed
open -> error
```

映射到 UI 语义时：

- backend 在 registry 中可见但未打开，可视为 `visible`
- channel 建立完成且 catalog 初始化完成，可视为 `ready`

### session stream 子状态机

```ts
closed -> opening -> open
open -> closing -> closed
opening/open -> error
```

建议：

- backend channel 掉线时，相关 stream 先进入 `error`
- backend 恢复后，根据 `shouldBeOpen` 决定是否自动 reopen

## provider 设计

### EmbeddedBackendFacadeProvider

desktop 模式下，UI 永远通过 embedded server 暴露的 facade 接入 backend 能力。

目标链路：

- 实时面：`UI -> embedded server facade ws -> embedded server -> gateway -> backend`
- 请求面：`UI -> embedded server facade http -> embedded server -> gateway -> backend`

对 UI 来说，embedded server 就是 backend facade provider。

### DirectBackendFacadeProvider

mobile / Windows pure UI 下，UI 直接连接 gateway 获取 backend 能力。

目标链路：

- 实时面：`UI -> direct facade -> gateway -> backend`
- 请求面：`UI -> direct facade http -> gateway -> backend`

对 UI 来说，仍然是 backend facade，只是 provider 不同。

## desktop embedded facade 协议面

建议为 embedded server 暴露独立 facade WebSocket 入口：

- `/ws/backend-facade`

以及独立 facade HTTP 入口：

- `/api/backend-facade/status`
- `/api/backend-facade/proxy/:backendId/*`

### UI -> embedded facade WS

```ts
type UiToEmbeddedFacadeMessage =
  | { type: 'facade_subscribe' }
  | { type: 'open_backend'; backendId: string }
  | { type: 'close_backend'; backendId: string }
  | { type: 'send_to_backend'; backendId: string; message: ClientMessage }
  | { type: 'open_session_stream'; backendId: string; sessionId: string }
  | { type: 'close_session_stream'; backendId: string; sessionId: string }
  | { type: 'catch_up_content'; backendId: string; sessionId: string; afterOffset: number };
```

### embedded facade -> UI WS

```ts
type EmbeddedFacadeToUiMessage =
  | { type: 'facade_snapshot'; snapshot: BackendFacadeSnapshot }
  | { type: 'backend_state_changed'; backendId: string; state: BackendRuntimeState; error?: string }
  | { type: 'catalog_snapshot'; backendId: string; items: SessionCatalogItem[] }
  | { type: 'catalog_event'; backendId: string; op: 'upsert' | 'remove'; item?: SessionCatalogItem; sessionId?: string }
  | { type: 'session_stream_state_changed'; stream: SessionStreamSnapshot }
  | { type: 'run_event'; backendId: string; sessionId: string; event: ServerMessage }
  | { type: 'content_patch'; backendId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number };
```

### 设计要求

- 新 WS 客户端建立连接后必须先收到一份 `facade_snapshot`
- HTTP status 仅提供 provider 初始化信息，不再承担 UI registry 真相源职责
- backend registry/list 一律由 facade WS snapshot 和 facade 事件驱动

## server 内部模块划分

建议在 server 内部新增独立的 embedded facade runtime 层：

- `EmbeddedBackendFacadeRuntime`
- `FacadeRegistryStore`
- `FacadeBackendSessionManager`
- `FacadeStreamManager`
- `FacadeWsHub`

### EmbeddedBackendFacadeRuntime

职责：

- 持有 facade 全量状态
- 订阅 `GatewayClient`
- 协调 backend open/close
- 协调 stream open/close
- 构造 facade snapshot
- 向 `FacadeWsHub` 广播 facade 事件

### FacadeRegistryStore

职责：

- 维护 backend registry
- 维护 backend runtime/open/channel state
- 维护 localBackendId、currentInstanceId、currentDeviceId

### FacadeBackendSessionManager

职责：

- 维护每个 backend 的 session catalog
- 消费 catalog snapshot/event/reset

### FacadeStreamManager

职责：

- 维护多路 session stream 的 desired state 和 runtime state
- backend 恢复时自动恢复 `shouldBeOpen=true` 的 stream

### FacadeWsHub

职责：

- 管理 `/ws/backend-facade` 连接
- 新连接时发送 `facade_snapshot`
- 广播 facade 事件给 UI

## GatewayClient 与 facade runtime 的边界

`GatewayClient` 应回归为底层 adapter，只负责：

- 连接和重连 gateway
- 处理 gateway 协议
- 上抛结构化底层事件

不再负责：

- 维护 UI 友好的 backend 列表
- 通过轮询向 UI 暴露 status 快照
- 直接拼装 UI 语义状态

## GatewayClient 定位

`GatewayClient` 的正式定位应为：

> backend-peer 侧的 gateway 协议适配器。

它负责：

- 作为上游 gateway 的 protocol client 建立连接与实现协议
- 作为下游 runtime 的 protocol-facing adapter 暴露命令、查询与事实事件
- 维护协议级最小本地状态

它不负责：

- facade snapshot
- UI 友好的 backend 列表
- provider 级状态编排
- 多 active session 的恢复策略

一句话：

`GatewayClient = protocol adapter + protocol-local state + CQE interface`

## GatewayClient -> runtime 事件契约

建议通过统一 handler registry 上抛事件：

```ts
export interface GatewayClientEvents {
  onConnectionStateChanged?: (event: GatewayConnectionStateEvent) => void;
  onRegistrySnapshot?: (event: GatewayRegistrySnapshotEvent) => void;
  onRegistryEvent?: (event: GatewayRegistryEvent) => void;
  onBackendChannelOpened?: (event: GatewayBackendChannelOpenedEvent) => void;
  onBackendChannelClosed?: (event: GatewayBackendChannelClosedEvent) => void;
  onBackendChannelRejected?: (event: GatewayBackendChannelRejectedEvent) => void;
  onCatalogSnapshot?: (event: GatewayCatalogSnapshotEvent) => void;
  onCatalogEvent?: (event: GatewayCatalogEvent) => void;
  onCatalogReset?: (event: GatewayCatalogResetEvent) => void;
  onSessionStreamClosed?: (event: GatewaySessionStreamClosedEvent) => void;
  onContentPatch?: (event: GatewayContentPatchEvent) => void;
  onRunEvent?: (event: GatewayRunEvent) => void;
  onBackendMessage?: (event: GatewayBackendMessageEvent) => void;
}
```

### 事件定义

```ts
export interface GatewayConnectionStateEvent {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  error?: string;
  peerSessionId?: string;
  recoveryToken?: string;
}

export interface GatewayRegistrySnapshotEvent {
  revision: number;
  items: BackendPresence[];
}

export interface GatewayRegistryEvent {
  revision: number;
  op: 'upsert' | 'remove';
  item?: BackendPresence;
  backendId?: string;
}

export interface GatewayBackendChannelOpenedEvent {
  backendId: string;
  channelId: string;
  epoch: number;
  capabilities: string[];
}

export interface GatewayBackendChannelClosedEvent {
  backendId: string;
  channelId: string;
  reason: string;
}

export interface GatewayBackendChannelRejectedEvent {
  backendId: string;
  reason: string;
}

export interface GatewayCatalogSnapshotEvent {
  backendId: string;
  epoch: number;
  revision: number;
  items: SessionCatalogItem[];
}

export interface GatewayCatalogEvent {
  backendId: string;
  epoch: number;
  revision: number;
  op: 'upsert' | 'remove';
  item?: SessionCatalogItem;
  sessionId?: string;
}

export interface GatewayCatalogResetEvent {
  backendId: string;
  epoch: number;
}

export interface GatewaySessionStreamClosedEvent {
  backendId: string;
  channelId: string;
  sessionId: string;
  reason: string;
}

export interface GatewayContentPatchEvent {
  backendId: string;
  channelId: string;
  sessionId: string;
  messages: SessionMessage[];
  latestOffset: number;
}

export interface GatewayRunEvent {
  backendId: string;
  channelId: string;
  sessionId: string;
  event: ServerMessage;
}

export interface GatewayBackendMessageEvent {
  backendId: string;
  channelId: string;
  message: ServerMessage;
}
```

## GatewayClient CQE 结构

既然架构采用一步到位的 `command/query/event`，建议 `GatewayClient` 最终形态为：

```ts
export interface GatewayClient {
  readonly commands: GatewayClientCommands;
  readonly queries: GatewayClientQueries;
  readonly events: GatewayClientEventBus;
}
```

### Commands

`commands` 只表达协议动作，不返回 UI 派生状态。

建议按组划分：

```ts
export interface GatewayClientCommands {
  connection: {
    connect(): void;
    disconnect(): void;
  };

  channel: {
    openBackendChannel(backendId: string, epoch: number): void;
    closeBackendChannel(channelId: string): void;
    sendToBackend(channelId: string, message: ClientMessage): void;
  };

  catalog: {
    subscribe(backendId: string, epoch: number, lastRevision?: number): void;
    unsubscribe(backendId: string, epoch: number): void;
    publishSnapshot(): void;
    publishEvent(eventType: 'upsert' | 'remove', session: unknown): void;
  };

  stream: {
    open(channelId: string, sessionId: string): void;
    close(channelId: string, sessionId: string): void;
    catchUp(channelId: string, sessionId: string, afterOffset: number): void;
    emitRunEvent(
      sessionId: string,
      runId: string,
      eventType: RunStreamEventType,
      seq: number,
      payload: unknown
    ): void;
  };
}
```

#### Commands 边界

留在 `GatewayClient` 的命令：

- 连接命令
- backend channel 协议命令
- catalog 订阅与发布命令
- session stream 协议命令
- backend peer 作为发布方的 run/catalog 事实发布命令

不留在 `GatewayClient` 的命令：

- `openBackend(...)`
- `closeBackend(...)`
- `recoverBackend(...)`
- `resumeDesiredStreams(...)`
- `selectBackend(...)`
- `setActiveSession(...)`

这些都属于 facade/runtime 编排。

### Queries

`queries` 只允许读取 protocol-local state，不允许返回 UI 友好模型。

建议结构：

```ts
export interface GatewayClientQueries {
  bootstrap: {
    getInitialState(): GatewayClientBootstrapState;
  };

  connection: {
    getState(): GatewayConnectionState;
    getPeerSessionId(): string | null;
    getRecoveryToken(): string | null;
  };

  identity: {
    getBackendId(): string | null;
    getEpoch(): number | null;
    getInstanceId(): string;
    getDeviceId(): string;
  };

  registry: {
    getRevision(): number;
    getSnapshot(): Map<string, BackendPresence>;
  };

  channel: {
    get(backendId: string): { backendId: string; channelId: string; epoch: number } | undefined;
    getAll(): Map<string, { backendId: string; channelId: string; epoch: number }>;
  };

  catalog: {
    getRevision(backendId: string): number | undefined;
    getEpoch(backendId: string): number | undefined;
  };

  protocol: {
    getStreamDemandState(): boolean;
  };
}
```

#### Queries 边界

允许保留：

- connection 上下文
- backend peer identity
- registry revision 与原始快照
- channel 映射
- 少量 catalog revision/epoch
- protocol-local 状态，例如 stream demand

禁止继续新增：

- `getDiscoveredBackends()`
- `getVisibleBackends()`
- `getUiBackends()`
- `getReadyBackends()`
- `getSessionStreamState(...)`
- `getFacadeSnapshot()`

这些都越过了 protocol-local 边界。

### Events

`events` 应为单一事实流，而不是 callback registry。

```ts
export interface GatewayClientEventBus {
  subscribe(listener: GatewayClientEventListener): () => void;
}
```

建议使用单一 union event：

```ts
export type GatewayClientEvent =
  | GatewayConnectionStateChangedEvent
  | GatewayRegistrySnapshotReceivedEvent
  | GatewayRegistryEventReceivedEvent
  | GatewayBackendChannelOpenedEvent
  | GatewayBackendChannelClosedEvent
  | GatewayBackendChannelRejectedEvent
  | GatewayCatalogSnapshotReceivedEvent
  | GatewayCatalogEventReceivedEvent
  | GatewayCatalogResetReceivedEvent
  | GatewaySessionStreamClosedEvent
  | GatewayContentPatchReceivedEvent
  | GatewayRunEventReceivedEvent
  | GatewayBackendMessageReceivedEvent;
```

事件命名要求使用“已发生事实”的过去式，例如：

- `connection_state_changed`
- `registry_snapshot_received`
- `backend_channel_opened`
- `catalog_reset_received`
- `content_patch_received`

禁止出现：

- `backend_ready`
- `facade_snapshot_updated`
- `stream_should_resume`
- `ui_connection_status_changed`

这些都属于 facade/runtime/UI 语义，不属于 adapter 事件。

### Event 投递语义

建议明确写入契约：

- 所有事件按接收顺序串行投递
- 同一 listener 不会并发重入
- listener 抛错不会中断后续事件
- `GatewayClient` 不保证事件重放
- 新订阅者不会收到历史事件
- 初始化基线必须通过 `queries.bootstrap.getInitialState()` 获取

## GatewayClient bootstrap 初始化语义

建议 runtime 使用：

> `subscribe -> buffer events -> query bootstrap -> replay buffer -> live mode`

而不是：

- 纯 query bootstrap
- 纯 event bootstrap

推荐原因：

- 避免 query 与 live event 之间的竞态窗口丢事实
- 不需要引入复杂 bootstrap replay 协议
- queries 仅作为初始化基线使用，后续主链路仍然纯事件驱动

### bootstrap state

建议结构如下：

```ts
export interface GatewayClientBootstrapState {
  capturedAt: number;

  connection: {
    state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
    peerSessionId: string | null;
    recoveryToken: string | null;
    lastError?: string;
  };

  identity: {
    backendId: string | null;
    epoch: number | null;
    instanceId: string;
    deviceId: string;
  };

  registry: {
    revision: number;
    items: BackendPresence[];
  };

  channels: {
    items: Array<{
      backendId: string;
      channelId: string;
      epoch: number;
    }>;
  };
}
```

### bootstrap 设计约束

允许包含：

- connection
- identity
- registry
- channels

不建议第一阶段包含：

- catalog items
- session streams
- facade snapshot
- UI 派生状态

### runtime 初始化流程

建议步骤：

1. runtime 先订阅 `GatewayClient.events`
2. 初始化阶段收到的事件进入 FIFO bootstrap buffer
3. runtime 调 `queries.bootstrap.getInitialState()`
4. 以 bootstrap 构建初始 protocol-local 基线
5. 按顺序重放 bootstrap buffer
6. runtime 标记 `initialized=true`
7. 后续进入 live mode

### 合并规则

- events 永远是最新事实
- queries 只是 bootstrap 基线
- query 只能补缺，不能回滚已通过 event 获得的更新状态
- 所有可比较状态应以 revision / epoch / 顺序为主，不依赖 `capturedAt`

## Identity 模型

系统中的关键标识分为三层：

### 主体身份

- `deviceId`
- `instanceId`
- `backendId`

### 会话身份

- `peerSessionId`
- `recoveryToken`

### 版本身份

- `epoch`

## Identity 定义

### deviceId

- 含义：设备级身份
- 生成方：本地生成并持久化
- 生命周期：最长，通常跨重启稳定
- 表达：是不是同一台设备
- 不表达：实例边界、backend 会话边界、恢复权限

### instanceId

- 含义：当前运行实例身份
- 生成方：本地生成或基于本地身份稳定派生
- 生命周期：中等，比 `peerSessionId` 长，比 `deviceId` 可短
- 表达：是不是同一个运行实例
- 不表达：永久设备身份、gateway 会话身份、恢复权限

### backendId

- 含义：backend 逻辑身份
- 生成方：gateway 根据 identity 规则分配或稳定映射
- 生命周期：长，应跨 peer session 与临时断线尽量稳定
- 表达：这是哪个 backend
- 不表达：当前连接是否活着、当前 owner lease 是否有效

### peerSessionId

- 含义：当前 gateway peer 会话身份
- 生成方：gateway
- 生命周期：短，一次 peer 连接上下文一个
- 表达：当前这条 peer 连接是谁
- 不表达：backend identity、设备 identity、恢复授权本身

### recoveryToken

- 含义：peer-session scoped 恢复凭证
- 生成方：gateway
- 生命周期：与 `peerSessionId` 同级或更短
- 表达：我是刚才那个 peer session 的合法续接者
- 不表达：设备 identity、实例 identity、backend identity、长期 auth token

### epoch

- 含义：backend owner/lease 版本号
- 生成方：gateway
- 生命周期：租约级或代际级，owner 替换时变化
- 表达：当前 backend 属于哪一代 owner/version
- 不表达：backend 永久身份、peer session 身份、恢复凭证

## Identity 可见性

UI 可直接依赖：

- `backendId`

UI 只能依赖派生值：

- `deviceId -> isThisDevice`
- `instanceId -> isThisInstance`

UI 不应感知：

- `peerSessionId`
- `recoveryToken`
- `epoch`

## Identity 约束

- 不能用 `peerSessionId` 代替 `backendId`
- 不能用 `recoveryToken` 代替 identity
- 不能把 `epoch` 当作 backend identity
- `backendId + epoch` 用于表达当前这代 backend owner
- `peerSessionId + recoveryToken` 用于表达当前 peer session 及其恢复能力

## recoveryToken 定位

`recoveryToken` 的正式定义：

> session-scoped recovery capability token

它证明的不是“我这个设备还是我”，而是：

> 我是刚才那个 peer session 的合法续接者。

因此它属于：

- transport/session recovery credential

而不属于：

- identity token
- facade-level concept
- UI auth token
- 长期持久化凭证

## runtime backend 状态推导

runtime 不应直接从单一字段推导 facade backend 状态，而应基于多个底层事实：

- registry presence
- current epoch
- channel presence
- catalog initialization state
- last error / last closure reason

建议内部维护：

```ts
interface BackendRuntimeRecord {
  backendId: string;

  presence: BackendPresence | null;
  currentEpoch: number | null;

  channelId: string | null;
  channelEpoch: number | null;

  catalogInitialized: boolean;
  catalogEpoch: number | null;

  lastError?: string;
  lastClosureReason?: string;

  runtimeState: BackendRuntimeState;
  openState: BackendOpenState;
}
```

### openState 与 runtimeState

二者必须分离：

- `openState` 表示 channel 生命周期：`closed/opening/open/closing/error`
- `runtimeState` 表示 facade 语义状态：`offline/visible/opening/ready/degraded/error`

`openState=open` 不等于 `runtimeState=ready`。

### 推荐推导规则

1. `presence == null` -> `runtimeState=offline`
2. `presence != null && channelId == null` -> `runtimeState=visible`
3. `openState == opening` -> `runtimeState=opening`
4. `channelId != null && catalogInitialized == false` -> `runtimeState=opening`
5. `presence + channel + catalog 均有效且 epoch 对齐` -> `runtimeState=ready`
6. backend 在线但能力部分受损且不立即自动恢复 -> `runtimeState=degraded`
7. channel 被拒绝或明确失败 -> `runtimeState=error`

### epoch 对齐要求

建议至少要求：

- `presence.epoch === channelEpoch`
- `presence.epoch === catalogEpoch`

跨代状态必须失效，不能继续信任。

### degraded 使用约束

仅在以下情况下进入：

- backend 仍在线
- 仍有部分能力
- 但能力不完整且不会立刻自动恢复

若处于自动恢复中，建议使用 `opening`，而非滥用 `degraded`。

## Session stream 模型

系统明确支持多 active session，因此 session stream 必须是多路模型，而非单例模型。

### stream 分类

建议将 stream 分为三类：

- `desired stream`
- `managed runtime stream`
- `ephemeral runtime stream`

#### desired stream

满足：

- 存在业务意图
- `desired.shouldBeOpen = true`

这类 stream 永不因 GC 自动删除。

#### managed runtime stream

满足：

- 曾经存在或当前存在对应 desired state
- 当前有 runtime state

#### ephemeral runtime stream

满足：

- 没有 desired state
- 仅因被动观察到 `run_event` / `content_patch` 而创建 runtime state

这类 stream 生命周期应最短。

### 数据结构

```ts
interface DesiredSessionStream {
  streamKey: string;
  backendId: string;
  sessionId: string;
  shouldBeOpen: boolean;
  autoResume: boolean;
  openedAt: number;
  updatedAt: number;
}

interface SessionStreamRuntime {
  streamKey: string;
  backendId: string;
  sessionId: string;

  state: SessionStreamState;
  channelId: string | null;

  latestOffset?: number;
  lastError?: string;
  lastCloseReason?: string;

  source: 'desired' | 'ephemeral';
  lastActivityAt: number;

  openedAt?: number;
  closedAt?: number;
  updatedAt: number;
}
```

### stream 状态机

```ts
closed -> opening -> open
open -> closing -> closed
opening/open -> error
```

规则：

- `opening` 表示已发起或正在等待自动恢复
- `open` 表示流已真正可用
- `error` 表示当前流无法自动维持在可用态
- `closing` 仅为短期过渡态，不应长期停留

## FacadeStreamManager

`FacadeStreamManager` 负责：

- 维护 `desiredStreams`
- 维护 `runtimeStreams`
- 响应 backend/channel 状态变化
- 执行 stream 自动恢复
- 处理 `run_event`、`content_patch`、`session_stream_closed`

它不负责：

- backend registry
- backend 主状态机
- facade snapshot
- UI 广播

### 对 runtime 暴露的最小接口

```ts
interface FacadeStreamManager {
  applyBootstrap(): void;

  requestOpen(
    backendId: string,
    sessionId: string,
    context: { backendReady: boolean; channelId: string | null; latestKnownOffset?: number }
  ): StreamManagerResult;

  requestClose(
    backendId: string,
    sessionId: string,
    context: { channelId: string | null }
  ): StreamManagerResult;

  handleBackendBecameReady(
    backendId: string,
    channelId: string
  ): StreamManagerResult;

  handleBackendLostChannel(
    backendId: string,
    reason: string,
    context: { willAutoRecover: boolean }
  ): StreamManagerResult;

  handleSessionStreamClosed(
    backendId: string,
    channelId: string,
    sessionId: string,
    reason: string
  ): StreamManagerResult;

  handleContentPatch(
    backendId: string,
    channelId: string,
    sessionId: string,
    messages: SessionMessage[],
    latestOffset: number
  ): StreamManagerResult;

  handleRunEvent(
    backendId: string,
    channelId: string,
    sessionId: string,
    event: ServerMessage
  ): StreamManagerResult;

  collectGarbage(now: number): StreamManagerResult;

  getStream(backendId: string, sessionId: string): SessionStreamSnapshot | undefined;
  getAllStreams(): SessionStreamSnapshot[];
}
```

### 返回结构

```ts
interface StreamManagerResult {
  commands: StreamCommand[];
  events: StreamEvent[];
}
```

### Commands 与 Events

```ts
type StreamCommand =
  | { type: 'open_session_stream'; backendId: string; channelId: string; sessionId: string }
  | { type: 'close_session_stream'; backendId: string; channelId: string; sessionId: string }
  | { type: 'catch_up_content'; backendId: string; channelId: string; sessionId: string; afterOffset: number };

type StreamEvent =
  | { type: 'session_stream_state_changed'; stream: SessionStreamSnapshot }
  | { type: 'content_patch'; backendId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number }
  | { type: 'run_event'; backendId: string; sessionId: string; event: ServerMessage };
```

规则：

- `StreamManager` 自己不能直接调 `GatewayClient.commands`
- 它只能返回 `StreamCommand[]`
- runtime 统一负责执行 command

### 核心方法行为

#### `requestOpen`

- 总是 upsert desired state：`shouldBeOpen = true`
- backend ready 时，进入 `opening` 并返回 `open_session_stream` command
- backend 不 ready 时，只进入 `opening`，不立即返回 command
- 幂等：重复 open 不应重复发相同 command

#### `requestClose`

- 总是先把 `desired.shouldBeOpen = false`
- 当前 `open/opening/error` 时，进入 `closing`
- 若有 `channelId`，返回 `close_session_stream` command
- 第一阶段采用乐观本地闭合：最终尽快进入 `closed`

#### `handleBackendBecameReady`

- 仅处理该 backend 下的 streams
- 仅恢复 `shouldBeOpen = true && autoResume = true` 的 streams
- 已 `open` 的 stream 不重复恢复
- 恢复时清空旧 `lastError`

#### `handleBackendLostChannel`

- 若 `shouldBeOpen = false`，直接落 `closed`
- 若 `shouldBeOpen = true && willAutoRecover = true`，进入 `opening`
- 若 `shouldBeOpen = true && willAutoRecover = false`，进入 `error`
- 不应唤醒原本已经 `closed` 的 stream

### `run_event` 与 `content_patch`

#### `handleRunEvent`

- 不隐式创建 desired state
- 允许创建最小 runtime state
- 若当前 stream 为 `opening/error`，可推进到 `open`
- 不负责更新 `latestOffset`
- 总是输出 `run_event`

#### `handleContentPatch`

- 不隐式创建 desired state
- 允许创建最小 runtime state
- 若当前 stream 为 `opening/error`，可推进到 `open`
- 更新 `latestOffset = max(old, new)`
- stale patch 默认忽略
- 输出 `content_patch`

### stream 自动恢复策略

默认策略：

- 只要 `desired.shouldBeOpen = true && autoResume = true`
- backend 恢复 ready 后自动 reopen

backend 未 ready 时，open 请求不失败，而是：

- 记录 desired state
- runtime state 进入 `opening`

## stream runtime 回收策略

### 永不回收

- `desired.shouldBeOpen = true`
- runtime.state in `opening/open`

### 短期保留

- 用户主动关闭后的 `closed`
- 最近的 ephemeral `closed/error`

### 中期保留

- managed `error`

### 最终删除

- `shouldBeOpen = false`
- 超过 tombstone TTL
- 无活跃 channel
- 无自动恢复需求

### 默认 TTL 建议

```ts
EPHEMERAL_TTL = 2 * 60_000
CLOSED_TOMBSTONE_TTL = 10 * 60_000
ERROR_TOMBSTONE_TTL = 30 * 60_000
GC_INTERVAL = 60_000
```

### GC 规则

建议提供：

```ts
collectGarbage(now: number): StreamManagerResult
```

GC 只应该清理：

- stale ephemeral runtime streams
- 长时间 `closed` 且无 desired state 的 managed streams
- 长时间 `error` 且无 desired state 的 managed streams

GC 不应被视为业务事件：

- GC 不应额外发出“stream closed”类业务事件
- runtime 可在下次 snapshot 中自然反映其消失

## snapshot 广播策略

### 基本原则

使用：

> snapshot for baseline, events for progression

也就是：

- snapshot 用于建立基线
- event 用于推进状态

### 必发 snapshot 的场景

- 新 facade ws client 建立连接
- runtime 完成 bootstrap，首次进入 initialized
- gateway 重连后 runtime 完成重建
- runtime 显式判定发生大规模 state rebuild / manual resync

### 只发 event 的场景

- 普通 backend 状态变化
- catalog snapshot / event / reset
- stream 状态变化
- `run_event`
- `content_patch`

### snapshot 结构建议增加版本

```ts
interface BackendFacadeSnapshot {
  snapshotVersion: number;
  capturedAt: number;
  ...
}
```

说明：

- `snapshotVersion` 由 runtime 单调递增
- UI 收到 snapshot 时，可将其作为新的全量基线

### 初始化期广播策略

runtime bootstrap 流程：

- subscribe events
- buffer live events
- query bootstrap
- replay buffer
- initialized

初始化期不对外广播 event。

初始化完成后：

- 直接发第一份全量 `facade_snapshot`
- 后续进入正常 event 模式

### 定时 snapshot

默认不做定时全量 snapshot。

snapshot 应是事件驱动、按需发送，而不是周期性全量同步。

## FacadeWsHub

`FacadeWsHub` 是 facade runtime 的 WebSocket 分发层。

负责：

- 管理 `/ws/backend-facade` 客户端连接
- 新连接时发送一份当前 `facade_snapshot`
- runtime 产生 facade event 后广播给所有客户端
- 接收 UI 发来的 facade 命令并转交 runtime

不负责：

- backend 状态
- stream 状态
- snapshot 组装
- gateway 协议命令执行

### runtime 关系

建议关系固定为：

- runtime 产出 `getSnapshot()`
- runtime 产出 facade event 订阅接口
- hub 仅负责分发

### 建议接口

```ts
interface FacadeWsHub {
  attachClient(ws: WebSocket): void;
  detachClient(ws: WebSocket): void;

  start(): void;
  stop(): void;
}
```

### 客户端 session

```ts
interface FacadeClientSession {
  clientId: string;
  ws: WebSocket;
  subscribed: boolean;
  connectedAt: number;
}
```

不建议在 hub 内维护：

- per-client backend state
- per-client stream state
- per-client snapshot 副本

### 新连接流程

推荐顺序：

1. ws 建立
2. hub 注册 client session
3. 从 runtime 读取当前 snapshot
4. 立即发送 `facade_snapshot`
5. 后续接收 live events

### event 广播策略

- runtime 产出 facade event
- hub fan-out 给所有已连接客户端

第一阶段不做 per-client event replay buffer。

### 慢消费者策略

若某 ws 客户端发送阻塞或明显跟不上：

- hub 直接断开该客户端
- 客户端重连后重新拿 snapshot

### UI 命令处理

hub 仅做：

- 协议反序列化
- 基础校验
- 调 runtime

例如：

- `open_backend -> runtime.openBackend(...)`
- `open_session_stream -> runtime.openSessionStream(...)`
- `catch_up_content -> runtime.catchUpContent(...)`

### 错误返回策略

- 非法消息格式：hub 可直接返回 `facade_error`
- 业务执行失败：主要通过后续状态流体现，而非 request/response ack

第一阶段不强制引入 `command_ack`。

## Runtime / RegistryStore / StreamManager 协作边界

### 模块职责

`FacadeRegistryStore` 负责：

- backend registry
- current epoch
- channelId / channelEpoch
- catalog initialized
- backend runtimeState/openState

`FacadeStreamManager` 负责：

- desiredStreams
- runtimeStreams
- stream auto resume
- content patch / run event 路由

`EmbeddedBackendFacadeRuntime` 负责：

- 接收 `GatewayClient` 事件
- 协调 `RegistryStore`
- 协调 `StreamManager`
- 组装 `BackendFacadeSnapshot`
- 广播 facade events

### 依赖方向

必须固定成单向：

`GatewayClient -> Runtime -> RegistryStore / StreamManager -> WsHub`

约束：

- `RegistryStore` 和 `StreamManager` 不直接互调
- backend 对 stream 的影响，由 runtime 显式桥接

### RegistryStore 对 runtime 的最小接口

```ts
interface FacadeRegistryStore {
  applyBootstrap(state: GatewayClientBootstrapState): void;

  applyRegistrySnapshot(revision: number, items: BackendPresence[]): BackendStateDiff[];
  applyRegistryEvent(event: GatewayRegistryEventReceivedEvent): BackendStateDiff[];

  markChannelOpening(backendId: string, epoch: number): BackendStateDiff[];
  markChannelOpened(backendId: string, channelId: string, epoch: number, capabilities: string[]): BackendStateDiff[];
  markChannelClosed(backendId: string, channelId: string, reason: string, epoch?: number): BackendStateDiff[];
  markChannelRejected(backendId: string, reason: string, epoch?: number): BackendStateDiff[];

  markCatalogInitialized(backendId: string, epoch: number): BackendStateDiff[];
  markCatalogReset(backendId: string, epoch: number): BackendStateDiff[];

  getBackend(backendId: string): BackendRuntimeRecord | undefined;
  getAllBackends(): BackendRuntimeRecord[];
}
```

### StreamManager 对 runtime 的最小接口

见前述 `FacadeStreamManager` 定义。

### BackendStateDiff

```ts
interface BackendStateDiff {
  backendId: string;
  previousRuntimeState?: BackendRuntimeState;
  nextRuntimeState: BackendRuntimeState;
  previousOpenState?: BackendOpenState;
  nextOpenState: BackendOpenState;
  reason?: string;
}
```

### 协作原则

- `GatewayClient` 只发事实
- `RegistryStore` 只管 backend
- `StreamManager` 只管 stream
- runtime 是唯一协调者
- runtime 是唯一 snapshot 组装者
- runtime 是唯一底层 command 执行者

## 下一阶段待设计项

以下内容尚未展开，应作为下一阶段讨论主题：

1. `EmbeddedBackendFacadeRuntime` 的具体接口与方法签名
2. runtime 内部统一事件入口，例如 `handleGatewayClientEvent(event)`
3. runtime 如何执行 `StreamCommand[]` 并桥接 `GatewayClient.commands`
4. `DirectBackendFacadeProvider` 如何映射到同一套 facade 模型
5. direct provider 是否完全复用现有 `GatewayTransport`
6. facade 与现有前端 stores 的对接方式
7. facade 端到端测试矩阵

## store 方向

最终 UI 只应保留 facade 语义的状态面。

建议方向：

- `serverStore` 逐步转向选中 backend handle 和 UI 展示态
- `sessionsStore` 继续负责 session catalog 与消息缓存
- 现有 `gatewayStore` 逐步退出核心路径，最终改名或收缩成 facade config store

## 实施顺序建议

### Phase 1

- 引入 `BackendFacade` 接口
- 引入 `DirectBackendFacadeProvider`
- desktop 增加 embedded facade WS / HTTP 入口
- UI 主链路改为消费 facade snapshot / facade events

### Phase 2

- server 内实现 `EmbeddedBackendFacadeRuntime`
- `GatewayClient` 事件化
- facade runtime 接管 registry / backend / stream 状态聚合

### Phase 3

- 删除旧 desktop gateway 特殊分支
- 收缩 `gatewayStore`
- 删除基于 gateway status 轮询的双控制面
- 重建与 facade 契约对应的集成测试

## FacadeRuntimeGatewayAdapter 统一契约

### 动机

前述设计中，`EmbeddedBackendFacadeRuntime` 直接依赖 `GatewayClient`。但 `DirectBackendFacadeProvider` 同样需要 registry、channel、stream、catalog 等能力，只是协议承载方式不同：

- embedded：server 进程内的 `GatewayClient`（backend-peer 兼 client-peer）
- direct：UI 进程内的 `GatewayTransport`（纯 client-peer）

如果 runtime 直接绑定具体实现，就无法共享核心编排逻辑。

解法：提取 `FacadeRuntimeGatewayAdapter` 作为 runtime 对 gateway 协议的唯一依赖面，embedded 和 direct 各自实现该 adapter。

### 架构关系

```
┌─────────────────────────────────────────────────┐
│           BackendFacadeRuntimeCore              │
│  ┌──────────────┐  ┌───────────────────┐        │
│  │RegistryStore │  │  StreamManager    │        │
│  └──────────────┘  └───────────────────┘        │
│                                                 │
│  depends on: FacadeRuntimeGatewayAdapter         │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────┴────────┐    ┌───────────┴──────────┐
│  Embedded      │    │  Direct              │
│  GatewayAdapter│    │  GatewayAdapter      │
│                │    │                      │
│  wraps:        │    │  wraps:              │
│  GatewayClient │    │  GatewayTransport    │
│  (server-side) │    │  (client-side)       │
└────────────────┘    └──────────────────────┘
```

### adapter CQE 接口

`FacadeRuntimeGatewayAdapter` 采用与 `GatewayClient` 相同的 CQE 范式，但只暴露 facade runtime 需要的子集。

```ts
export interface FacadeRuntimeGatewayAdapter {
  readonly commands: FacadeAdapterCommands;
  readonly queries: FacadeAdapterQueries;
  readonly events: FacadeAdapterEventBus;
}
```

#### Commands

```ts
export interface FacadeAdapterCommands {
  connection: {
    connect(): void;
    disconnect(): void;
  };

  channel: {
    openBackendChannel(backendId: string, epoch: number): void;
    closeBackendChannel(channelId: string): void;
    sendToBackend(channelId: string, message: ClientMessage): void;
  };

  catalog: {
    subscribe(backendId: string, epoch: number, lastRevision?: number): void;
    unsubscribe(backendId: string, epoch: number): void;
  };

  stream: {
    open(channelId: string, sessionId: string): void;
    close(channelId: string, sessionId: string): void;
    catchUp(channelId: string, sessionId: string, afterOffset: number): void;
  };
}
```

与 `GatewayClientCommands` 的关键区别：

- 不包含 `catalog.publishSnapshot()` / `catalog.publishEvent()` — 这是 backend-peer 发布方行为，不属于 facade client 视角
- 不包含 `stream.emitRunEvent()` — 同上
- facade runtime 始终以 client-peer 视角消费 backend 能力

#### Queries

```ts
export interface FacadeAdapterQueries {
  bootstrap: {
    getInitialState(): FacadeAdapterBootstrapState;
  };

  connection: {
    getState(): FacadeAdapterConnectionState;
  };

  identity: {
    getInstanceId(): string;
    getDeviceId(): string;
  };

  registry: {
    getRevision(): number;
    getSnapshot(): Map<string, BackendPresence>;
  };

  channel: {
    get(backendId: string): { backendId: string; channelId: string; epoch: number } | undefined;
    getAll(): Map<string, { backendId: string; channelId: string; epoch: number }>;
  };

  http: {
    getBaseUrl(backendId: string): string | null;
    getHeaders(): Record<string, string>;
  };
}
```

与 `GatewayClientQueries` 的关键区别：

- 不包含 `identity.getBackendId()` / `identity.getEpoch()` — 这是 backend-peer 自身 identity，不属于 facade client
- 新增 `http.getBaseUrl()` / `http.getHeaders()` — 因为 HTTP 代理策略在 embedded 和 direct 之间差异显著：
  - embedded：`http://localhost:{embeddedPort}/api/backend-facade/proxy/{backendId}`
  - direct：gateway HTTP proxy 或直连 backend URL

#### Bootstrap State

```ts
export interface FacadeAdapterBootstrapState {
  capturedAt: number;

  connection: {
    state: FacadeAdapterConnectionState;
    lastError?: string;
  };

  identity: {
    instanceId: string;
    deviceId: string;
  };

  registry: {
    revision: number;
    items: BackendPresence[];
  };

  channels: {
    items: Array<{
      backendId: string;
      channelId: string;
      epoch: number;
    }>;
  };
}

export type FacadeAdapterConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';
```

与 `GatewayClientBootstrapState` 的区别：

- 不含 `peerSessionId` / `recoveryToken` — 这些是 transport recovery 细节，adapter 内部消化
- `identity` 只暴露 `instanceId` / `deviceId`，不暴露 `backendId` / `epoch`

#### Events

```ts
export interface FacadeAdapterEventBus {
  subscribe(listener: (event: FacadeAdapterEvent) => void): () => void;
}

export type FacadeAdapterEvent =
  | { type: 'connection_state_changed'; state: FacadeAdapterConnectionState; error?: string }
  | { type: 'registry_snapshot_received'; revision: number; items: BackendPresence[] }
  | { type: 'registry_event_received'; revision: number; op: 'upsert' | 'remove'; item?: BackendPresence; backendId?: string }
  | { type: 'backend_channel_opened'; backendId: string; channelId: string; epoch: number; capabilities: string[] }
  | { type: 'backend_channel_closed'; backendId: string; channelId: string; reason: string }
  | { type: 'backend_channel_rejected'; backendId: string; reason: string }
  | { type: 'catalog_snapshot_received'; backendId: string; epoch: number; revision: number; items: SessionCatalogItem[] }
  | { type: 'catalog_event_received'; backendId: string; epoch: number; revision: number; op: 'upsert' | 'remove'; item?: SessionCatalogItem; sessionId?: string }
  | { type: 'catalog_reset_received'; backendId: string; epoch: number }
  | { type: 'session_stream_closed'; backendId: string; channelId: string; sessionId: string; reason: string }
  | { type: 'content_patch_received'; backendId: string; channelId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number }
  | { type: 'run_event_received'; backendId: string; channelId: string; sessionId: string; event: ServerMessage }
  | { type: 'backend_message_received'; backendId: string; channelId: string; message: ServerMessage };
```

事件契约与 `GatewayClientEvent` 完全同构。这是有意为之 — adapter 的职责是协议适配，不是事件重塑。Runtime 消费 adapter 事件后再生产 facade 语义事件。

#### 事件投递语义

与 `GatewayClient` 相同：

- 按接收顺序串行投递
- 同一 listener 不会并发重入
- listener 抛错不中断后续事件
- 不保证事件重放
- 新订阅者不收到历史事件
- 初始化基线通过 `queries.bootstrap.getInitialState()` 获取

### Embedded adapter 实现要点

`EmbeddedGatewayAdapter` 在 server 进程内运行，wraps `GatewayClient`。

```ts
class EmbeddedGatewayAdapter implements FacadeRuntimeGatewayAdapter {
  constructor(private gatewayClient: GatewayClient) {}
}
```

关键适配：

1. **connection** — 直接代理 `GatewayClient` 的连接状态。embedded server 启动时 `GatewayClient` 已连接，adapter 以 `connected` 为初始状态。

2. **identity** — `instanceId` / `deviceId` 从 `GatewayClient` 获取。注意不暴露 `backendId`（backend-peer 自身身份），因为 facade runtime 关心的是其他 backend 的 backendId。

3. **local backend 过滤** — embedded server 自身也出现在 registry 中。adapter 不做过滤，由 runtime 通过 `instanceId` 比对决定哪个是 local backend。

4. **channel** — 当前 `GatewayClient` 主要作为 backend-peer 接受来自 client 的 channel。作为 facade adapter，它需要额外支持作为 client-peer 主动 open channel 到其他 backend。这是 `GatewayClient` 需要扩展的核心能力。

5. **HTTP proxy** — `getBaseUrl(backendId)` 返回 embedded server 自身的 proxy 路由：`/api/backend-facade/proxy/{backendId}`。embedded server 内部再代理到 gateway HTTP proxy。

#### GatewayClient 扩展需求

当前 `GatewayClient` 是纯 backend-peer。为支持 embedded facade，它需要增加 client-peer 能力：

- 主动 `openBackendChannel(targetBackendId, epoch)` — 以 client 身份向另一个 backend 开 channel
- 接收其他 backend 的 catalog、stream、run event
- 管理多个 outgoing channel（当前只管理 incoming channel）

建议在 `GatewayClient` 内部区分：

```ts
// 现有：作为 backend 接受 client channel
incomingChannels: Map<string, IncomingChannel>;

// 新增：作为 facade client 主动连接其他 backend
outgoingChannels: Map<string, OutgoingChannel>;
```

adapter 只暴露 outgoing 部分给 runtime。

### Direct adapter 实现要点

`DirectGatewayAdapter` 在 UI 进程内运行，wraps `GatewayTransport`。

```ts
class DirectGatewayAdapter implements FacadeRuntimeGatewayAdapter {
  constructor(private transport: GatewayTransport) {}
}
```

关键适配：

1. **connection** — 代理 `GatewayTransport` 的连接状态。transport 内部处理 reconnect、recovery token 等，adapter 只暴露归一化的连接状态。

2. **identity** — `instanceId` / `deviceId` 从 transport 或本地持久化获取。

3. **channel** — 直接映射 `GatewayTransport.openChannel()` / `closeChannel()` / `sendToBackend()`。

4. **HTTP proxy** — `getBaseUrl(backendId)` 通过 gateway HTTP proxy 路由。依赖 `gatewayUrl` 和 auth headers。

5. **catalog/stream** — 直接映射 `GatewayTransport` 已有的 `subscribeCatalog()` / `openSessionStream()` 等方法。

Direct adapter 的实现相对直接，因为 `GatewayTransport` 本身就是 client-peer。

### adapter 内部不做的事

- 不维护 `BackendRuntimeRecord`
- 不维护 `DesiredSessionStream`
- 不组装 facade snapshot
- 不做 backend open/close 编排
- 不做 stream auto-resume
- 不做 epoch 对齐检查

这些全部属于 `BackendFacadeRuntimeCore`。

## BackendFacadeRuntimeCore

### 定位

`BackendFacadeRuntimeCore` 是 embedded 和 direct 共享的 facade 状态编排核心。

它包含前述设计中的所有 runtime 职责：

- 接收 adapter 事件
- 协调 `FacadeRegistryStore`
- 协调 `FacadeStreamManager`
- 组装 `BackendFacadeSnapshot`
- 产出 facade 语义事件

### 构造

```ts
interface BackendFacadeRuntimeCoreOptions {
  adapter: FacadeRuntimeGatewayAdapter;
  mode: BackendFacadeMode;
  localBackendMatcher?: (presence: BackendPresence, identity: { instanceId: string; deviceId: string }) => boolean;
}

class BackendFacadeRuntimeCore {
  constructor(options: BackendFacadeRuntimeCoreOptions) {}
}
```

`localBackendMatcher` 的用途：

- embedded 模式下，需要识别 registry 中哪个 backend 是 embedded server 自身
- direct 模式下，通常无 local backend，该函数返回 `false` 或不提供
- 判定规则由外部注入，runtime 不硬编码 instanceId 比对逻辑

### 对外接口

`BackendFacadeRuntimeCore` 对外暴露的接口即前述 `BackendFacade` 接口的完整实现：

```ts
interface BackendFacadeRuntimeCore {
  // lifecycle
  start(): void;
  stop(): void;

  // BackendFacade 接口实现
  getSnapshot(): BackendFacadeSnapshot;
  subscribe(listener: (snapshot: BackendFacadeSnapshot) => void): () => void;
  onEvent(listener: (event: BackendFacadeEvent) => void): () => void;

  openBackend(backendId: string): void;
  closeBackend(backendId: string): void;

  sendToBackend(backendId: string, message: ClientMessage): void;

  openSessionStream(backendId: string, sessionId: string): void;
  closeSessionStream(backendId: string, sessionId: string): void;

  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void;

  getHttpBaseUrl(backendId: string): string | null;
  getHttpHeaders(): Record<string, string>;
}
```

### 内部事件处理入口

runtime 内部使用单一事件入口处理 adapter 事件：

```ts
private handleAdapterEvent(event: FacadeAdapterEvent): void {
  switch (event.type) {
    case 'connection_state_changed':
      this.handleConnectionStateChanged(event);
      break;
    case 'registry_snapshot_received':
      this.handleRegistrySnapshot(event);
      break;
    case 'registry_event_received':
      this.handleRegistryEvent(event);
      break;
    case 'backend_channel_opened':
      this.handleBackendChannelOpened(event);
      break;
    case 'backend_channel_closed':
      this.handleBackendChannelClosed(event);
      break;
    case 'backend_channel_rejected':
      this.handleBackendChannelRejected(event);
      break;
    case 'catalog_snapshot_received':
      this.handleCatalogSnapshot(event);
      break;
    case 'catalog_event_received':
      this.handleCatalogEvent(event);
      break;
    case 'catalog_reset_received':
      this.handleCatalogReset(event);
      break;
    case 'session_stream_closed':
      this.handleSessionStreamClosed(event);
      break;
    case 'content_patch_received':
      this.handleContentPatch(event);
      break;
    case 'run_event_received':
      this.handleRunEvent(event);
      break;
    case 'backend_message_received':
      this.handleBackendMessage(event);
      break;
  }
}
```

### 核心编排流程

以 `handleBackendChannelOpened` 为例：

```ts
private handleBackendChannelOpened(event: BackendChannelOpenedEvent): void {
  // 1. 更新 registry store
  const diffs = this.registryStore.markChannelOpened(
    event.backendId, event.channelId, event.epoch, event.capabilities
  );

  // 2. 订阅该 backend 的 catalog
  this.adapter.commands.catalog.subscribe(event.backendId, event.epoch);

  // 3. 检查是否触发 stream 自动恢复（catalog 初始化后再恢复，此处只记录 channel ready）
  // stream 恢复延迟到 catalog initialized 后

  // 4. 产出 facade event
  for (const diff of diffs) {
    this.emitFacadeEvent({
      type: 'backend_state_changed',
      backendId: diff.backendId,
      state: diff.nextRuntimeState,
    });
  }
}

private handleCatalogSnapshot(event: CatalogSnapshotReceivedEvent): void {
  // 1. 标记 catalog 已初始化
  const diffs = this.registryStore.markCatalogInitialized(event.backendId, event.epoch);

  // 2. 广播 catalog
  this.emitFacadeEvent({
    type: 'catalog_snapshot',
    backendId: event.backendId,
    items: event.items,
  });

  // 3. 检查 backend 是否已达 ready
  const backend = this.registryStore.getBackend(event.backendId);
  if (backend && backend.runtimeState === 'ready') {
    // 4. 触发 stream 自动恢复
    const result = this.streamManager.handleBackendBecameReady(
      event.backendId, backend.channelId!
    );
    this.executeStreamResult(result);
  }

  // 5. 广播 state diff
  for (const diff of diffs) {
    this.emitFacadeEvent({
      type: 'backend_state_changed',
      backendId: diff.backendId,
      state: diff.nextRuntimeState,
    });
  }
}
```

### StreamCommand 执行桥接

runtime 统一负责将 `StreamCommand[]` 翻译为 adapter commands：

```ts
private executeStreamResult(result: StreamManagerResult): void {
  // 执行 commands
  for (const cmd of result.commands) {
    switch (cmd.type) {
      case 'open_session_stream':
        this.adapter.commands.stream.open(cmd.channelId, cmd.sessionId);
        break;
      case 'close_session_stream':
        this.adapter.commands.stream.close(cmd.channelId, cmd.sessionId);
        break;
      case 'catch_up_content':
        this.adapter.commands.stream.catchUp(cmd.channelId, cmd.sessionId, cmd.afterOffset);
        break;
    }
  }

  // 广播 events
  for (const evt of result.events) {
    this.emitFacadeEvent(evt);
  }
}
```

注意 `StreamCommand` 中的 `backendId` 不直接传给 adapter — adapter 的 stream commands 接受 `channelId`，而 `backendId -> channelId` 的解析由 `StreamManager` 在生成 command 时已完成（通过 runtime 传入的 context）。

### bootstrap 流程

runtime 启动时遵循前述 subscribe-buffer-bootstrap-replay 模式：

```ts
start(): void {
  // 1. 订阅 adapter 事件，buffer 模式
  this.eventBuffer = [];
  this.unsubscribe = this.adapter.events.subscribe(event => {
    if (!this.initialized) {
      this.eventBuffer.push(event);
    } else {
      this.handleAdapterEvent(event);
    }
  });

  // 2. 获取 bootstrap state
  const bootstrap = this.adapter.queries.bootstrap.getInitialState();

  // 3. 初始化 registry store
  this.registryStore.applyBootstrap(bootstrap);

  // 4. 初始化 stream manager
  this.streamManager.applyBootstrap();

  // 5. 记录 identity
  this.currentInstanceId = bootstrap.identity.instanceId;
  this.currentDeviceId = bootstrap.identity.deviceId;

  // 6. 识别 local backend
  if (this.options.localBackendMatcher) {
    for (const item of bootstrap.registry.items) {
      if (this.options.localBackendMatcher(item, bootstrap.identity)) {
        this.localBackendId = item.backendId;
        break;
      }
    }
  }

  // 7. replay buffered events
  for (const event of this.eventBuffer) {
    this.handleAdapterEvent(event);
  }
  this.eventBuffer = null;

  // 8. 标记已初始化
  this.initialized = true;

  // 9. 发出首份全量 snapshot
  this.emitFacadeEvent({
    type: 'snapshot_updated',
    snapshot: this.getSnapshot(),
  });
}
```

## Provider 与 RuntimeCore 的关系

### EmbeddedBackendFacadeProvider

```ts
class EmbeddedBackendFacadeProvider implements BackendFacade {
  private adapter: EmbeddedGatewayAdapter;
  private core: BackendFacadeRuntimeCore;
  private wsHub: FacadeWsHub;

  constructor(gatewayClient: GatewayClient, embeddedPort: number) {
    this.adapter = new EmbeddedGatewayAdapter(gatewayClient);
    this.core = new BackendFacadeRuntimeCore({
      adapter: this.adapter,
      mode: 'embedded',
      localBackendMatcher: (presence, identity) =>
        presence.instanceId === identity.instanceId,
    });
    this.wsHub = new FacadeWsHub(this.core);
  }

  // BackendFacade 方法全部委托给 core
  connect() { this.core.start(); }
  disconnect() { this.core.stop(); }
  getSnapshot() { return this.core.getSnapshot(); }
  // ...
}
```

embedded provider 额外拥有 `FacadeWsHub`，负责将 facade 能力暴露给 UI WS 客户端。

### DirectBackendFacadeProvider

```ts
class DirectBackendFacadeProvider implements BackendFacade {
  private adapter: DirectGatewayAdapter;
  private core: BackendFacadeRuntimeCore;

  constructor(transport: GatewayTransport) {
    this.adapter = new DirectGatewayAdapter(transport);
    this.core = new BackendFacadeRuntimeCore({
      adapter: this.adapter,
      mode: 'direct',
      // direct 模式无 local backend
    });
  }

  // BackendFacade 方法全部委托给 core
  connect() { this.core.start(); }
  disconnect() { this.core.stop(); }
  getSnapshot() { return this.core.getSnapshot(); }
  // ...
}
```

direct provider 无 WsHub — UI 直接持有 `BackendFacade` 引用，无需 WS 中转。

### 关键约束

- `BackendFacadeRuntimeCore` 不感知自己运行在 server 还是 UI 进程
- `FacadeRuntimeGatewayAdapter` 不感知 facade 状态模型
- provider 是组装层，负责选择 adapter、创建 core、挂载 transport（WsHub 或直接引用）
- `FacadeRegistryStore` 和 `FacadeStreamManager` 只被 `BackendFacadeRuntimeCore` 持有，不被 adapter 或 provider 直接访问

## embedded 模式下的 local backend 特殊处理

embedded 模式下，embedded server 自身既是一个 backend-peer（通过 `GatewayClient` 注册），又是 facade runtime 的宿主。这导致 local backend 在 facade 中有特殊语义：

### local backend channel

对于 local backend，facade runtime **不需要**通过 gateway 开 channel — 它直接在同一进程内。

建议策略：

- `EmbeddedGatewayAdapter` 对 local backend 的 channel 操作做短路处理
- `openBackendChannel(localBackendId, epoch)` 不走 gateway 协议，而是立即返回一个虚拟 channel
- `sendToBackend(localChannelId, message)` 直接路由到进程内 server handler
- adapter 合成 `backend_channel_opened` 事件给 runtime

```ts
// EmbeddedGatewayAdapter 内部
openBackendChannel(backendId: string, epoch: number): void {
  if (backendId === this.localBackendId) {
    // 短路：不走 gateway
    const virtualChannelId = `local:${backendId}:${epoch}`;
    this.emitEvent({
      type: 'backend_channel_opened',
      backendId,
      channelId: virtualChannelId,
      epoch,
      capabilities: this.getLocalCapabilities(),
    });
    return;
  }
  // 远程 backend：走 gateway
  this.gatewayClient.openOutgoingChannel(backendId, epoch);
}
```

这样 runtime core 完全不需要区分 local 和 remote — 都是走 adapter，adapter 内部决定是短路还是走协议。

### local backend HTTP

`getBaseUrl(localBackendId)` 直接返回 `http://localhost:{port}`，无需走 proxy。

### local backend catalog

local backend 的 catalog 变更，adapter 可以直接从 server 内部订阅，无需走 gateway catalog 协议：

- adapter 直接监听 server 内部的 catalog 变更事件
- 合成 `catalog_snapshot_received` / `catalog_event_received` 事件给 runtime

同样，runtime core 无感。

## direct 模式下的 HTTP proxy

direct 模式下，UI 无法直连 backend HTTP（backend 可能在 NAT 后面）。

HTTP 请求通过 gateway 代理：

```ts
// DirectGatewayAdapter 内部
getBaseUrl(backendId: string): string | null {
  if (!this.transport.isConnected()) return null;
  return `${this.gatewayHttpUrl}/api/proxy/${backendId}`;
}

getHeaders(): Record<string, string> {
  return {
    'x-gateway-secret': this.gatewaySecret,
    'x-peer-session-id': this.transport.getPeerSessionId() ?? '',
  };
}
```

## 代码放置建议

### shared 层

```
shared/src/facade/
  types.ts              # BackendFacadeSnapshot, BackendFacadeEvent, etc.
  adapter-types.ts      # FacadeRuntimeGatewayAdapter, FacadeAdapterEvent, etc.
```

facade 类型定义放在 shared，因为 direct 模式下 UI 进程需要引用。

### server 层

```
server/src/facade/
  runtime-core.ts       # BackendFacadeRuntimeCore
  registry-store.ts     # FacadeRegistryStore
  stream-manager.ts     # FacadeStreamManager
  embedded-adapter.ts   # EmbeddedGatewayAdapter
  embedded-provider.ts  # EmbeddedBackendFacadeProvider
  ws-hub.ts             # FacadeWsHub
```

### UI 层

```
apps/desktop/src/facade/
  runtime-core.ts       # 同一份 BackendFacadeRuntimeCore（或从 shared 包引入）
  registry-store.ts     # 同一份
  stream-manager.ts     # 同一份
  direct-adapter.ts     # DirectGatewayAdapter
  direct-provider.ts    # DirectBackendFacadeProvider
```

### runtime-core 共享策略（已决策）

**决策：方案 B — class 放 shared，严格约束只用 ES2022 API。**

`BackendFacadeRuntimeCore`、`FacadeRegistryStore`、`FacadeStreamManager` 全部放入 `shared/src/facade/`。

确认依据：

- RuntimeCore 全链路可做到零平台依赖（Map 操作 + 状态推导 + callback 数组 + 参数化时间）
- shared 的 `tsconfig` 已设置 `lib: ["ES2022"]`（无 DOM / Node.js types），编译器自动拦截平台 API
- shared 的 `package.json` 无 `dependencies`，保证无外部依赖引入
- `correlation.ts` 已有运行时逻辑先例（type guards + factory functions）

#### shared/src/facade/ 约束清单

允许：
- types / interfaces / discriminated unions / enums
- 纯函数（输入 → 输出，不修改输入，无副作用）
- 函数可创建并返回新的 Map/Set 实例
- type guards、常量（原始值）
- class（ES2022 API，constructor injection，纯 callback 数组做事件订阅）

禁止：
- 可变模块级状态
- `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`
- `EventEmitter` / `EventTarget`
- `WebSocket` / `fetch` / `crypto`（超出 ES2022 的部分）
- import shared 包外的任何模块
- Node.js 全局变量（`process`, `Buffer`, `__dirname` 等）
- DOM API（`window`, `document` 等）

#### 最终文件布局

```
shared/src/facade/
  types.ts              # BackendFacadeSnapshot, BackendFacadeEvent, BackendRuntimeRecord, etc.
  adapter.ts            # FacadeRuntimeGatewayAdapter 接口 + FacadeAdapterEvent 类型
  registry-store.ts     # class FacadeRegistryStore
  stream-manager.ts     # class FacadeStreamManager
  runtime-core.ts       # class BackendFacadeRuntimeCore (~300 行)
  snapshot.ts           # assembleSnapshot() 纯函数
  constants.ts          # TTL / GC 常量
  index.ts              # barrel export

server/src/facade/
  embedded-adapter.ts   # EmbeddedGatewayAdapter (wraps GatewayClient)
  embedded-provider.ts  # EmbeddedBackendFacadeProvider
  ws-hub.ts             # FacadeWsHub

apps/desktop/src/facade/
  direct-adapter.ts     # DirectGatewayAdapter (wraps GatewayTransport)
  direct-provider.ts    # DirectBackendFacadeProvider
```

## 修订后的实施顺序

### Phase 1a — 契约与核心

1. 在 shared 定义 `FacadeRuntimeGatewayAdapter` 接口和事件类型
2. 在 shared 实现 `BackendFacadeRuntimeCore`、`FacadeRegistryStore`、`FacadeStreamManager`
3. 单元测试：使用 mock adapter 测试 runtime core 全流程

### Phase 1b — 单元测试

- MockFacadeGatewayAdapter：模拟 adapter CQE，可编程式注入事件
- 测试矩阵：bootstrap 流程、registry 状态推导、backend open/close、catalog → ready、stream open/close、auto-resume、content patch / run event、GC、snapshot 组装

### Phase 1c — GatewayClient outgoing channel 扩展

- 在现有 `GatewayClient` 上增量添加 outgoing channel 能力
- 新增 `outgoingChannels: Map<string, OutgoingChannel>`
- 新增方法：openOutgoingChannel / closeOutgoingChannel / sendToOutgoingChannel
- 新增方法：subscribeOutgoingCatalog / unsubscribeOutgoingCatalog
- 新增方法：openOutgoingStream / closeOutgoingStream / catchUpOutgoingStream
- 消息处理中按 backendId 区分 incoming/outgoing routing

### Phase 1d — Embedded adapter + provider

```
server/src/facade/
  embedded-adapter.ts   # EmbeddedGatewayAdapter (wraps GatewayClient)
  embedded-provider.ts  # EmbeddedBackendFacadeProvider
  ws-hub.ts             # FacadeWsHub
```

- EmbeddedGatewayAdapter：wraps GatewayClient，local backend 短路
- EmbeddedBackendFacadeProvider：组装 adapter + core + hub
- FacadeWsHub：`/ws/backend-facade` 连接管理 + snapshot/event 广播
- server 注册 facade HTTP 路由（status + proxy）

### Phase 1e — Direct adapter + provider

```
apps/desktop/src/facade/
  direct-adapter.ts     # DirectGatewayAdapter (wraps GatewayTransport)
  direct-provider.ts    # DirectBackendFacadeProvider
```

- DirectGatewayAdapter：wraps GatewayTransport
- DirectBackendFacadeProvider：组装 adapter + core

### Phase 2 — UI 对接与收敛

#### 现状分析

迁移涉及的 UI 层核心组件：

| 组件 | 行数 | 依赖强度 | 职责 |
|------|------|---------|------|
| useGatewayConnection | 650 | Critical | GatewayTransport 生命周期、registry/catalog/channel/stream 状态编排 |
| useMultiServerSocket | 395 | Critical | DirectTransport + gateway target 分流 |
| ConnectionContext | 243 | Critical | 统一 sendMessage API、embedded server port、standalone 窗口配置 |
| gatewayStore | 326 | High | gateway 连接状态、registry、backend 发现、mobile 配置 |
| serverStore | 368 | High | server 列表、active server 选择、per-server 连接状态 |
| 33 个组件文件 | — | Medium-Low | 读取 gatewayStore/serverStore 状态 |

核心耦合点：

- `useGatewayConnection` 是最大的状态机，同时更新 4 个 store（gateway、server、sessions、chat）
- `serverStore.getActiveServer()` 桥接 gatewayStore — 如果 activeServerId 是 `gw:` 前缀，从 gatewayStore 构造虚拟 BackendServer
- 双控制面：server gateway status polling（30s）+ GatewayTransport push events

#### Phase 2a — facade store + useBackendFacade hook

新增 `apps/desktop/src/stores/facadeStore.ts`（替代 gatewayStore + serverStore 的 gateway 部分）：

```ts
interface FacadeStoreState {
  // 来自 BackendFacadeSnapshot 的核心状态
  connectionState: BackendConnectionState;
  backends: BackendSnapshot[];
  sessionStreams: Record<string, SessionStreamSnapshot>;
  localBackendId: string | null;
  registryRevision: number;

  // facade 实例引用（非 snapshot，运行时持有）
  facade: BackendFacade | null;
}
```

新增 `apps/desktop/src/hooks/useBackendFacade.ts`：

- desktop embedded 模式：连接 `/ws/backend-facade`，解析 snapshot/events 更新 facadeStore
- mobile/Windows direct 模式：直接创建 DirectBackendFacadeProvider，持有 facade 引用
- 统一入口：`const { snapshot, facade } = useBackendFacade()`

#### Phase 2b — UI 偏好状态分离

从 gatewayStore 中提取与 facade 无关的 UI 偏好到 `uiPreferencesStore`（或保留在 gatewayStore 中收缩后的版本）：

| 字段 | 去向 | 理由 |
|------|------|------|
| `subscribedBackendIds` | uiPreferencesStore | 用户过滤偏好，不属于 facade 运行态 |
| `showLocalBackend` | uiPreferencesStore | 调试开关 |
| `directGatewayUrl/Secret` | uiPreferencesStore | mobile 持久配置 |
| `lastActiveBackendId` | uiPreferencesStore | mobile UI 恢复 |
| `gatewayUrl/Secret` (运行时) | facade 内部 | 由 embedded server 或 direct 配置决定 |

#### Phase 2c — 组件逐步迁移

按依赖强度从低到高迁移：

**第一批（Low risk，读取为主）**：
- ServerSelector → `facadeStore.backends` 替代 `gatewayStore.discoveredBackends`
- Sidebar、ActiveSessionsPanel → 读取 `facadeStore.connectionState`
- SettingsPanel → 读取 `facadeStore` 替代多 store 读取

**第二批（Medium risk，涉及交互）**：
- ServerGatewayConfig → 配置由 facade provider 消费
- MobileSetup / WindowsSetup → 使用 uiPreferencesStore + facade

**第三批（High risk，核心链路）**：
- ConnectionContext → 简化为 facade wrapper + embedded server 管理
- messageHandler → 已通过 serverId 抽象，最小改动

#### Phase 2d — 旧层退役

1. **useGatewayConnection → 删除** — 650 行 hook 被 useBackendFacade + BackendFacadeRuntimeCore 替代

2. **useMultiServerSocket → 简化** — gateway target 分支删除（全部走 facade），仅保留 direct server 连接管理

3. **gatewayStore → 收缩为 uiPreferencesStore** — 删除所有运行时状态（isConnected、registry、discoveredBackends），仅保留持久化偏好

4. **serverStore → 瘦身** — 删除 `gw:` 前缀桥接逻辑和 gateway target 虚拟 BackendServer 构造

5. **删除双控制面** — 删除 30s gateway status polling，facade snapshot/event 成为唯一状态来源

#### Phase 2 关键设计决策（待定）

1. **direct server 是否走 facade？**
   - 如果是：serverStore 中的 direct server 也变成 BackendSnapshot，useMultiServerSocket 完全删除
   - 如果否：保留 direct server 独立链路，serverStore 保留，facade 只管 gateway backend
   - 建议：第一阶段只迁移 gateway backend，direct server 保留独立链路

2. **embedded 模式下 facadeStore 的数据来源**
   - 方案 A：UI 通过 `/ws/backend-facade` WS 获取 snapshot/event
   - 方案 B：UI 直接在进程内创建 EmbeddedBackendFacadeProvider（Tauri 场景下 server 也在同进程）
   - 建议方案 A：WS 隔离更清晰，支持多 UI 客户端，与 direct 模式对称

3. **activeServerId 统一**
   - 当前使用 `gw:` 前缀区分 gateway target
   - facade 后统一使用 `backendId`，不再需要前缀
   - 需要处理 migration path（已有 `gw:` 引用的 store 数据）

### Phase 3 — GatewayClient CQE 完整重构

Phase 1c 是增量添加 outgoing channel，`GatewayClient` 会变得更臃肿。Phase 3 做完整 CQE 重构：

- 将现有 `GatewayClient` class 拆分为 `commands` / `queries` / `events` 结构
- incoming channel（backend-peer 角色）和 outgoing channel（facade client 角色）内部清晰分离
- 删除 `GatewayClient` 上遗留的 UI 友好方法（`getDiscoveredBackends()` 等）
- 事件从 callback registry 迁移到单一 union event bus

### Phase 4 — 端到端测试矩阵

- embedded 全链路：UI → facade WS → embedded server → gateway �� remote backend
- direct 全链路：UI → DirectBackendFacadeProvider → gateway → backend
- 断线恢复：gateway 断连 → 重连 → registry rebuild → stream auto-resume
- 多 active session：同一 backend 多 stream 并行
- local backend 短路：embedded 模式下 local backend 不走 gateway 的验证
- backend 掉线：stream 状态迁移 + desired state 保留 + 自动恢复

### Phase 5 — direct server 统一（可选）

Phase 2 建议先只迁移 gateway backend，direct server 保留独立链路。Phase 5 决定是否将 direct server 也纳入 facade：

- 如果纳入：需要一个 `DirectServerAdapter`（不走 gateway，直连 server WS），serverStore 可完全退役
- 如果不纳入：保持现状，facade 只管 gateway 链路
- 取决于产品方向 — direct server 长期是否还是一等公民

### Phase 6 — 性能与可靠性

- snapshot diffing：大量 backend 时避免全量 snapshot 序列化开销
- event batching：高频事件（content_patch、run_event）的微批处理
- facade WS 背压：慢消费者检测与断开策略的实际调参
- GC 调参：基于真实使用模式调整 TTL 常量

## GatewayClient outgoing channel 扩展

### 协议可行性（已确认）

gateway 协议 v2 **已完整支持**双角色 peer，无需协议改动：

- `PeerHelloMessage.peerType` 支持 `'client+backend'`，`GatewayClient` 已使用此值
- `PeerToGatewayMessage` union 同时包含 client-side 消息（`open_backend_channel`、`channel_client_message`、`subscribe_backend_catalog`、`open_session_stream`）和 backend-side 消息（`catalog_snapshot`、`catalog_event`、`run_stream_event`）
- gateway 的 `handleOpenBackendChannel` 不做 peerType 限制，任何 peer 可向任何 backend 开 channel
- registry 广播不按 peerType 过滤，所有 peer 均收到 registry events

**唯一缺失**：`GatewayClient` 实现层面只管理 incoming channel（作为 backend 接受来自 client 的连接），没有实现 outgoing channel（作为 facade client 主动连接其他 backend）。

### 当前 GatewayClient channel 模型

```ts
// 现有：作为 backend 接受 client 的 channel
// - gateway 通知 backend_channel_opened（client 向本 backend 建立了 channel）
// - backend 通过 channelId 向 client 发送 server message
// - backend 接收 client 通过 channel 发来的 client message
```

gateway 的 channel 模型是：

```
client-peer  --open_backend_channel-->  gateway  --backend_channel_opened-->  backend-peer
client-peer  --channel_client_message-->  gateway  --channel_server_message-->  backend-peer
backend-peer  --channel_server_message-->  gateway  --channel_client_message-->  client-peer
```

对于 `client+backend` peer，它可以同时：
- 作为 backend 接收其他 peer 发来的 channel（incoming）
- 作为 client 主动向其他 backend 发起 channel（outgoing）

### outgoing channel 扩展设计

#### 新增数据结构

```ts
interface OutgoingChannel {
  backendId: string;
  channelId: string;
  epoch: number;
  capabilities: string[];
  state: 'opening' | 'open' | 'closing' | 'closed' | 'rejected';
  openedAt: number;
  closedAt?: number;
  lastError?: string;
}
```

#### GatewayClient 内部分离

```ts
class GatewayClient {
  // 现有：incoming channels（本 backend 被其他 peer 连接）
  private incomingChannels: Map<string, IncomingChannel>;

  // 新增：outgoing channels（本 peer 作为 client 连接其他 backend）
  private outgoingChannels: Map<string, OutgoingChannel>;
}
```

#### 新增 outgoing channel 方法

```ts
// === outgoing channel commands ===

openOutgoingChannel(targetBackendId: string, epoch: number): void;
closeOutgoingChannel(channelId: string): void;
sendToOutgoingChannel(channelId: string, message: ClientMessage): void;

// === outgoing catalog commands ===

subscribeOutgoingCatalog(targetBackendId: string, epoch: number, lastRevision?: number): void;
unsubscribeOutgoingCatalog(targetBackendId: string, epoch: number): void;

// === outgoing stream commands ===

openOutgoingStream(channelId: string, sessionId: string): void;
closeOutgoingStream(channelId: string, sessionId: string): void;
catchUpOutgoingStream(channelId: string, sessionId: string, afterOffset: number): void;
```

#### 新增 outgoing 事件

gateway 发回的 outgoing channel 相关消息，当前 `GatewayClient` 已经能接收（protocol 层已支持），但没有处理路由。需要在消息处理中区分 incoming 和 outgoing：

```ts
// gateway -> peer 的 channel 消息
case 'backend_channel_opened':
  // 如果 backendId 是本 peer 的 backendId → incoming channel（现有逻辑）
  // 如果 backendId 是其他 backend → outgoing channel（新增逻辑）
  break;

case 'backend_channel_closed':
  // 同上：按 backendId 区分 incoming / outgoing
  break;

case 'channel_server_message':
  // outgoing channel 收到的 server message（来自目标 backend 的响应）
  break;
```

**关键判断**：`backend_channel_opened` 事件中的 `backendId` 如果等于本 peer 的 `backendId`，是 incoming；否则是 outgoing。

#### 与 EmbeddedGatewayAdapter 的集成

`EmbeddedGatewayAdapter` 将 outgoing channel 相关方法映射到 `FacadeAdapterCommands`：

```ts
class EmbeddedGatewayAdapter implements FacadeRuntimeGatewayAdapter {
  get commands() {
    return {
      connection: {
        connect: () => this.gatewayClient.connect(),
        disconnect: () => this.gatewayClient.disconnect(),
      },
      channel: {
        openBackendChannel: (backendId, epoch) => {
          if (this.isLocalBackend(backendId)) {
            this.handleLocalChannelOpen(backendId, epoch);
          } else {
            this.gatewayClient.openOutgoingChannel(backendId, epoch);
          }
        },
        closeBackendChannel: (channelId) => {
          if (this.isLocalChannel(channelId)) {
            this.handleLocalChannelClose(channelId);
          } else {
            this.gatewayClient.closeOutgoingChannel(channelId);
          }
        },
        sendToBackend: (channelId, message) => {
          if (this.isLocalChannel(channelId)) {
            this.handleLocalMessage(channelId, message);
          } else {
            this.gatewayClient.sendToOutgoingChannel(channelId, message);
          }
        },
      },
      catalog: {
        subscribe: (backendId, epoch, lastRevision) => {
          if (this.isLocalBackend(backendId)) {
            this.handleLocalCatalogSubscribe(backendId);
          } else {
            this.gatewayClient.subscribeOutgoingCatalog(backendId, epoch, lastRevision);
          }
        },
        unsubscribe: (backendId, epoch) => {
          if (this.isLocalBackend(backendId)) {
            this.handleLocalCatalogUnsubscribe(backendId);
          } else {
            this.gatewayClient.unsubscribeOutgoingCatalog(backendId, epoch);
          }
        },
      },
      stream: {
        open: (channelId, sessionId) => {
          if (this.isLocalChannel(channelId)) {
            this.handleLocalStreamOpen(channelId, sessionId);
          } else {
            this.gatewayClient.openOutgoingStream(channelId, sessionId);
          }
        },
        close: (channelId, sessionId) => {
          if (this.isLocalChannel(channelId)) {
            this.handleLocalStreamClose(channelId, sessionId);
          } else {
            this.gatewayClient.closeOutgoingStream(channelId, sessionId);
          }
        },
        catchUp: (channelId, sessionId, afterOffset) => {
          if (this.isLocalChannel(channelId)) {
            this.handleLocalCatchUp(channelId, sessionId, afterOffset);
          } else {
            this.gatewayClient.catchUpOutgoingStream(channelId, sessionId, afterOffset);
          }
        },
      },
    };
  }
}
```

### outgoing channel 与 incoming channel 的隔离

#### 命名空间隔离

建议 channelId 对 local backend 使用 `local:` 前缀，避免与 gateway 分配的 channelId 冲突：

```ts
// local backend channel
channelId = `local:${backendId}:${epoch}`;

// outgoing remote channel
channelId = gateway 分配（UUID 或类似）

// incoming channel
channelId = gateway 分配（UUID 或类似）
```

#### 生命周期隔离

- incoming channel 的生命周期由 gateway 和 client-peer 控制���本 backend 不主动关闭）
- outgoing channel 的生命周期由本 peer 和 gateway 控制（本 peer 可主动 open/close）
- local channel 的生命周期由 adapter 完全控制（不经过 gateway）

三者互不影响，backend 掉线只影响 incoming channel 的 client 端和 outgoing channel 到该 backend 的连接。

### GatewayClient CQE 改造路径

outgoing channel 扩展可以与 GatewayClient CQE 改造同步推进，也可以先在现有 class 上增量实现。

建议第一阶段在现有 `GatewayClient` 上增量添加 outgoing 方法，不做完整 CQE 重构。CQE 重构留到 Phase 2。

理由：
- outgoing channel 是 facade adapter 的前置依赖，需要尽早可用
- CQE 重构涉及 `GatewayClient` 全量接口重新设计，范围更大
- 先增量后重构，降低单次变更风险

## 待继续讨论的问题

- `BackendFacadeSnapshot` 是否需要在运行中支持强制全量重发
- stream 自动恢复的默认策略是否应在 backend 恢复后立即执行
- facade WS 是否需要支持版本协商
- desktop 模式下 embedded facade 是否需要支持多 UI 客户端同时连接
- `EmbeddedGatewayAdapter` local backend 短路是否需要支持 local catalog 的 revision 一致性
- direct 模式下 HTTP proxy 的鉴权 header 是否需要与 WS 鉴权统一
- outgoing channel 的 channelId 分配由 gateway 还是 client 决定
- outgoing channel 重连后是否需要自动恢复（recover）
