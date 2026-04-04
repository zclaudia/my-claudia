# Mobile Recovery State Machine

## Migration Plan: Serial Recovery Job

The current fine-grained state-machine implementation is too eager for mobile foreground/background recovery. Even after multiple correctness fixes, recovery is still driven on the UI thread by a combination of:

- lifecycle events
- facade events
- reconciliation timers
- synchronous Zustand writes
- microtask-based controller rescheduling

On mobile this creates an event storm during foreground resume and can freeze the UI. To address that, mobile recovery will migrate to a serial recovery job model.

### Migration goals

1. Only one recovery job may run at a time.
2. Recovery is driven by an explicit async task, not by repeated tick/reconcile loops.
3. Recovery writes coarse-grained UI state only at phase boundaries.
4. Existing desktop recovery logic may remain temporarily while mobile switches first.

### New model

The new mobile recovery path is:

```text
resume/background/network event
  -> RecoveryJobManager.start(reason)
  -> one serial async recovery job
     -> ensure transport
     -> ensure active backend
     -> ensure active session
  -> coarse recovery state update
```

The UI should eventually subscribe only to:

- `phase`: `idle | recovering | ready | error`
- `step`: `transport | backend | session | null`
- `lastError`

### Implementation stages

#### Stage 1. Define the new runtime

Implement:

- `mobileRecoveryStore`
- `RecoveryJobManager`
- serial job lifecycle: `idle | running | succeeded | failed | cancelled`
- coarse recovery UI state: `idle | recovering | ready | error`

Tests:

- `start()` creates a new job
- a second `start()` cancels/supersedes the prior job
- `cancel()` stops the active job
- step progression is serial: transport -> backend -> session

Acceptance:

- the new runtime works in isolation with no dependency on the legacy tick controller

#### Stage 2. Provider-local wiring

Implement:

- construct one `RecoveryJobManager` per `ConnectionProvider`
- sync active backend/session selection into the new runtime
- expose `startRecovery`, `retryRecovery`, `cancelRecovery`

Tests:

- provider creates a single manager instance
- selection changes update the recovery job context
- repeated resume events do not create concurrent jobs

Acceptance:

- mobile recovery has a provider-local runtime boundary

#### Stage 3. Serial recovery main path

Implement:

- `ensureTransportConnected()`
- `ensureActiveBackendReady()`
- `ensureActiveSessionReady()`
- timeout + cancellation handling per step

Tests:

- transport reconnect path
- backend reopen path
- session recovery path
- failure and cancellation paths

Acceptance:

- one recovery job can restore active backend + active session without relying on reconcile ticks

#### Stage 4. Mobile cutover

Implement:

- mobile lifecycle events trigger only the new recovery job
- disable legacy controller-driven recovery on Android
- reconciliation timers become watchdog-only or are disabled on mobile

Tests:

- mobile resume triggers at most one recovery job
- no concurrent legacy `tick()` loop participates in mobile recovery

Acceptance:

- Android foreground resume no longer freezes the UI due to controller/timer/tick storms

#### Stage 5. Regression coverage and diagnostics

Implement:

- focused mobile recovery regression tests
- structured job logs:
  - `job_started`
  - `step_started`
  - `step_succeeded`
  - `step_failed`
  - `job_cancelled`
  - `job_completed`

Tests:

- background -> foreground
- attachment picker return to app
- reconnect while active session is open

Acceptance:

- mobile recovery regressions are reproducible and observable without reintroducing high-frequency store tracing

## Current Cutover Inventory

As of the current migration state, Android/mobile recovery is already routed through the serial `RecoveryJobManager`, but some legacy recovery pieces remain in the codebase for desktop or bridge purposes.

### Android paths already cut over

These paths now derive readiness from `facadeStore + mobileRecoveryStore` instead of the legacy fine-grained recovery machine:

- `ConnectionProvider` lifecycle wiring
- `useSessionRoute`
- `useActiveSessionStream` gating
- `useMultiServerSocket`
- `useGatewayConnection`
- `useDataLoader`
- `ServerSelector`
- `MobileSetup`
- `MobileGatewayConfig`
- `ProviderManager`
- `Sidebar`
- `SettingsPanel`
- `ProjectSettings`
- `SessionChatWindow`
- `WorkflowEditorWindow`
- `XTerminal`
- `ActiveSessionsPanel`
- `useAutomationBackendOptions`
- `useServerLatencyMonitor`
- `useSelectionCoordinator`
- `App.tsx` mobile auto-reconnect to the last active backend

### Legacy recovery kept for desktop or bridge-only use

These modules still use `recoveryStore` or the legacy controller intentionally, but they are no longer the source of truth for Android foreground recovery:

- `useRecoveryCoordinator`
- `recoveryStateMachine`
- `recoveryPlanner`
- `recoveryEffects`
- `recoveryTimers`
- `recoveryTransitions`
- `useBackendFacade`
- `WindowsSetup`
- Desktop branches inside shared hooks/components that still fall back to `recoveryStore`

### Remaining Android-adjacent legacy coupling

These areas still read legacy recovery data, but only as a compatibility fallback or metadata source rather than as the mobile recovery driver:

- `App.tsx` still uses legacy transport status for desktop control-plane readiness

These are lower priority than the original UI-freeze issue, but they are the next candidates if the migration continues.

### Next cleanup targets

If the migration continues, the next highest-value cleanup steps are:

1. Introduce a mobile-specific top-level control-plane selector so `App.tsx` no longer needs any legacy transport subscription on Android.

## Background

The current mobile foreground/background recovery path mixes several different concerns into loosely coupled effects:

- transport reconnect
- backend channel reopen
- catalog/session list refresh
- active session stream recovery
- active session message catch-up

This leads to inconsistent UI and stale data states:

- a backend can appear yellow until the user manually re-selects it
- a backend can become green again while session state is still stale
- recovery timing depends on races between WebSocket reconnect, registry updates, session sync, and ownership refresh

### Root causes in current code

**1. No ordering in foreground recovery (`appLifecycleManager.ts:79-97`)**

`onForeground()` fires three operations in parallel with no await:

- `facade.forceReconnect()` — non-blocking
- `eagerSyncAllBackends()` — non-blocking
- `probeHealth()` — non-blocking

Catalog sync (`eagerSyncAllBackends`) can issue HTTP requests before the WebSocket reconnect completes, receiving stale data from the previous epoch.

**2. Dual connection status sources**

`serverStore.connections[*].status` and `facadeStore.backends[*].runtimeState` represent connectivity independently. `syncToGatewayStore()` (`useBackendFacade.ts:176-252`) bridges them via a lossy `runtimeStateToConnectionStatus()` mapping that is not atomic. UI components read both: `ServerSelector.tsx:49-50` reads serverStore for the badge while `ServerSelector.tsx:222` reads facadeStore for the list, allowing contradictory displays.

**3. Ownership used without freshness guarantee**

`ownershipStore.getSessionBackendId()` returns a backendId with no version. After reconnect, stale run events processed by `messageHandler.ts` can overwrite ownership before the new catalog arrives, routing messages to the wrong backend.

**4. Catalog and content recovery mixed in sessionSync.ts**

`incrementalSync()` (`sessionSync.ts:142-216`) fetches the session list and then immediately calls `checkAndFillMessageGaps()` (line 210) within the same function. There is no guard ensuring cross-store consistency before message catch-up begins. Although the periodic `startSessionSync()` is currently dead code (never called in production), the eager sync paths (`eagerSyncAllBackends`, `eagerSyncCurrentSession`) share the same unordered pattern.

