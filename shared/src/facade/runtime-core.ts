/**
 * BackendFacadeRuntimeCore
 *
 * Shared runtime core for both Embedded and Direct providers.
 * Coordinates FacadeRegistryStore and FacadeStreamManager,
 * consumes adapter events, assembles snapshots, and emits facade events.
 *
 * Pure ES2022 — no platform dependencies, no timers, no EventEmitter.
 *
 * See docs/design/backend-facade.md § "BackendFacadeRuntimeCore"
 */

import type {
  BackendFacadeRuntimeCoreOptions,
  FacadeAdapterEvent,
  FacadeRuntimeGatewayAdapter,
} from './adapter.js';
import { FacadeRegistryStore } from './registry-store.js';
import { assembleSnapshot } from './snapshot.js';
import { FacadeStreamManager } from './stream-manager.js';
import type {
  BackendConnectionState,
  BackendFacade,
  BackendFacadeEvent,
  BackendFacadeMode,
  BackendFacadeSnapshot,
  BackendStateDiff,
  StreamManagerResult,
} from './types.js';
import type { BackendPresence } from '../protocol/gateway.js';
import type { ClientMessage } from '../protocol/messages.js';

// ============================================================================
// BackendFacadeRuntimeCore
// ============================================================================

export class BackendFacadeRuntimeCore implements BackendFacade {
  private readonly adapter: FacadeRuntimeGatewayAdapter;
  private readonly mode: BackendFacadeMode;
  private readonly localBackendMatcher?: (
    presence: BackendPresence,
    identity: { instanceId: string; deviceId: string },
  ) => boolean;
  private readonly onLocalBackendIdChanged?: (backendId: string | null) => void;

  private readonly registryStore = new FacadeRegistryStore();
  private readonly streamManager = new FacadeStreamManager();

  private connectionState: BackendConnectionState = 'idle';
  private localBackendId: string | null = null;
  private desiredOpenBackends = new Set<string>();
  private currentInstanceId: string | null = null;
  private currentDeviceId: string | null = null;

  private snapshotVersion = 0;
  private initialized = false;
  private eventBuffer: FacadeAdapterEvent[] | null = null;
  private unsubscribeAdapter: (() => void) | null = null;

  private snapshotListeners: Array<(snapshot: BackendFacadeSnapshot) => void> = [];
  private eventListeners: Array<(event: BackendFacadeEvent) => void> = [];

