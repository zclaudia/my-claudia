# Gateway Single-Connection Design

## Goal

重新定义 `my-claudia` 的 gateway 架构，目标不是修补当前实现，而是建立一套更稳定、语义更清晰的正确模型。

核心目标：

- 用单条 WebSocket 连接同时承载 backend 能力和 client 能力
- 把 “gateway 已连接” 和 “backend 已注册” 明确区分
- 让桌面端、手机端、设置页都消费同一份 backend registry
- 正确支持 “同机多个实例”，例如正式版和 dev 版同时在线
- 为后续会话同步、HTTP proxy、远程控制打下统一状态模型

## Non-Goals

- 不在第一阶段重做所有业务路由
- 不要求旧协议一次性完全删除
- 不优先解决 UI 展示细节
- 不在第一阶段引入新的外部标准协议

## Problem Statement

当前 gateway 相关语义实际上包含多个不同维度：

- 这个 peer 是否连上了 gateway
- 这个 peer 是否已注册为 backend
- 这个 backend 是否对外可见
- 某个 backend 是否属于当前设备
- 某个 backend 是否就是当前这个本地实例

这些语义必须分别建模，不能继续依赖单个 `connected`、`backendId` 或 `isLocal` 推断。

## Design Principles

- 单连接优先：一个 peer 到 gateway 只保留一条长连接
- 单一真相源：backend 列表只以 gateway registry 为准
- 身份拆分：设备身份、实例身份、路由身份分离
- 事件驱动：registry 变化通过 snapshot + delta 广播，不靠多处轮询拼接
- 明确状态：client connected、backend registered、backend visible 分别表达
- 渐进迁移：允许旧双连接协议短期并存

## Core Model

### 1. Peer

`Peer` 表示一个到 gateway 的逻辑连接。

一个 peer 可以同时具备两种能力：

- `client_capability`
- `backend_capability`

也就是说，同一条连接既可以：

- 浏览/连接其他 backend
- 把自己注册成 backend

### 2. Device Identity

用于表达“是不是同一台设备”。

建议字段：

- `deviceId: string`

要求：

- 同一台机器上的正式版和 dev 版应共享 `deviceId`
- `deviceId` 不用于 backend 替换
- UI 判断 “This Device” 基于 `deviceId`

### 3. Instance Identity

用于表达“是不是同一个运行实例”。

建议字段：

- `instanceId: string`
- `channel: 'prod' | 'dev' | 'test' | string`

要求：

- 正式版和 dev 版必须有不同的 `instanceId`
- reconnect 时，如果要恢复同一个 backend，应保持 `instanceId` 稳定
- UI 判断 “This Instance” 基于 `instanceId`

### 4. Backend Identity

用于 gateway 路由和对外展示。

建议字段：

- `backendId: string`

语义：

- `backendId` 对外暴露
- 一个 `backendId` 对应一个稳定的 backend registration
- backend registry 以 `instanceId` 为内部唯一键，`backendId` 为公开路由键

## Backend Registry

gateway 维护唯一权威 registry：

```ts
interface BackendRegistryEntry {
  backendId: string;
  instanceId: string;
  deviceId: string;
  channel: string;
  name: string;
  visible: boolean;
  online: boolean;
  registeredAt: number;
  updatedAt: number;
}
```

说明：

- 所有 client 看到的 backend 列表都来自这份 registry
- 本地设置页也不例外
- 本地 server 不再维护自己的“第二份 discoveredBackends 真相”

## Single-Connection Protocol

建议统一为 `peer_hello` 作为第一条消息。

```ts
interface PeerHelloMessage {
  type: 'peer_hello';
  gatewaySecret: string;
  peerId?: string;
  capabilities: {
    client: boolean;
    backend: boolean;
  };
  identity: {
    deviceId: string;
    instanceId: string;
    channel?: string;
    name?: string;
  };
  backend?: {
    visible: boolean;
  };
}
```

gateway 返回：

```ts
interface PeerHelloResultMessage {
  type: 'peer_hello_result';
  success: boolean;
  peerId: string;
  clientConnected: boolean;
  backendRegistered: boolean;
  backendId?: string;
  registrySnapshot?: BackendRegistryEntry[];
  error?: string;
}
```

## Message Categories

单连接后，消息要按命名空间分开。

### A. Gateway Control Messages

- `peer_hello`
- `peer_hello_result`
- `registry_snapshot`
- `registry_upsert`
- `registry_remove`
- `backend_visibility_update`
- `peer_error`

### B. Client-to-Backend Routing

- `connect_backend`
- `backend_auth_result`
- `send_to_backend`
- `backend_message`
- `backend_disconnected`

### C. Backend Broadcast

