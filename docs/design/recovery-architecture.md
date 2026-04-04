# Recovery Architecture: Desktop vs Mobile

## 概述

MyClaudia 的连接恢复系统分为两套独立实现，通过 `isAndroid()` 在运行时切换：

- **桌面端**：基于状态机 + 周期性 reconciliation 的精细化恢复
- **移动端**：基于串行 Job 的轻量恢复

两套系统共享同一个 `BackendFacade` 数据源和 `appLifecycleManager` 生命周期检测。

```
┌─────────────────────────────────────────────────────────────┐
│                    ConnectionContext                         │
│                                                             │
│  isAndroid() ──┬── false ──> useRecoveryCoordinator         │
│                │             (状态机 + timers + reconcile)   │
│                │                                            │
│                └── true ───> useMobileRecoveryLifecycle      │
│                              + RecoveryJobManager            │
│                              (串行 job)                      │
│                                                             │
│  useBackendFacade(dispatchRecoveryEvent)  ← 共享数据层       │
└─────────────────────────────────────────────────────────────┘
```

## 桌面端实现

### 核心组件

| 文件 | 职责 |
|------|------|
| `hooks/useRecoveryCoordinator.ts` | 入口 hook，创建 Controller + TimerManager |
| `stores/recoveryStore.ts` | 状态存储，细粒度跟踪 transport/backend/catalog/session |
| `services/recoveryTimers.ts` | 管理超时 + 30s reconciliation tick |

### 状态模型

桌面端对每个层级维护独立状态：

```
recoveryStore
├── coordinator: 'ready' | 'background' | 'recovering' | 'error'
├── transport
│   └── status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped'
├── backends[backendId]
│   └── status: 'absent' | 'visible' | 'opening' | 'ready' | 'degraded' | 'error'
├── catalogs[backendId]
│   └── status: 'idle' | 'stale' | 'syncing_full' | 'syncing_delta' | 'ready' | 'error'
└── activeSession
    └── status: 'idle' | 'resolving_owner' | 'waiting_backend_ready' | 'opening_stream'
              | 'catching_up' | 'hydrating_tail' | 'live' | 'stale' | 'error'
```

### 恢复流程

1. **触发**：lifecycle 事件（resume/background/network）或 facade 事件（snapshot_updated、connection_state_changed）
2. **Controller tick**：状态机在 React 渲染外命令式执行，根据当前状态决定下一步动作
3. **Reconciliation**：每 30s 检查一次各层级状态是否和 facade 快照一致
   - Transport：如果 >50s 没收到消息，标记 stale
   - Backend：检测 opening 是否超时（15s），状态是否与快照不一致
   - Catalog：检测 sync 是否超时（10s），检查 staleness（活跃 5min / 非活跃 15min）触发增量同步
   - Session：检测 stream 是否关闭，catching_up 是否超时（15s）

### 超时配置

```
TRANSPORT_CONNECT:    10s
BACKEND_OPEN:         15s
CATALOG_SYNC:         10s
SESSION_STREAM_OPEN:  10s
SESSION_CATCHUP:      15s
RECONCILE_INTERVAL:   30s
```

## 移动端实现

### 为什么需要独立实现

桌面端的状态机在移动端有严重问题：

- **事件风暴**：从后台恢复时，lifecycle 事件、facade 事件、reconciliation timer 同时触发
- **Zustand 写入频繁**：细粒度状态更新触发大量 React 重渲染
- **UI 冻结**：microtask 调度的 controller tick 占满主线程

### 核心组件

| 文件 | 职责 |
|------|------|
| `services/recoveryJobManager.ts` | Job 调度器，管理串行恢复 job |
| `hooks/useMobileRecoveryJob.ts` | 提供 job 步骤的具体实现（async 函数） |
| `hooks/useMobileRecoveryLifecycle.ts` | 连接 lifecycle 事件和 job 管理 |
| `stores/mobileRecoveryStore.ts` | 轻量状态存储，只在 phase 边界写入 |
| `services/mobileConnectionState.ts` | UI 状态计算工具函数 |
| `services/mobileRecoveryDependencies.ts` | session ownership 解析 |

### 状态模型

移动端只维护粗粒度的 phase + step：

```
mobileRecoveryStore
├── phase: 'idle' | 'recovering' | 'ready' | 'error' | 'background'
├── step: 'transport' | 'backend' | 'session' | null
├── currentJob: { jobId, status, reason, startedAt, finishedAt }
├── activeBackendId
├── selectedSessionId
└── lastError
```

### 恢复流程