  constructor(options: BackendFacadeRuntimeCoreOptions) {
    this.adapter = options.adapter;
    this.mode = options.mode;
    this.localBackendMatcher = options.localBackendMatcher;
    this.onLocalBackendIdChanged = options.onLocalBackendIdChanged;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  connect(): void {
    this.start();
  }

  disconnect(): void {
    this.stop();
  }

  start(): void {
    if (this.unsubscribeAdapter) return; // already started

    // 1. Subscribe to adapter events — buffer during initialization
    this.eventBuffer = [];
    this.unsubscribeAdapter = this.adapter.events.subscribe(event => {
      if (!this.initialized) {
        this.eventBuffer!.push(event);
      } else {
        this.handleAdapterEvent(event);
      }
    });

    // 2. Query bootstrap state
    const bootstrap = this.adapter.queries.bootstrap.getInitialState();

    // 3. Initialize stores
    this.registryStore.applyBootstrap(bootstrap);
    this.streamManager.applyBootstrap();

    // 4. Record identity
    this.connectionState = bootstrap.connection.state as BackendConnectionState;
    this.currentInstanceId = bootstrap.identity.instanceId;
    this.currentDeviceId = bootstrap.identity.deviceId;

    // 5. Identify local backend
    this.localBackendId = null;
    if (this.localBackendMatcher) {
      const identity = { instanceId: bootstrap.identity.instanceId, deviceId: bootstrap.identity.deviceId };
      for (const item of bootstrap.registry.items) {
        if (this.localBackendMatcher(item, identity)) {
          this.localBackendId = item.backendId;
          break;
        }
      }
    }
    if (this.localBackendId && this.onLocalBackendIdChanged) {
      this.onLocalBackendIdChanged(this.localBackendId);
    }

    // 6. Replay buffered events
    const buffer = this.eventBuffer!;
    this.eventBuffer = null;
    this.initialized = true;
    for (const event of buffer) {
      this.handleAdapterEvent(event);
    }

    // 7. Emit initial snapshot
    this.publishSnapshotUpdate();
  }

  stop(): void {
    if (this.unsubscribeAdapter) {
      this.unsubscribeAdapter();
      this.unsubscribeAdapter = null;
    }
    this.initialized = false;
    this.eventBuffer = null;
    this.connectionState = 'disconnected';
    this.localBackendId = null;
    this.snapshotVersion = 0;
    // Reset stores so stale data isn't accessible via getSnapshot()
    this.registryStore.applyBootstrap({
      capturedAt: 0,
      connection: { state: 'disconnected' },
      identity: { instanceId: '', deviceId: '' },
      registry: { items: [] },
      subscriptions: { backendIds: [] },
    });
    this.streamManager.applyBootstrap();
    // Notify listeners of the disconnected state so UI can react to programmatic shutdown
    this.emitFacadeEvent({ type: 'connection_state_changed', state: 'disconnected' });
  }

  // --------------------------------------------------------------------------
  // BackendFacade — Snapshot & Subscription
  // --------------------------------------------------------------------------

  getSnapshot(): BackendFacadeSnapshot {
    return assembleSnapshot({
      version: this.snapshotVersion,
      now: Date.now(),
      mode: this.mode,
      connectionState: this.connectionState,
      localBackendId: this.localBackendId,
      currentInstanceId: this.currentInstanceId,
      currentDeviceId: this.currentDeviceId,
      backends: this.registryStore.getAllBackends(),
      streams: this.streamManager.getAllStreams(),
    });
  }

  subscribe(listener: (snapshot: BackendFacadeSnapshot) => void): () => void {
    this.snapshotListeners.push(listener);
    return () => {
      const idx = this.snapshotListeners.indexOf(listener);
      if (idx >= 0) this.snapshotListeners.splice(idx, 1);
    };
  }

  onEvent(listener: (event: BackendFacadeEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  // --------------------------------------------------------------------------
  // BackendFacade — Backend Operations
  // --------------------------------------------------------------------------

  openBackend(backendId: string): void {
    this.desiredOpenBackends.add(backendId);
    const backend = this.registryStore.getBackend(backendId);
    if (!backend || !backend.presence) return;

    const diffs = this.registryStore.markSubscribing(backendId);
    this.adapter.commands.backend.subscribe(backendId);
    // For local backends, the subscribe + catalog init may complete synchronously,
    // advancing the state to 'ready'. Only emit the 'subscribing' diffs if the state
    // hasn't already progressed beyond them.
    const currentBackend = this.registryStore.getBackend(backendId);
    if (currentBackend && currentBackend.runtimeState === 'subscribing') {
      this.emitBackendDiffs(diffs);
    }
  }

  closeBackend(backendId: string): void {
    this.desiredOpenBackends.delete(backendId);
    const backend = this.registryStore.getBackend(backendId);
    if (!backend || !backend.subscribed) return;

    this.adapter.commands.backend.unsubscribe(backendId);
    const diffs = this.registryStore.markUnsubscribed(backendId, 'user_closed');
    this.emitBackendDiffs(diffs);

    // Notify stream manager
    const streamResult = this.streamManager.handleBackendUnsubscribed(
      backendId, 'user_closed', { willAutoRecover: false },
    );
    this.executeStreamResult(streamResult);
  }

  sendToBackend(backendId: string, message: ClientMessage): void {
    const backend = this.registryStore.getBackend(backendId);
    if (!backend || !backend.subscribed) return;
    this.adapter.commands.backend.sendToBackend(backendId, message);
  }

  // --------------------------------------------------------------------------
  // BackendFacade — Session Stream Operations
  // --------------------------------------------------------------------------

  openSessionStream(backendId: string, sessionId: string): void {
    const backend = this.registryStore.getBackend(backendId);
    const result = this.streamManager.requestOpen(backendId, sessionId, {
      backendReady: backend?.runtimeState === 'ready',
    });
    this.executeStreamResult(result);
  }

  closeSessionStream(backendId: string, sessionId: string): void {
    const result = this.streamManager.requestClose(backendId, sessionId);
    this.executeStreamResult(result);
  }

  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void {
    const backend = this.registryStore.getBackend(backendId);
    if (!backend || !backend.subscribed) return;
    this.adapter.commands.stream.catchUp(backendId, sessionId, afterOffset);
  }

  // --------------------------------------------------------------------------
  // BackendFacade — HTTP
  // --------------------------------------------------------------------------

  getHttpBaseUrl(backendId: string): string | null {
    return this.adapter.queries.http.getBaseUrl(backendId);
  }

  getHttpHeaders(): Record<string, string> {
    return this.adapter.queries.http.getHeaders();
  }

  // --------------------------------------------------------------------------
  // GC (caller schedules timer externally)
  // --------------------------------------------------------------------------

  collectGarbage(now: number): void {
    const result = this.streamManager.collectGarbage(now);
    this.executeStreamResult(result);
    // Fix #16: also GC zombie registry records
    this.registryStore.collectGarbage();
  }

  // --------------------------------------------------------------------------
  // Adapter Event Dispatch
  // --------------------------------------------------------------------------

  private handleAdapterEvent(event: FacadeAdapterEvent): void {
    switch (event.type) {
      case 'connection_state_changed':
        this.handleConnectionStateChanged(event);
        break;
      case 'registry_snapshot_received':
        this.handleRegistrySnapshot(event);
        break;
      case 'backend_subscribed':
        this.handleBackendSubscribed(event);
        break;
      case 'backend_unsubscribed':
        this.handleBackendUnsubscribed(event);
        break;
      case 'backend_data_snapshot_received':
        this.handleBackendDataSnapshot(event);
        break;
      case 'backend_data_event_received':
        this.handleBackendDataEvent(event);
        break;
      case 'session_stream_closed':
        this.handleSessionStreamClosed(event);
        break;
      case 'content_patch_received':
        this.handleContentPatch(event);
        break;
      case 'content_patch_failed':
        this.handleContentPatchFailed(event);
        break;
      case 'run_event_received':
        this.handleRunEvent(event);
        break;
      case 'backend_message_received':
        this.handleBackendMessage(event);
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Connection
  // --------------------------------------------------------------------------

  private handleConnectionStateChanged(event: Extract<FacadeAdapterEvent, { type: 'connection_state_changed' }>): void {
    this.connectionState = event.state as BackendConnectionState;
    this.emitFacadeEvent({
      type: 'connection_state_changed',
      state: this.connectionState,
      error: event.error,
    });
  }

  // --------------------------------------------------------------------------
  // Registry
  // --------------------------------------------------------------------------

  private handleRegistrySnapshot(event: Extract<FacadeAdapterEvent, { type: 'registry_snapshot_received' }>): void {
    const diffs = this.registryStore.applyRegistrySnapshot(event.items);

    // Re-evaluate local backend
    this.updateLocalBackendId(event.items);

    this.emitBackendDiffs(diffs);

    // Auto-reopen desired backends that became visible after reconnect
    this.reopenDesiredBackends();
  }

  // --------------------------------------------------------------------------
  // Subscription
  // --------------------------------------------------------------------------

  private handleBackendSubscribed(event: Extract<FacadeAdapterEvent, { type: 'backend_subscribed' }>): void {
    const diffs = this.registryStore.markSubscribed(
      event.backendId, event.epoch, event.capabilities,
    );

    // Backend data snapshot will be pushed automatically by the backend
    // (gateway sends request_backend_data_snapshot on subscribe).
    // Only emit diffs if data hasn't already initialized synchronously.
    const currentBackend = this.registryStore.getBackend(event.backendId);
    if (!currentBackend || currentBackend.runtimeState !== 'ready') {
      this.emitBackendDiffs(diffs);
    }
  }

  private handleBackendUnsubscribed(event: Extract<FacadeAdapterEvent, { type: 'backend_unsubscribed' }>): void {
    const backend = this.registryStore.getBackend(event.backendId);

    const diffs = this.registryStore.markUnsubscribed(
      event.backendId, event.reason,
    );

    // Notify stream manager
    const willAutoRecover = backend?.presence !== null;
    const streamResult = this.streamManager.handleBackendUnsubscribed(
      event.backendId, event.reason, { willAutoRecover },
    );
    this.executeStreamResult(streamResult);

    this.emitBackendDiffs(diffs);
  }

  // --------------------------------------------------------------------------
  // Backend Data
  // --------------------------------------------------------------------------

  private handleBackendDataSnapshot(event: Extract<FacadeAdapterEvent, { type: 'backend_data_snapshot_received' }>): void {
    const diffs = this.registryStore.markDataInitialized(event.backendId);

    // Emit backend data snapshot event
    this.emitFacadeEvent({
      type: 'backend_data_snapshot',
      backendId: event.backendId,
      sessions: event.sessions,
      projects: event.projects,
    });

    // Check if backend became ready → trigger stream auto-resume
    const backend = this.registryStore.getBackend(event.backendId);
    if (backend && backend.runtimeState === 'ready' && backend.subscribed) {
      const streamResult = this.streamManager.handleBackendBecameReady(event.backendId);
      this.executeStreamResult(streamResult);
    }

    this.emitBackendDiffs(diffs);
  }

  private handleBackendDataEvent(event: Extract<FacadeAdapterEvent, { type: 'backend_data_event_received' }>): void {
    this.emitFacadeEvent({
      type: 'backend_data_event',
      backendId: event.backendId,
      event: event.event,
    });
  }

  // --------------------------------------------------------------------------
  // Session Stream Events
  // --------------------------------------------------------------------------

  private handleSessionStreamClosed(event: Extract<FacadeAdapterEvent, { type: 'session_stream_closed' }>): void {
    const result = this.streamManager.handleSessionStreamClosed(
      event.backendId, event.sessionId, event.reason,
    );
    this.executeStreamResult(result);
  }

  private handleContentPatch(event: Extract<FacadeAdapterEvent, { type: 'content_patch_received' }>): void {
    const result = this.streamManager.handleContentPatch(
      event.backendId, event.sessionId,
      event.messages, event.latestOffset,
    );
    this.executeStreamResult(result);
  }

  private handleContentPatchFailed(event: Extract<FacadeAdapterEvent, { type: 'content_patch_failed' }>): void {
    this.emitFacadeEvent({
      type: 'content_patch_failed',
      backendId: event.backendId,
      sessionId: event.sessionId,
      afterOffset: event.afterOffset,
      error: event.error,
    });
  }

  private handleRunEvent(event: Extract<FacadeAdapterEvent, { type: 'run_event_received' }>): void {
    const result = this.streamManager.handleRunEvent(
      event.backendId, event.sessionId, event.event,
    );
    this.executeStreamResult(result);
  }

  private handleBackendMessage(event: Extract<FacadeAdapterEvent, { type: 'backend_message_received' }>): void {
    // Pass through as run_event so the UI message handler can process it.
    // This covers system_info, permission_request, prompt_request, and other
    // non-stream messages that arrive via channel_server_message.
    // Extract sessionId from message if available (many ServerMessage types carry it)
    const msg = event.message as unknown as { sessionId?: string };
    const sessionId = msg.sessionId ?? '';
    this.emitFacadeEvent({
      type: 'run_event',
      backendId: event.backendId,
      sessionId,
      event: event.message,
    });
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  /** Reopen backends the user previously opened that are now visible but closed/stuck (e.g. after reconnect). */
  private reopenDesiredBackends(): void {
    for (const backendId of this.desiredOpenBackends) {
      const backend = this.registryStore.getBackend(backendId);
      if (!backend || !backend.presence) continue;

      // Reopen unsubscribed or errored backends
      if (backend.openState === 'unsubscribed' || backend.openState === 'error') {
        this.openBackend(backendId);
        continue;
      }

      // Unstick backends that are subscribed but haven't received data yet.
      // This can happen after reconnection — the gateway will request
      // a data snapshot from the backend when we re-subscribe, but if
      // that didn't arrive, we remain in 'subscribing'. No client-side
      // action needed; the backend will push data on the next heartbeat cycle.
    }
  }

  /** Clear desired state. Call on intentional disconnect to prevent stale state on next connect. */
  clearDesiredState(): void {
    this.desiredOpenBackends.clear();
  }

  private updateLocalBackendId(items: BackendPresence[]): void {
    if (!this.localBackendMatcher || !this.currentInstanceId || !this.currentDeviceId) return;
    const prev = this.localBackendId;
    const identity = { instanceId: this.currentInstanceId, deviceId: this.currentDeviceId };
    let matched = false;
    for (const item of items) {
      if (this.localBackendMatcher(item, identity)) {
        this.localBackendId = item.backendId;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Fix #7: if no match found in current items, check if local backend still exists in registry
      if (this.localBackendId) {
        const stillExists = this.registryStore.getBackend(this.localBackendId);
        if (!stillExists || !stillExists.presence) {
          this.localBackendId = null;
        }
      }
    }
    if (this.localBackendId !== prev && this.onLocalBackendIdChanged) {
      this.onLocalBackendIdChanged(this.localBackendId);
    }
  }

  private executeStreamResult(result: StreamManagerResult): void {
    // Execute commands via adapter
    for (const cmd of result.commands) {
      switch (cmd.type) {
        case 'catch_up_content':
          this.adapter.commands.stream.catchUp(cmd.backendId, cmd.sessionId, cmd.afterOffset);
          break;
        // open_session_stream and close_session_stream are now local-only operations
        // (stream state is managed internally; the gateway delivers events based on subscription)
      }
    }

    // Broadcast events
    for (const evt of result.events) {
      this.emitFacadeEvent(evt);
    }
  }

  /** Fix #3: proper type-safe emit for backend diffs */
  private emitBackendDiffs(diffs: BackendStateDiff[]): void {
    for (const diff of diffs) {
      this.emitFacadeEvent({
        type: 'backend_state_changed',
        backendId: diff.backendId,
        state: diff.nextRuntimeState,
        error: diff.reason,
      });
    }
  }

  /** Increment version and broadcast the latest snapshot to all consumers. */
  private publishSnapshotUpdate(): void {
    this.snapshotVersion++;
    const snapshot = this.getSnapshot();
    for (const listener of this.snapshotListeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener errors must not break dispatch
      }
    }

    for (const listener of this.eventListeners) {
      try {
        listener({
          type: 'snapshot_updated',
          snapshot,
        });
      } catch {
        // Listener errors must not break dispatch
      }
    }
  }

  private emitFacadeEvent(event: BackendFacadeEvent): void {
    // Emit to event listeners
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not break event dispatch
      }
    }

    // Fix #2: notify snapshot listeners on ALL state-changing events, not just snapshot_updated
    switch (event.type) {
      case 'connection_state_changed':
      case 'backend_state_changed':
      case 'session_stream_state_changed':
        this.publishSnapshotUpdate();
        break;
      // catalog/run/content events don't change facade snapshot state
    }
  }
}