This document defines a complete recovery state machine that makes these phases explicit and serializes recovery by dependency instead of relying on incidental effect ordering.

## Goals

1. Use one authoritative recovery model instead of multiple partial status sources.
2. Separate transport readiness from backend readiness.
3. Ensure session catalog recovery happens only after backend channel is open.
4. Ensure active session recovery happens only after ownership is verified.
5. Make foreground recovery deterministic and observable.
6. Prevent stale async results from older reconnect attempts from overwriting newer state.

## Non-goals

1. This design does not change the gateway protocol.
2. This design does not replace `BackendFacadeRuntimeCore` — it wraps its event stream (see [Relationship to RuntimeCore](#relationship-to-runtimecore)).
3. This design does not attempt to eliminate all existing stores immediately.
4. This design does not require a single global monolithic reducer; the machines can still be implemented in modular reducers with a coordinating orchestrator.

## Relationship to RuntimeCore

`BackendFacadeRuntimeCore` (`shared/src/facade/runtime-core.ts`) already manages:

- `desiredOpenBackends` set with replay on registry snapshot
- Registry tracking (`RegistryStore`) with epoch alignment checks
- Backend open/close commands via the adapter
- Session stream lifecycle

This state machine layer does **not** replace RuntimeCore. Instead, it sits between RuntimeCore's event stream and the desktop UI/store layer:

```
RuntimeCore (shared/)
  ↓ emits BackendFacadeEvent
RecoveryCoordinator (apps/desktop/)
  ↓ consumes events, applies generation guards, emits effects
  ↓ publishes RecoveryState
UI selectors / stores
```

RuntimeCore continues to own:
- Transport connection lifecycle (WS open/close/reconnect)
- Registry store (backend presence, epoch tracking)
- `desiredOpenBackends` set and auto-replay on snapshot
- Backend channel open/close commands
- Session stream open/close commands

RecoveryCoordinator adds:
- Transport generation tagging to discard stale events
- Serialized recovery phases (transport → registry → backend → catalog → session)
- Ownership versioning (client-local, not protocol)
- Timeout and retry management per phase
- Health probe coordination
- Unified UI view state derivation

The coordinator wraps RuntimeCore events by tagging them with the current transport generation before feeding them into the state machine reducer. Stale events (generation mismatch) are discarded at the coordinator boundary.

## Transport Mode Differences

The recovery behavior differs between embedded and direct modes. The state machine must account for these differences.

### Embedded mode (`EmbeddedFacadeClient`)

- Transport is a local WebSocket to the embedded Node.js server
- Transport failure may indicate the server process crashed (not just a network issue)
- `forceReconnect()` (`embedded-facade-client.ts:242-251`) does NOT emit channel closure events — it simply reconnects the WS; the server sends a fresh `facade_snapshot` on open
- Recovery may require restarting the server process (`useEmbeddedServer.ts`)

### Direct mode (`DirectGatewayAdapter`)

- Transport is a remote WebSocket to the gateway
- `forceReconnect()` (`direct-adapter.ts:274-289`) explicitly emits `backend_channel_closed` for all known channels before reconnecting
- Transport failure is a network issue; the server process is not involved

### Implications for TransportMachine

The TransportMachine carries a `mode` context field. In embedded mode:
- `error` state may trigger a `CHECK_SERVER_PROCESS` effect
- Recovery from `error` may require waiting for the server process to restart before attempting reconnect
- The `TRANSPORT_CONNECT_REQUESTED` effect should verify server process health first

In direct mode:
- `error` state leads directly to backoff-based reconnect attempts
- No server process health check needed

## Layers

The recovery model is split into four machines plus one orchestration layer:

1. `TransportMachine`
2. `BackendMachine`
3. `CatalogMachine`
4. `ActiveSessionMachine`
5. `RecoveryCoordinator`

Each layer has a single responsibility and only advances when its dependencies are satisfied.

## State Model

### TransportMachine

Represents control-plane connectivity to the embedded facade or direct gateway transport.

States:

- `idle`
- `connecting`
- `connected`
- `reconnecting`
- `error`
- `stopped`

### BackendMachine

One instance per backend. Represents whether a backend is visible, opening, and actually usable.

States:

- `absent`
- `visible`
- `opening`
- `ready`
- `degraded`
- `error`

Interpretation:

- `absent`: backend not present in registry
- `visible`: backend present in registry but channel not open
- `opening`: channel or catalog for current epoch is not fully ready yet. Internally tracked by context flags `channelReady` and `catalogReady` — the arrival order of `BACKEND_CHANNEL_OPENED` and `CATALOG_SYNC_SUCCEEDED` does not matter; both must be true to transition to `ready`.
- `ready`: channel open and catalog synchronized for current epoch
- `degraded`: backend was previously ready but transport or channel was lost and recovery is pending
- `error`: explicit backend-level failure or recovery timeout

### CatalogMachine

One instance per backend. Represents whether the backend session/project/provider snapshot and ownership map are trustworthy.

States:

- `idle`
- `stale`
- `syncing_full`
- `syncing_delta`
- `ready`
- `error`

### ActiveSessionMachine

Tracks recovery of the currently selected session only.

States:

- `idle`
- `resolving_owner`
- `waiting_backend_ready`
- `opening_stream`
- `catching_up`
- `hydrating_tail`
- `live`
- `stale`
- `error`

### RecoveryCoordinator

Top-level orchestration view. This is not the same as transport state.

States:

- `ready`
- `background`
- `recovering`
- `error`

## Global Invariants

1. `transport.connected` does not imply any backend is usable.
2. A backend is not `ready` until both channel and catalog are ready for the current epoch.
3. Catalog sync must not begin until backend channel is open (`BACKEND_CHANNEL_OPENED`).
4. Active session recovery must not begin until ownership is verified against the latest catalog version.
5. Any recovery result must be ignored if it belongs to an outdated generation.
6. Each machine is the sole consumer of its own event subset — global events (`APP_RESUME`, `NETWORK_OFFLINE`) are routed to the appropriate machine by the coordinator, not consumed by multiple machines independently.
7. Event streams are unreliable — events can be lost, delayed, or arrive out of order. Every machine must be periodically reconciled against ground truth (see [Periodic Reconciliation](#periodic-reconciliation)). The state machine is the fast path; reconciliation is the correctness guarantee.

## Generations and Versioning

The design uses three version domains:

### Transport generation

Incremented every time a reconnect cycle starts.

Used to ignore stale events such as:

- delayed `TRANSPORT_CONNECTED`
- delayed registry snapshots
- delayed backend open confirmations from an old socket

### Backend epoch

Already exists in the gateway protocol and in `RegistryStore` (`shared/src/facade/registry-store.ts:39-44`). Used to bind backend channel and catalog readiness.

A backend cannot enter `ready` unless:

- `channelEpoch === registryEpoch`
- `catalogEpoch === registryEpoch`

This matches the existing epoch alignment check in `registry-store.ts`.

### Ownership version

A client-local monotonic counter incremented each time a catalog sync completes for a given backend. This does not require any gateway protocol changes.

Implementation: the RecoveryCoordinator maintains a `nextOwnershipVersion` counter. Each `CATALOG_SYNC_SUCCEEDED` event increments this counter and associates the new version with the backend's catalog state. Session ownership lookups are only considered verified if derived from the latest `ownershipVersion` for that backend.

A session owner is considered verified only if its ownership mapping is derived from the latest successful catalog sync for that backend.

## Unified Event Types

```ts
type RecoveryEvent =
  | { type: 'APP_RESUME'; at: number }
  | { type: 'APP_BACKGROUND'; at: number }
  | { type: 'NETWORK_ONLINE'; at: number }
  | { type: 'NETWORK_OFFLINE'; at: number }

  | { type: 'TRANSPORT_CONNECT_REQUESTED'; generation: number }
  | { type: 'TRANSPORT_CONNECTED'; generation: number; peerSessionId: string }
  | { type: 'TRANSPORT_RECONNECTING'; generation: number; reason: string }
  | { type: 'TRANSPORT_ERROR'; generation: number; error: string }
  | { type: 'TRANSPORT_STOPPED'; generation: number }
  | { type: 'HEALTH_PROBE_FAILED'; generation: number }
  | { type: 'HEALTH_PROBE_SUCCEEDED'; generation: number }
  | { type: 'RECONCILE_TICK'; at: number }

  | { type: 'REGISTRY_SNAPSHOT'; generation: number; revision: number }
  | { type: 'REGISTRY_BACKEND_VISIBLE'; generation: number; backendId: string; epoch: number }
  | { type: 'REGISTRY_BACKEND_REMOVED'; generation: number; backendId: string }
  | { type: 'REGISTRY_BACKEND_EPOCH_CHANGED'; generation: number; backendId: string; epoch: number }

  | { type: 'BACKEND_DESIRED_OPEN'; backendId: string; reason: 'user_select' | 'resume_recovery' | 'session_owner_required' }
  | { type: 'BACKEND_DESIRED_CLOSE'; backendId: string; reason: 'user_close' | 'inactive_cleanup' }
  | { type: 'BACKEND_CHANNEL_OPENED'; backendId: string; epoch: number; channelId: string }
  | { type: 'BACKEND_CHANNEL_CLOSED'; backendId: string; reason: string }
  | { type: 'BACKEND_RECOVERY_TIMEOUT'; backendId: string }

  | { type: 'CATALOG_SYNC_REQUESTED'; backendId: string; mode: 'full' | 'delta'; cause: string }
  | { type: 'CATALOG_SYNC_SUCCEEDED'; backendId: string; revision: number; ownershipVersion: number; epoch: number }
  | { type: 'CATALOG_SYNC_FAILED'; backendId: string; error: string; retryCount: number }
  | { type: 'CATALOG_SYNC_TIMEOUT'; backendId: string }
  | { type: 'CATALOG_INVALIDATED'; backendId: string; reason: string }

  | { type: 'ACTIVE_SESSION_SELECTED'; sessionId: string | null }
  | { type: 'ACTIVE_SESSION_OWNER_VERIFIED'; sessionId: string; backendId: string; ownershipVersion: number }
  | { type: 'ACTIVE_SESSION_STREAM_OPENED'; sessionId: string; backendId: string }
  | { type: 'ACTIVE_SESSION_STREAM_CLOSED'; sessionId: string; backendId: string; reason: string }
  | { type: 'ACTIVE_SESSION_CATCHUP_REQUESTED'; sessionId: string; backendId: string }
  | { type: 'ACTIVE_SESSION_CATCHUP_SUCCEEDED'; sessionId: string; backendId: string; maxOffset: number }
  | { type: 'ACTIVE_SESSION_TAIL_RECOVERY_SUCCEEDED'; sessionId: string; backendId: string }
  | { type: 'ACTIVE_SESSION_RECOVERY_FAILED'; sessionId: string; backendId: string; error: string }
  | { type: 'ACTIVE_SESSION_RECOVERY_TIMEOUT'; sessionId: string; backendId: string };
```

## Timeout and Retry Strategy

Each recovery phase has explicit timeout and retry limits to prevent infinite loops.

| Phase | Timeout | Max Retries | On Timeout | On Max Retries |
| --- | --- | --- | --- | --- |
| Transport connect | 10s | 5 (with exponential backoff: 2s, 4s, 8s, 16s, 30s cap) | `TRANSPORT_ERROR` | `TRANSPORT_ERROR` → coordinator `error` |
| Backend channel open | 15s | 3 | `BACKEND_RECOVERY_TIMEOUT` → `error` | Stay in `error`; user action or next resume retries |
| Catalog full sync | 10s | 3 | `CATALOG_SYNC_TIMEOUT` → `error` | Stay in `error`; retried on next `BACKEND_CHANNEL_OPENED` |
| Catalog delta sync | 10s | 1 | `CATALOG_SYNC_TIMEOUT` → `stale` | Escalate to full sync |
| Active session stream open | 10s | 2 | `ACTIVE_SESSION_RECOVERY_TIMEOUT` → `error` | Stay in `error`; retried on next `CATALOG_SYNC_SUCCEEDED` |
| Active session catch-up + tail | 15s | 2 | `ACTIVE_SESSION_RECOVERY_TIMEOUT` → `error` | Partial recovery: enter `live` with gap marker |

Retry counts are tracked per-phase in the state context and reset when the phase succeeds or when a new transport generation starts.

In embedded mode, transport connect timeout additionally triggers a `CHECK_SERVER_PROCESS` effect before retrying.

## Periodic Reconciliation

Event streams (WebSocket messages, facade events) are inherently unreliable: messages can be lost silently, arrive out of order, or the WS can appear open while the remote end has already dropped it. Relying solely on event-driven transitions means a single missed event can leave a machine stuck in a transient state indefinitely.

Every machine therefore runs a periodic **reconciliation tick** that compares its own state against ground truth and corrects any drift. The reconciliation is the correctness backstop; the event-driven path is the fast path for responsiveness.

### Reconciliation timer

The `RecoveryCoordinator` runs a single `RECONCILE_TICK` timer (default: 30s interval). On each tick it dispatches `RECONCILE_TICK` to every active machine. The timer:

- Starts when coordinator enters `ready` or `recovering`
- Stops when coordinator enters `background` or `stopped`
- Resets on each `APP_RESUME` (immediate tick after resume, then resume regular interval)

### Per-machine reconciliation logic

#### TransportMachine

| State | Ground truth check | Correction |
| --- | --- | --- |
| `connected` | WS readyState, last message received within 2× health probe interval | If stale → emit `TRANSPORT_RECONNECTING` |
| `reconnecting` | Time since last reconnect attempt | If exceeded backoff cap with no progress → emit `TRANSPORT_ERROR` |
| `connecting` | Time since connect started | If exceeded timeout → emit `TRANSPORT_ERROR` |

Implementation: the effect runner checks `ws.readyState` and `lastMessageAt` timestamp. This catches silent TCP drops that neither `onclose` nor `onerror` report.

#### BackendMachine

| State | Ground truth check | Correction |
| --- | --- | --- |
| `opening` | Duration in `opening` state; actual channel state from facade snapshot | If channel already reported as open in snapshot but machine missed the event → synthesize `BACKEND_CHANNEL_OPENED`. If timeout exceeded → emit `BACKEND_RECOVERY_TIMEOUT`. |
| `ready` | Facade snapshot confirms channel open + epoch aligned | If snapshot shows channel closed → emit `BACKEND_CHANNEL_CLOSED` |
| `degraded` | Transport state + desired state | If transport is `connected` and registry available but machine hasn't transitioned → re-emit `BACKEND_DESIRED_OPEN` |

Implementation: the effect runner reads `facadeStore.backends[backendId]` (RuntimeCore's snapshot) as ground truth, compares against `RecoveryState.backends[backendId]`, and synthesizes correction events for any mismatch.

#### CatalogMachine

| State | Ground truth check | Correction |
| --- | --- | --- |
| `syncing_full` / `syncing_delta` | Time since sync started | If exceeded timeout and no response → emit `CATALOG_SYNC_TIMEOUT` |
| `ready` | Time since last sync (`lastSyncAt`) | If stale (> 5min for active backend, > 15min for non-active) → emit `CATALOG_SYNC_REQUESTED(delta)` to refresh |
| `stale` | Backend channel state | If backend channel is open but catalog hasn't started syncing → emit `CATALOG_SYNC_REQUESTED(full)` |

The `ready` state staleness check is the key addition: even when no events are lost, catalog data naturally ages. A periodic delta sync ensures the session list, ownership map, and provider list stay fresh. This replaces the old `startSessionSync()` 30s polling with a machine-integrated equivalent.

#### ActiveSessionMachine

| State | Ground truth check | Correction |
| --- | --- | --- |
| `live` | Stream open in facade snapshot; last message received within expected interval; message offset continuous | If stream closed in snapshot → emit `ACTIVE_SESSION_STREAM_CLOSED`. If offset gap detected → emit `ACTIVE_SESSION_CATCHUP_REQUESTED`. |
| `catching_up` / `hydrating_tail` | Time since phase started | If exceeded timeout → emit `ACTIVE_SESSION_RECOVERY_TIMEOUT` |
| `stale` | Owner backend state | If owner backend is `ready` and catalog is `ready` but machine hasn't started recovery → re-emit `CATALOG_SYNC_SUCCEEDED` to kick recovery |
| `opening_stream` | Time since stream open requested | If exceeded timeout → emit `ACTIVE_SESSION_RECOVERY_TIMEOUT` |

The `live` state check on message offset continuity catches silent stream data loss — the stream appears open but messages stop arriving or have gaps.

### Reconciliation vs event-driven: when each fires

```text
Normal operation:
  Event arrives → machine transitions immediately (ms latency)
  Reconcile tick → confirms state matches ground truth (30s latency, no-op)

Missed event scenario:
  Event lost → machine stuck in transient state
  Reconcile tick detects mismatch → synthesizes correction event → machine recovers
  Worst case recovery latency: one reconcile interval (30s)

Silent TCP drop:
  WS appears open → health probe may pass (WS.readyState still OPEN)
  But no data arrives → reconcile tick detects lastMessageAt staleness
  Correction: force reconnect
```

### Design constraints

1. **Reconciliation events are normal events.** They enter the reducer through the same `dispatch()` path as any other event. The reducer does not know whether an event came from the real event stream or from reconciliation. This keeps the reducer pure.
2. **Reconciliation must be idempotent.** If the state already matches ground truth, the tick produces no correction events. A tick that finds everything correct is a no-op.
3. **Reconciliation does not skip phases.** A correction moves the machine one step forward, not directly to the end state. For example, if BackendMachine is stuck in `opening` and reconciliation detects the channel is actually open, it synthesizes `BACKEND_CHANNEL_OPENED` — it does not jump directly to `ready`.
4. **Ground truth sources per machine:**
   - TransportMachine: `WebSocket.readyState`, `lastMessageAt` timestamp
   - BackendMachine: `facadeStore.backends[*]` (RuntimeCore snapshot)
   - CatalogMachine: `lastSyncAt` timestamp, backend channel state
   - ActiveSessionMachine: `facadeStore.sessionStreams[*]`, message offset tracking

## Event Tables

### RecoveryCoordinator event table

| Current State | Event | Guard | Actions | Next State |
| --- | --- | --- | --- | --- |
| `ready` | `APP_BACKGROUND` | - | Record `backgroundAt`; stop health probe | `background` |
| `background` | `APP_RESUME` | - | Increment transport generation; emit `TRANSPORT_CONNECT_REQUESTED`; emit `BACKEND_DESIRED_OPEN` for active backend if any | `recovering` |
| `ready` | `TRANSPORT_RECONNECTING` | generation matches | - | `recovering` |
| `recovering` | `TRANSPORT_CONNECTED` | generation matches | Wait for registry stabilization | `recovering` |
| `recovering` | `CATALOG_SYNC_SUCCEEDED` | backend is active backend and `selectedSessionId` is not null | Trigger session recovery | `recovering` |
| `recovering` | `CATALOG_SYNC_SUCCEEDED` | backend is active backend and `selectedSessionId` is null | Recovery complete | `ready` |
| `recovering` | `ACTIVE_SESSION_TAIL_RECOVERY_SUCCEEDED` | session is current session | Mark recovery complete | `ready` |
| `recovering` | `TRANSPORT_CONNECTED` | no active backend | Recovery complete (transport-only recovery) | `ready` |
| `recovering` | `TRANSPORT_ERROR` | generation matches and retries exhausted | Record terminal recovery error | `error` |
| `recovering` | `CATALOG_SYNC_FAILED` | backend is active backend and retries exhausted | Record catalog failure | `error` |
| `recovering` | `ACTIVE_SESSION_RECOVERY_FAILED` | retries exhausted | Record session recovery failure | `error` |
| `error` | `APP_RESUME` | - | Reset retry counts; start a new recovery generation | `recovering` |
| `error` | `NETWORK_ONLINE` | - | Start a new recovery generation | `recovering` |
| `ready` / `recovering` | `RECONCILE_TICK` | - | Dispatch tick to all active machines; run per-machine reconciliation checks (see [Periodic Reconciliation](#periodic-reconciliation)) | (unchanged) |

Note: `NETWORK_OFFLINE` is consumed by TransportMachine directly (see invariant 6). The coordinator observes the resulting `TRANSPORT_RECONNECTING` event.

### TransportMachine event table

| Current State | Event | Guard | Actions | Next State |
| --- | --- | --- | --- | --- |
| `idle` | `TRANSPORT_CONNECT_REQUESTED` | - | Open WebSocket (embedded: verify server process first); store generation | `connecting` |
| `connecting` | `TRANSPORT_CONNECTED` | generation matches | Clear error; start health probe | `connected` |
| `connecting` | `TRANSPORT_ERROR` | generation matches | Record error; schedule backoff retry if retries remain | `error` |
| `connected` | `TRANSPORT_RECONNECTING` | generation matches | Stop health probe; clear transport-authenticated markers | `reconnecting` |
| `connected` | `NETWORK_OFFLINE` | - | Stop health probe; increment generation | `reconnecting` |
| `connected` | `HEALTH_PROBE_FAILED` | generation matches | Stop health probe; increment generation; force reconnect | `reconnecting` |
| `reconnecting` | `TRANSPORT_CONNECTED` | generation matches | Clear error; restart health probe | `connected` |
| `reconnecting` | `TRANSPORT_ERROR` | generation matches | Record error | `error` |
| `error` | `TRANSPORT_CONNECT_REQUESTED` | generation newer than current | Retry connect | `connecting` |
| `connected` | `RECONCILE_TICK` | `lastMessageAt` older than 2× probe interval | Force reconnect; increment generation | `reconnecting` |
| `connecting` | `RECONCILE_TICK` | time in state > connect timeout | Emit `TRANSPORT_ERROR` | `error` |
| `reconnecting` | `RECONCILE_TICK` | time since last attempt > backoff cap | Emit `TRANSPORT_ERROR` | `error` |
| `*` | `TRANSPORT_STOPPED` | - | Cleanup | `stopped` |

Health probe runs on `connected` state only, every 25s (matching current `HEALTH_PROBE_INTERVAL_MS`). Probe failure triggers reconnect, not error.

### BackendMachine event table

| Current State | Event | Guard | Actions | Next State |
| --- | --- | --- | --- | --- |
| `absent` | `REGISTRY_BACKEND_VISIBLE` | - | Store epoch and presence metadata | `visible` |
| `visible` | `BACKEND_DESIRED_OPEN` | transport is `connected` | Issue `openBackendChannel` for current epoch | `opening` |
| `visible` | `BACKEND_DESIRED_OPEN` | transport is not `connected` | Store `desiredOpen = true` only | `visible` |
| `opening` | `BACKEND_CHANNEL_OPENED` | epoch matches current registry epoch | Set `channelReady = true`; store `channelId`, `channelEpoch`; if `catalogReady` also true → `ready` | `opening` or `ready` |
| `opening` | `CATALOG_SYNC_SUCCEEDED` | catalog epoch matches registry epoch | Set `catalogReady = true`; if `channelReady` also true → `ready` | `opening` or `ready` |
| `opening` | `BACKEND_CHANNEL_CLOSED` | - | Store reason | `degraded` |
| `ready` | `TRANSPORT_RECONNECTING` | - | Preserve `desiredOpen = true`, clear `channelReady`/`catalogReady` | `degraded` |
| `ready` | `REGISTRY_BACKEND_EPOCH_CHANGED` | - | Clear `channelReady`/`catalogReady`; carry forward desired open | `opening` |
| `ready` | `BACKEND_CHANNEL_CLOSED` | reason is `transport_disconnected` | Preserve desired open | `degraded` |
| `ready` | `BACKEND_DESIRED_CLOSE` | - | Close backend channel | `visible` |
| `degraded` | `TRANSPORT_CONNECTED` | `desiredOpen = true` and `REGISTRY_SNAPSHOT` received for current generation | Re-open backend channel | `opening` |
| `degraded` | `REGISTRY_SNAPSHOT` | `desiredOpen = true` and transport is `connected` | Re-open backend channel | `opening` |
| `degraded` | `BACKEND_DESIRED_OPEN` | transport is `connected` and registry snapshot current | Re-open backend channel | `opening` |
| `opening` | `BACKEND_RECOVERY_TIMEOUT` | - | Record error | `error` |
| `error` | `BACKEND_DESIRED_OPEN` | transport is `connected` and retries remain | Retry open | `opening` |
| `opening` | `RECONCILE_TICK` | facade snapshot shows channel open but `channelReady` is false | Synthesize `BACKEND_CHANNEL_OPENED` | `opening` or `ready` |
| `ready` | `RECONCILE_TICK` | facade snapshot shows channel closed | Synthesize `BACKEND_CHANNEL_CLOSED` | `degraded` |
| `degraded` | `RECONCILE_TICK` | transport `connected` + registry current + `desiredOpen` but still degraded | Re-emit `BACKEND_DESIRED_OPEN` | `opening` |
| `*` | `REGISTRY_BACKEND_REMOVED` | - | Clear backend runtime state | `absent` |

Key change from original: `degraded → opening` requires both transport connected AND registry snapshot received for current generation, preventing reopening with stale epoch data.

### CatalogMachine event table

| Current State | Event | Guard | Actions | Next State |
| --- | --- | --- | --- | --- |
| `idle` | `BACKEND_CHANNEL_OPENED` | - | Emit `CATALOG_SYNC_REQUESTED(full)` | `syncing_full` |
| `ready` | `APP_RESUME` | backend is active backend only | Emit `CATALOG_SYNC_REQUESTED(full)` | `syncing_full` |
| `ready` | `CATALOG_INVALIDATED` | - | Mark ownership stale; request full sync | `stale` |
| `stale` | `BACKEND_CHANNEL_OPENED` | - | Request full sync | `syncing_full` |
| `syncing_full` | `CATALOG_SYNC_SUCCEEDED` | epoch matches backend epoch | Replace catalog state; increment and publish ownership version | `ready` |
| `syncing_full` | `CATALOG_SYNC_FAILED` | retries remain | Schedule retry | `syncing_full` |
| `syncing_full` | `CATALOG_SYNC_FAILED` | retries exhausted | Record sync failure | `error` |
| `syncing_full` | `CATALOG_SYNC_TIMEOUT` | retries remain | Schedule retry | `syncing_full` |
| `syncing_full` | `CATALOG_SYNC_TIMEOUT` | retries exhausted | Record timeout | `error` |
| `syncing_full` | `CATALOG_SYNC_REQUESTED` | already syncing | Ignore (dedup) | `syncing_full` |
| `ready` | `CATALOG_SYNC_REQUESTED` | mode is `delta` | Start delta sync | `syncing_delta` |
| `syncing_delta` | `CATALOG_SYNC_SUCCEEDED` | - | Merge delta; update ownership version if needed | `ready` |
| `syncing_delta` | `CATALOG_SYNC_FAILED` | - | Downgrade to stale (will escalate to full sync) | `stale` |
| `syncing_delta` | `CATALOG_SYNC_TIMEOUT` | - | Downgrade to stale | `stale` |
| `ready` | `BACKEND_CHANNEL_CLOSED` | - | Invalidate catalog trust | `stale` |
| `ready` | `RECONCILE_TICK` | `lastSyncAt` older than staleness threshold (active: 5min, non-active: 15min) | Emit `CATALOG_SYNC_REQUESTED(delta)` | `syncing_delta` |
| `stale` | `RECONCILE_TICK` | backend channel is open but sync not started | Emit `CATALOG_SYNC_REQUESTED(full)` | `syncing_full` |
| `syncing_full` / `syncing_delta` | `RECONCILE_TICK` | time in state > sync timeout | Emit `CATALOG_SYNC_TIMEOUT` | (per timeout rules) |
| `error` | `BACKEND_CHANNEL_OPENED` | - | Reset retry count; retry full sync | `syncing_full` |

Key changes from original:
- `stale` recovery triggers on `BACKEND_CHANNEL_OPENED` (not `TRANSPORT_CONNECTED`), because catalog sync requires an open backend channel.
- `APP_RESUME` only triggers for the active backend (non-active backends sync lazily when selected).
- `syncing_full` receiving duplicate `CATALOG_SYNC_REQUESTED` is explicitly handled as no-op.
- Retry and timeout behavior is explicit in the table.

### ActiveSessionMachine event table

| Current State | Event | Guard | Actions | Next State |
| --- | --- | --- | --- | --- |
| `idle` | `ACTIVE_SESSION_SELECTED` | sessionId is not null | Start owner resolution | `resolving_owner` |
| `resolving_owner` | `ACTIVE_SESSION_OWNER_VERIFIED` | owner backend machine is `ready` | Open session stream | `opening_stream` |
| `resolving_owner` | `ACTIVE_SESSION_OWNER_VERIFIED` | owner backend machine is not `ready` | Wait for backend/catalog readiness | `waiting_backend_ready` |
| `waiting_backend_ready` | `CATALOG_SYNC_SUCCEEDED` | backend is verified owner backend | Open session stream | `opening_stream` |
| `waiting_backend_ready` | `ACTIVE_SESSION_RECOVERY_TIMEOUT` | - | Record timeout | `error` |
| `opening_stream` | `ACTIVE_SESSION_STREAM_OPENED` | - | Issue catch-up request | `catching_up` |
| `opening_stream` | `ACTIVE_SESSION_STREAM_CLOSED` | unexpected closure | Record stale state | `stale` |
| `opening_stream` | `ACTIVE_SESSION_RECOVERY_TIMEOUT` | - | Record timeout | `error` |
| `catching_up` | `ACTIVE_SESSION_CATCHUP_SUCCEEDED` | - | Issue tail recovery | `hydrating_tail` |
| `catching_up` | `ACTIVE_SESSION_RECOVERY_TIMEOUT` | - | Enter live with gap marker | `live` |
| `hydrating_tail` | `ACTIVE_SESSION_TAIL_RECOVERY_SUCCEEDED` | - | Mark active session live | `live` |
| `hydrating_tail` | `ACTIVE_SESSION_RECOVERY_TIMEOUT` | - | Enter live with gap marker | `live` |
| `live` | `ACTIVE_SESSION_STREAM_CLOSED` | unexpected closure | Mark stale | `stale` |
| `live` | `BACKEND_CHANNEL_CLOSED` | backend matches owner backend | Mark stale | `stale` |
| `stale` | `CATALOG_SYNC_SUCCEEDED` | backend matches owner backend | Re-resolve owner against latest ownership version | `resolving_owner` |
| `*` | `ACTIVE_SESSION_SELECTED` | selected session changed | Cancel current recovery and restart or go idle | `resolving_owner` or `idle` |
| `*` | `ACTIVE_SESSION_RECOVERY_FAILED` | - | Record failure | `error` |
| `live` | `RECONCILE_TICK` | facade snapshot shows stream closed | Synthesize `ACTIVE_SESSION_STREAM_CLOSED` | `stale` |
| `live` | `RECONCILE_TICK` | message offset gap detected | Emit `ACTIVE_SESSION_CATCHUP_REQUESTED` | `catching_up` |
| `stale` | `RECONCILE_TICK` | owner backend `ready` + catalog `ready` but machine idle | Synthesize `CATALOG_SYNC_SUCCEEDED` to kick recovery | `resolving_owner` |
| `catching_up` / `hydrating_tail` / `opening_stream` | `RECONCILE_TICK` | time in state > phase timeout | Emit `ACTIVE_SESSION_RECOVERY_TIMEOUT` | (per timeout rules) |
| `error` | `CATALOG_SYNC_SUCCEEDED` | owner backend is healthy again | Retry active session recovery | `resolving_owner` |

Key changes from original:
- Timeout events added for `waiting_backend_ready`, `opening_stream`, `catching_up`, and `hydrating_tail`.
- Catch-up and tail hydration timeout gracefully to `live` with a gap marker instead of entering `error`, allowing partial recovery.

## State Transition Diagrams

### Top-level recovery flow

```text
[READY]
   |
   | APP_BACKGROUND
   v
[BACKGROUND]
   |
   | APP_RESUME / TRANSPORT_RECONNECTING
   v
[RECOVERING]
   |
   | TRANSPORT_CONNECTED
   |   |
   |   +-- no active backend --> [READY]
   |   |
   |   v
   | REGISTRY_SNAPSHOT
   |   |
   |   v
   | BACKEND CHANNEL OPENED
   |   |
   |   v
   | CATALOG_SYNC_SUCCEEDED
   |   |
   |   +-- no selected session --> [READY]
   |   |
   |   v
   | ACTIVE_SESSION_TAIL_RECOVERY_SUCCEEDED
   |   |
   v   v
[READY]

error path:
RECOVERING -> retries exhausted -> [ERROR]
ERROR -> APP_RESUME / NETWORK_ONLINE -> [RECOVERING]
```

### TransportMachine

```text
[idle]
  | TRANSPORT_CONNECT_REQUESTED
  v
[connecting] -- TRANSPORT_ERROR --> [error]
  | TRANSPORT_CONNECTED              |
  v                                  | TRANSPORT_CONNECT_REQUESTED
[connected] <------------------------  (new generation)
  | NETWORK_OFFLINE / HEALTH_PROBE_FAILED / TRANSPORT_RECONNECTING
  v
[reconnecting]
  | TRANSPORT_CONNECTED
  v
[connected]

[*] -- TRANSPORT_STOPPED --> [stopped]
```

### BackendMachine

```text
[absent]
  | REGISTRY_BACKEND_VISIBLE
  v
[visible]
  | DESIRED_OPEN + transport connected
  v
[opening]
  | channelReady + catalogReady (order-independent)
  v
[ready]

[ready] -- TRANSPORT_RECONNECTING --------> [degraded]
[ready] -- EPOCH_CHANGED -----------------> [opening]
[ready] -- DESIRED_CLOSE -----------------> [visible]

[degraded] -- TRANSPORT_CONNECTED + REGISTRY_SNAPSHOT + desiredOpen --> [opening]
[opening] -- RECOVERY_TIMEOUT ----------------------------------------> [error]
[error] -- DESIRED_OPEN + retries remain ------------------------------> [opening]

[*] -- REGISTRY_BACKEND_REMOVED --> [absent]
```

### CatalogMachine

```text
[idle]
  | BACKEND_CHANNEL_OPENED
  v
[syncing_full]
  | success
  v
[ready]

[ready] -- APP_RESUME (active backend only) --> [syncing_full]
[ready] -- push delta ------------------------> [syncing_delta]
[ready] -- BACKEND_CHANNEL_CLOSED ------------> [stale]
[ready] -- CATALOG_INVALIDATED ---------------> [stale]
[syncing_delta] -- success -------------------> [ready]
[syncing_delta] -- failed/timeout ------------> [stale]
[stale] -- BACKEND_CHANNEL_OPENED ------------> [syncing_full]
[syncing_full] -- failed (retries left) ------> [syncing_full] (retry)
[syncing_full] -- failed (retries exhausted) -> [error]
[error] -- BACKEND_CHANNEL_OPENED ------------> [syncing_full]
```

### ActiveSessionMachine

```text
[idle]
  | SELECT_SESSION
  v
[resolving_owner]
  | owner verified + backend ready
  v
[opening_stream]
  | STREAM_OPENED
  v
[catching_up]
  | catch-up success
  v
[hydrating_tail]
  | tail merge success
  v
[live]

[resolving_owner] -- owner verified but backend not ready --> [waiting_backend_ready]
[waiting_backend_ready] -- catalog ready -------------------> [opening_stream]
[waiting_backend_ready] -- timeout -------------------------> [error]

[live] -- backend lost / stream closed --> [stale]
[stale] -- catalog ready ---------------> [resolving_owner]

[catching_up] -- timeout -----> [live] (with gap marker)
[hydrating_tail] -- timeout --> [live] (with gap marker)

[*] -- session switched --> [idle or resolving_owner]
[*] -- recovery failed --> [error]
[error] -- catalog ready --> [resolving_owner]
```

## Aggregated UI View State

The UI should not directly interpret low-level machine states independently. It should use a derived view state.

Suggested derived values:

- `offline`
- `transport_reconnecting`
- `backend_visible`
- `backend_opening`
- `backend_recovering` — was previously ready, now reconnecting (shows "Reconnecting..." instead of initial "Connecting...")
- `catalog_syncing`
- `session_syncing`
- `ready`
- `error`

Mapping logic:

```ts
function deriveBackendRecoveryViewState(input: {
  transport: TransportState;
  backend: BackendState | null;
  catalog: CatalogState | null;
  activeSession: ActiveSessionState | null;
  hasSelectedSession: boolean;
}): BackendRecoveryViewState {
  if (input.transport.status === 'error') return 'error';
  if (input.transport.status === 'connecting' || input.transport.status === 'reconnecting') {
    return 'transport_reconnecting';
  }

  if (!input.backend || input.backend.status === 'absent') return 'offline';
  if (input.backend.status === 'error') return 'error';
  if (input.backend.status === 'degraded') return 'backend_recovering';
  if (input.backend.status === 'visible') return 'backend_visible';
  if (input.backend.status === 'opening') return 'backend_opening';

  if (!input.catalog || input.catalog.status === 'stale' || input.catalog.status === 'syncing_full' || input.catalog.status === 'syncing_delta') {
    return 'catalog_syncing';
  }
  if (input.catalog.status === 'error') return 'error';

  if (input.hasSelectedSession) {
    if (!input.activeSession) return 'session_syncing';
    if (['resolving_owner', 'waiting_backend_ready', 'opening_stream', 'catching_up', 'hydrating_tail', 'stale'].includes(input.activeSession.status)) {
      return 'session_syncing';
    }
    if (input.activeSession.status === 'error') return 'error';
  }

  return 'ready';
}
```

Key change from original: `degraded` maps to `backend_recovering` (distinct from `backend_visible`) so the UI can show "Reconnecting..." for a previously-connected backend vs "Available" for a never-opened one.

## Recovery Sequence for the Current Bug Scenario

Initial state:

- transport: `connected`
- active backend: `ready`
- active backend catalog: `ready`
- active session: `live`

Foreground resume sequence:

1. `APP_RESUME`
2. `TransportMachine: connected -> reconnecting`
3. `BackendMachine(active): ready -> degraded`
4. `CatalogMachine(active): ready -> stale`
5. `ActiveSessionMachine(current): live -> stale`
6. `TRANSPORT_CONNECTED` (generation N)
7. `REGISTRY_SNAPSHOT` (generation N)
8. `BackendMachine(active): degraded -> opening` (registry confirmed, desired open)
9. `BACKEND_CHANNEL_OPENED`
10. `CatalogMachine(active): stale -> syncing_full`
11. `CATALOG_SYNC_SUCCEEDED(active)` (ownershipVersion incremented)
12. `BackendMachine(active): opening -> ready` (channelReady + catalogReady)
13. `CatalogMachine(active): syncing_full -> ready`
14. `ACTIVE_SESSION_OWNER_VERIFIED(currentSession, activeBackend, ownershipVersion)`
15. `ActiveSessionMachine: stale -> resolving_owner -> opening_stream`
16. `ACTIVE_SESSION_STREAM_OPENED`
17. `ACTIVE_SESSION_CATCHUP_REQUESTED`
18. `ACTIVE_SESSION_CATCHUP_SUCCEEDED`
19. `ACTIVE_SESSION_TAIL_RECOVERY_SUCCEEDED`
20. `ActiveSessionMachine: hydrating_tail -> live`
21. top-level recovery returns to `ready`

This removes the current failure mode where backend color recovers separately from session consistency.

## Core Architectural Changes Required

### 1. Single authoritative connection state

Current issue:

- `serverStore.connections[*].status` and facade-derived backend state both try to represent connectivity.

Proposed change:

- facade/runtime remains the source of truth
- `serverStore` retains selection and local process metadata only
- connection badges and route guards read from selectors derived from the recovery state

### 2. Desired state instead of user-triggered repair

Current issue:

- re-selecting the same backend manually repairs channel state by reissuing `openBackend`

Proposed change:

- `desiredOpenBackends` remains persistent and is part of the recovery state model (delegated to RuntimeCore)
- reconnect automatically restores all desired backends
- UI selection changes desired state, not transport state directly

### 3. Verified ownership

Current issue:

- session ownership is used as a routing primitive even when catalog/session state may be stale

Proposed change:

- ownership carries client-local `ownershipVersion`
- active session API routing depends on verified ownership only
- recovery-time message fetches can explicitly route via `backendId` until ownership is verified

### 4. Separate catalog recovery from content recovery

Current issue:

- session list sync and message catch-up are partially mixed and can run too early

Proposed change:

- `CatalogMachine` owns session/project/provider snapshot and ownership refresh
- `ActiveSessionMachine` owns stream, gap fill, and tail hydration

## Suggested Data Structures

```ts
type TransportState = {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';
  mode: 'embedded' | 'direct';
  generation: number;
  peerSessionId: string | null;
  error: string | null;
  retryCount: number;
  healthProbeActive: boolean;
  lastMessageAt: number | null;       // for reconciliation: detect silent TCP drops
  statusEnteredAt: number;            // for reconciliation: detect stuck states
};

type BackendState = {
  backendId: string;
  status: 'absent' | 'visible' | 'opening' | 'ready' | 'degraded' | 'error';
  desiredOpen: boolean;
  registryEpoch: number | null;
  channelEpoch: number | null;
  catalogEpoch: number | null;
  channelId: string | null;
  channelReady: boolean;
  catalogReady: boolean;
  lastError: string | null;
  lastCloseReason: string | null;
  retryCount: number;
  statusEnteredAt: number;            // for reconciliation: detect stuck opening/degraded
};

type CatalogState = {
  backendId: string;
  status: 'idle' | 'stale' | 'syncing_full' | 'syncing_delta' | 'ready' | 'error';
  revision: number;
  ownershipVersion: number;
  lastError: string | null;
  retryCount: number;
  lastSyncAt: number | null;          // for reconciliation: detect stale catalog
  statusEnteredAt: number;            // for reconciliation: detect stuck syncing
};

type ActiveSessionState = {
  sessionId: string | null;
  status: 'idle' | 'resolving_owner' | 'waiting_backend_ready' | 'opening_stream' | 'catching_up' | 'hydrating_tail' | 'live' | 'stale' | 'error';
  backendId: string | null;
  ownershipVersion: number | null;
  streamOpen: boolean;
  lastRecoveredOffset: number | null;
  hasGapMarker: boolean;
  lastError: string | null;
  retryCount: number;
  lastMessageAt: number | null;       // for reconciliation: detect silent stream data loss
  statusEnteredAt: number;            // for reconciliation: detect stuck phases
};

type RecoveryState = {
  coordinator: 'ready' | 'background' | 'recovering' | 'error';
  transport: TransportState;
  activeBackendId: string | null;
  selectedSessionId: string | null;
  backends: Record<string, BackendState>;
  catalogs: Record<string, CatalogState>;
  activeSession: ActiveSessionState;
  nextOwnershipVersion: number;
  backgroundAt: number | null;
};
```

## Reducer and Effect Split

State transitions should remain pure. Network effects and facade commands should be emitted by an effect runner.

Pattern:

1. reducer consumes `RecoveryEvent`
2. reducer returns new state plus effect intents
3. effect runner executes commands (delegates to RuntimeCore facade methods)
4. command results re-enter as `RecoveryEvent`

Suggested effect intents:

```ts
type RecoveryEffect =
  | { type: 'OPEN_TRANSPORT'; generation: number }
  | { type: 'FORCE_RECONNECT_TRANSPORT'; generation: number }
  | { type: 'CHECK_SERVER_PROCESS' }  // embedded mode only
  | { type: 'OPEN_BACKEND'; backendId: string; epoch: number }
  | { type: 'CLOSE_BACKEND'; backendId: string; channelId: string }
  | { type: 'SYNC_CATALOG_FULL'; backendId: string }
  | { type: 'SYNC_CATALOG_DELTA'; backendId: string; sinceRevision: number }
  | { type: 'OPEN_ACTIVE_SESSION_STREAM'; backendId: string; sessionId: string }
  | { type: 'RECOVER_ACTIVE_SESSION_GAP'; backendId: string; sessionId: string }
  | { type: 'RECOVER_ACTIVE_SESSION_TAIL'; backendId: string; sessionId: string }
  | { type: 'START_HEALTH_PROBE'; intervalMs: number }
  | { type: 'STOP_HEALTH_PROBE' }
  | { type: 'START_TIMEOUT'; key: string; durationMs: number; timeoutEvent: RecoveryEvent }
  | { type: 'CANCEL_TIMEOUT'; key: string }
  | { type: 'START_RECONCILE_TIMER'; intervalMs: number }
  | { type: 'STOP_RECONCILE_TIMER' }
  | { type: 'RECONCILE_TRANSPORT'; generation: number }
  | { type: 'RECONCILE_BACKEND'; backendId: string }
  | { type: 'RECONCILE_CATALOG'; backendId: string }
  | { type: 'RECONCILE_ACTIVE_SESSION'; sessionId: string; backendId: string };
```

Effect runner implementation notes:
- `OPEN_BACKEND` delegates to `facade.openBackend()` (RuntimeCore method)
- `SYNC_CATALOG_FULL` delegates to HTTP fetch of sessions/projects/providers (current `useDataLoader` + `sessionSync` logic)
- `START_TIMEOUT` / `CANCEL_TIMEOUT` manage per-phase timers; on expiry the `timeoutEvent` is dispatched back to the reducer
- `RECONCILE_*` effects read ground truth (WS state, facade snapshot, timestamps) and dispatch correction events back to the reducer if mismatches are found. They are triggered by `RECONCILE_TICK` in the coordinator.
- Effects carry no state — all decisions are in the reducer

## Store Integration Strategy

The recovery state machine replaces the role of several existing integration points. This section specifies what changes for each.

### facadeStore

**Kept.** Continues to cache the latest `BackendFacadeSnapshot` from RuntimeCore. The recovery coordinator reads it but does not write to it.

### serverStore

**Narrowed.** Retains:
- `activeServerId` — user's backend selection
- `localServerPort` — embedded server process port
- `controlPlaneMode` — embedded vs direct

**Removed from serverStore:**
- `connections[*].status` — replaced by `RecoveryState.backends[*].status` via derived selector
- `controlPlaneState` — replaced by `RecoveryState.transport.status`

Migration: a compatibility selector `getServerConnectionStatus(serverId)` maps `RecoveryState.backends[serverId].status` to the old `'connected' | 'connecting' | 'disconnected' | 'error'` type during the transition period.

### useDataLoader

**Replaced by CatalogMachine effects.** The current trigger (`isActiveConnected` from serverStore) is replaced by `CATALOG_SYNC_REQUESTED` effects from the CatalogMachine. Data loading becomes an effect, not a React hook side effect.

### sessionSync.ts

**Split.** Catalog sync functions move under CatalogMachine effects. Message catch-up functions move under ActiveSessionMachine effects. The file can be deleted once both machines are fully operational.

### syncToGatewayStore (useBackendFacade.ts:176-387)

**Replaced by RecoveryCoordinator.** The event listener on `facade.onEvent()` routes events to the recovery coordinator instead of directly updating stores. The coordinator's derived state feeds the UI.

During migration, both paths can coexist (coordinator + syncToGatewayStore) with the UI progressively switching to recovery-derived selectors.

## Design Decisions

These decisions resolve the open questions from the original review.

### 1. CatalogMachine requires explicit channel-open

Catalog sync requires an open backend channel to issue HTTP requests through (the channel provides the routing context). `BACKEND_CHANNEL_OPENED` is the trigger for catalog sync, not `TRANSPORT_CONNECTED`. This is reflected in the CatalogMachine event table.

### 2. Only active backend syncs eagerly on resume

Non-active desired backends remain in `degraded → opening → ready` (channel reopen), but their CatalogMachine stays in `stale` until the user selects them. This minimizes recovery latency by focusing on the active backend. When a user switches to a non-active backend, the selection triggers `CATALOG_SYNC_REQUESTED(full)`.

### 3. Run-stream cursor is tracked explicitly

`ActiveSessionState.lastRecoveredOffset` stores the highest message offset received. After reconnect, catch-up requests use this offset to fetch only missing messages. This avoids relying on inference from store state which can be inconsistent after partial recovery.

### 4. Ownership version is per-backend

Each backend's `CatalogState` carries its own `ownershipVersion`. A catalog sync completing on backend B1 does not affect B2's ownership version. This prevents cross-backend interference when backends recover at different rates.

## Migration Plan

### Phase 1a: Recovery state model

Introduce `RecoveryState` data structure and `TransportMachine`.

- Add recovery state as a new Zustand store slice
- Wire coordinator to consume RuntimeCore events (via `facade.onEvent()` listener)
- Tag events with transport generation
- TransportMachine tracks transport state with generation
- Derive UI badges from recovery selectors alongside existing sources (dual-read)
- Existing stores and effects remain untouched

### Phase 1b: BackendMachine

Replace per-backend status tracking.

- BackendMachine consumes registry + channel events from RuntimeCore
- `serverStore.connections[*].status` becomes a derived selector from `RecoveryState.backends`
- Remove direct status writes from `syncToGatewayStore()` for backend state
- `useDataLoader` still triggers on derived status (behavioral parity)

### Phase 2: Coordinator + CatalogMachine

Move backend reopen and catalog sync under the coordinator.

- Foreground resume triggers coordinator recovery sequence
- Remove `eagerSyncAllBackends()` call from `appLifecycleManager.onResume()`
- CatalogMachine issues `SYNC_CATALOG_FULL` effects; effect runner calls current HTTP fetch logic
- `useDataLoader` hook is replaced by catalog sync effects
- Ownership versioning activated

### Phase 3: ActiveSessionMachine

Move active session stream recovery under the machine.

- Replace ad hoc `eagerSyncCurrentSession` / `recoverCurrentSessionTail` timing with explicit machine transitions
- Make tail hydration part of standard recovery with timeout
- `sessionSync.ts` message catch-up functions absorbed into ActiveSessionMachine effects

### Phase 4: Cleanup

Delete duplicated status propagation.

- Remove `syncToGatewayStore()` function
- Remove `serverStore.connections[*].status` and `serverStore.controlPlaneState`
- Remove `sessionSync.ts` (all responsibilities moved to machines)
- All UI components read from recovery-derived selectors only

## Recommended Next Step

If this design is accepted, the next document should specify:

1. exact reducer slices (one per machine)
2. effect runner API and its mapping to RuntimeCore facade methods
3. Zustand store structure for RecoveryState
4. integration test scenarios covering the recovery sequence and timeout paths