```
lifecycle 事件 (resume / background / network)
  │
  ▼
RecoveryJobManager.start(reason)
  │
  ▼ 一次只有一个 job 在运行
  │
  ├── Step 1: ensureTransportConnected  (12s timeout)
  │   ├── facade.forceReconnect()
  │   ├── facade.probeHealth()
  │   └── waitFor(connectionState === 'connected')
  │
  ├── Step 2: ensureActiveBackendReady  (12s timeout)
  │   ├── facade.openBackend(backendId)
  │   ├── waitFor(runtimeState === 'ready')
  │   └── syncBackendCatalog(backendId, 'full')
  │
  └── Step 3: ensureActiveSessionReady  (15s timeout, 仅在有 selectedSessionId 时)
      ├── 解析 owner backend（可能需要打开另一个 backend + catalog sync）
      ├── facade.openSessionStream(ownerBackendId, sessionId)
      ├── waitFor(stream.state === 'open')
      └── facade.catchUpContent() + recoverCurrentSessionTail()

Overall job timeout: 45s
```

### Selection 变更处理

如果恢复过程中用户切换了 backend/session：
1. `updateSelection()` 更新 store
2. 检测到 selection 变化 → 取消当前 job
3. 以 `'backend_reconnect'` 原因启动新 job

### waitFor 优化

`waitFor()` 订阅 `useFacadeStore` 时使用 selector，只在相关字段变化时触发检查：

```typescript
// 只在 connectionState 变化时检查，而非每次 store 更新
await waitFor(
  () => useFacadeStore.getState().connectionState === 'connected',
  12_000, ctx, 'Transport recovery timed out',
  (s) => s.connectionState,  // selector
);
```

## 共享层

### BackendFacade (`hooks/useBackendFacade.ts`)

两套恢复系统的数据来源。负责：
- 创建 facade（EmbeddedFacadeClient 或 DirectBackendFacadeProvider）
- 订阅 facade 事件，同步到 facadeStore / recoveryStore / sessionStore / ownershipStore
- 调用 `dispatchRecoveryEvent()` 通知桌面端状态机（移动端传入 noop）

### AppLifecycleManager (`services/appLifecycleManager.ts`)

共享的生命周期检测：
- `visibilitychange`：检测前后台切换（>5s 算后台）
- `online/offline`：网络状态
- Health probe：25s 间隔检查

桌面端和移动端通过传入不同的回调来响应同一组事件。

### useSessionRoute (`hooks/chat/useSessionRoute.ts`)

Session 路由 hook，桥接恢复状态和 UI：

```typescript
// 桌面端：从 recoveryStore 读取精细状态
const transportStatus = mobileRecoveryEnabled ? 'idle' : recoveryStore.transport.status;

// 移动端：从 mobileRecoveryStore 读取粗粒度状态
const mobileRecoveryPhase = useMobileRecoveryStore.phase;

// phase 计算
if (mobileRecoveryEnabled && mobileRecoveryPhase === 'recovering') {
  phase = mobileRecoveryStep === 'session' ? 'opening_stream' : 'opening_backend';
} else if (transportStatus === 'error' || backendErrored || facadeConnectionState === 'error') {
  phase = 'error';
}

// canSend 计算
canSend = mobileRecoveryEnabled
  ? !mobileRecoveryOwnsDesiredState && isMobileBackendUsable({...})
  : transportReady && backendReady;
```

## 关键设计差异

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 架构 | 状态机 + reconciliation loop | 串行 async job |
| 状态粒度 | 细粒度（transport/backend/catalog/session 独立状态） | 粗粒度（phase + step） |
| 超时策略 | 每个阶段独立超时 + reconciliation 兜底 | 每步超时 + 45s 整体超时 |
| Catalog 同步 | full + delta 两种模式，基于 staleness 触发 | 始终 full sync |
| 重试 | per-phase max retries + reconciliation 自动重试 | 手动 retry 或等待下一次 resume |
| Zustand 写入 | 高频（每次状态转换） | 低频（仅 phase 边界） |
| Selection 变更 | 状态机事件 | cancel + restart job |
| 平台判断 | `isAndroid() === false` | `isAndroid() === true` |

## UI 状态映射

桌面端和移动端各自维护一套 view state，在 UI 组件中统一使用：

```typescript
// 桌面端 → BackendRecoveryViewState
'ready' | 'transport_reconnecting' | 'backend_opening' | 'backend_recovering'
| 'catalog_syncing' | 'session_syncing' | 'error' | 'offline'

// 移动端 → MobileBackendViewState
'ready' | 'transport_reconnecting' | 'backend_opening' | 'backend_recovering'
| 'backend_visible' | 'error' | 'offline'
```

组件通过 `isAndroid()` 选择调用 `getBackendViewState()` 还是 `getMobileBackendViewState()`，返回值的类型联合保证 UI switch 语句覆盖两端的所有状态。