- `broadcast_to_subscribers`
- `broadcast_session_event`
- `client_subscribed`
- `client_disconnected`

### D. HTTP Proxy

- `http_proxy_request`
- `http_proxy_response`
- `http_proxy_response_start`
- `http_proxy_response_chunk`
- `http_proxy_response_end`

## Registry Distribution

这是整个模型里最重要的一条规则：

### Rule

所有 consumer 只看 gateway registry。

### Required Behavior

1. peer 首次连接成功时，gateway 发送完整 `registry_snapshot`
2. backend 上线、下线、改名、可见性变化时，gateway 向所有已认证 peer 广播：
   - `registry_upsert`
   - `registry_remove`
3. client 不再依赖本地 server 的缓存列表
4. 设置页、手机端、桌面端 server selector 使用同一份 store 数据结构

## Self / Local Semantics

UI 层必须拆成两个概念。

### This Device

判断规则：

- `entry.deviceId === currentDeviceId`

用途：

- 表达“这是我这台机器上的实例”
- 同时支持显示 prod + dev

### This Instance

判断规则：

- `entry.instanceId === currentInstanceId`

用途：

- 表达“这就是当前 app/server 自己”
- 只隐藏或特殊标记当前实例

### Why Both Are Needed

如果只有一种 `isLocal`：

- 同机 dev/prod 无法正确表达
- “同一台机器上的另一个实例” 会被误当成远端或误隐藏

## Connection State Model

本地 UI 至少要暴露 3 个状态字段。

```ts
interface GatewayPeerState {
  gatewayConnected: boolean;
  backendRegistered: boolean;
  backendId: string | null;
  currentDeviceId: string | null;
  currentInstanceId: string | null;
}
```

语义：

- `gatewayConnected`: peer 到 gateway 的连接是否建立
- `backendRegistered`: 当前实例是否成功注册为 backend
- `backendId`: 当前实例对外 backend id

这三个状态不能合并成一个 `connected`。

## Naming Model

默认显示名建议包含运行通道。

示例：

- `MyClaudia on HomeMac`
- `MyClaudia Dev on HomeMac`

但显示名只用于 UI，不参与身份判断。

身份判断只基于：

- `deviceId`
- `instanceId`
- `backendId`

## Recommended Store Shape

前端建议只保留一份 gateway registry store：

```ts
interface GatewayRegistryState {
  peer: {
    gatewayConnected: boolean;
    backendRegistered: boolean;
    backendId: string | null;
    currentDeviceId: string | null;
    currentInstanceId: string | null;
  };
  registry: Record<string, BackendRegistryEntry>;
}
```

衍生字段通过 selector 计算：

- `visibleBackends`
- `currentInstanceEntry`
- `sameDeviceEntries`
- `remoteEntries`

## Migration Plan

### Phase 1: Identity Introduction

- 引入 `deviceId` 和 `instanceId`
- backend 注册时同时上报这两个字段
- gateway registry 先扩展字段，不改 UI

### Phase 2: Registry Unification

- gateway 新增 `registry_snapshot` / `registry_upsert` / `registry_remove`
- client store 改为只消费 registry
- 设置页不再显示本地 backend 缓存列表

### Phase 3: Single Peer Connection

- 新增 `peer_hello`
- 单连接同时声明 client/backend capability
- 保留旧 `register` / `gateway_auth` 作为兼容层

### Phase 4: Legacy Removal

- 删除双连接逻辑
- 删除 server 侧的 discoveredBackends 缓存同步
- 删除前端基于 `backendId === localBackendId` 的单值 `isLocal` 推断

## Compatibility Strategy

迁移期间 gateway 可同时支持：

- 旧协议：
  - `register`
  - `gateway_auth`
- 新协议：
  - `peer_hello`

兼容目标：

- 新 client 可连旧 server
- 新 server 可连旧 gateway
- 完成一次版本切换后再移除旧协议

## Observability Requirements

为了避免再次出现“看起来像 A，实际是 B”的问题，建议最少记录：

- `peerId`
- `deviceId`
- `instanceId`
- `backendId`
- `channel`
- `gatewayConnected`
- `backendRegistered`
- registry 变更事件

建议关键日志：

- peer connected
- peer authenticated
- backend registered
- backend replaced
- registry upserted
- registry removed
- backend visibility changed

## Decision Summary

正确方向不是继续在当前双连接/双状态模型上修补。

正确方向应当是：

- 一个 peer 一条连接
- 一个 gateway 一份 backend registry
- 一套明确拆分的身份模型
- 一份被所有前端消费的统一状态

这样才能稳定支持：

- 本机实例识别
- 同机 dev/prod 并存
- 多端一致 backend list
- 更简单的连接状态语义
