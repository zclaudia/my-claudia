/**
 * Gateway Internal State Management
 *
 * Implements §16 (Gateway State Responsibilities) of the Gateway Sync Protocol.
 * All in-memory state for peer sessions, registry, catalog, channels, and stream demand.
 */

import type {
  BackendPresence,
  RegistryEvent,
  RegistryRevision,
  BackendId,
  Epoch,
  PeerSessionId,
  ChannelId,
  CatalogRevision,
  SessionCatalogItem,
  CatalogDeltaEvent,
} from '@my-claudia/shared';
import type { WebSocket } from 'ws';

// ============================================================================
// Peer Session State
// ============================================================================

export interface PeerSession {
  peerSessionId: PeerSessionId;
  ws: WebSocket;
  peerType: 'client-only' | 'client+backend';
  deviceId: string;
  instanceId: string;
  channel: string;
  name: string;
  recoveryToken: string;
  isAlive: boolean;

  /** If peerType === 'client+backend', the registered backend info. */
  backendId?: BackendId;
  epoch?: Epoch;

  /** Catalog subscriptions this peer holds (as client). backendId set. */
  catalogSubscriptions: Set<BackendId>;

  /** Channel IDs this peer holds (as client). */
  channels: Set<ChannelId>;
}

// ============================================================================
// Registry State
// ============================================================================

export interface RegistryState {
  /** Current revision (monotonically increasing). */
  revision: RegistryRevision;

  /** Online backends. */
  items: Map<BackendId, BackendPresence>;

  /** Event log window for incremental recovery. */
  eventLog: RegistryEvent[];

  /** Max events to keep in the log window. */
  eventLogMaxSize: number;
}

// ============================================================================
// Backend Lease State
// ============================================================================

export interface BackendLease {
  backendId: BackendId;
  epoch: Epoch;
  peerSessionId: PeerSessionId;
  leaseTtlMs: number;
  lastHeartbeatAt: number;
  leaseTimer: ReturnType<typeof setTimeout> | null;
}

// ============================================================================
// Catalog State (per-backend)
// ============================================================================

export interface BackendCatalogState {
  backendId: BackendId;
  epoch: Epoch;
  revision: CatalogRevision;
  items: Map<string, SessionCatalogItem>;

  /** Event log window for incremental recovery. */
  eventLog: CatalogDeltaEvent[];

  /** Peer session IDs subscribed to this catalog. */
  subscribers: Set<PeerSessionId>;
}

// ============================================================================
// Channel State
// ============================================================================

export interface ChannelState {
  channelId: ChannelId;
  backendId: BackendId;
  epoch: Epoch;
  peerSessionId: PeerSessionId;

  /** Session IDs with open streams on this channel. */
  openStreams: Set<string>;
}

// ============================================================================
// Stream Demand State (per-backend)
// ============================================================================

export interface StreamDemandState {
  /** Number of open channels to this backend. */
  channelCount: number;

  /** Current demand state sent to backend. */
  active: boolean;
}

// ============================================================================
// Gateway V2 State Manager
// ============================================================================

export interface GatewayStateConfig {
  /** Max events in registry event log window. Default: 1000. */
  registryEventLogMaxSize?: number;
  /** Max events in per-backend catalog event log window. Default: 1000. */
  catalogEventLogMaxSize?: number;
  /** Default lease TTL in ms. Default: 30000. */
  defaultLeaseTtlMs?: number;
}

export class GatewayState {
  // --- Peer sessions ---
  readonly peers = new Map<PeerSessionId, PeerSession>();
  readonly wsToPeer = new Map<WebSocket, PeerSession>();

  // --- Registry ---
  readonly registry: RegistryState;

  // --- Backend leases ---
  readonly leases = new Map<BackendId, BackendLease>();

  // --- Catalog (per-backend) ---
  readonly catalogs = new Map<BackendId, BackendCatalogState>();

  // --- Channels ---
  readonly channels = new Map<ChannelId, ChannelState>();

  // --- Stream demand (per-backend) ---
  readonly streamDemand = new Map<BackendId, StreamDemandState>();

  // --- Config ---
  readonly config: Required<GatewayStateConfig>;

  constructor(config: GatewayStateConfig = {}) {
    this.config = {
      registryEventLogMaxSize: config.registryEventLogMaxSize ?? 1000,
      catalogEventLogMaxSize: config.catalogEventLogMaxSize ?? 1000,
      defaultLeaseTtlMs: config.defaultLeaseTtlMs ?? 30_000,
    };

    this.registry = {
      revision: 0,
      items: new Map(),
      eventLog: [],
      eventLogMaxSize: this.config.registryEventLogMaxSize,
    };
  }

  // ==========================================================================
  // Peer Session Management
  // ==========================================================================

  addPeer(peer: PeerSession): void {
    this.peers.set(peer.peerSessionId, peer);
    this.wsToPeer.set(peer.ws, peer);
  }

  removePeer(peerSessionId: PeerSessionId): PeerSession | undefined {
    const peer = this.peers.get(peerSessionId);
    if (!peer) return undefined;

    // Clean up catalog subscriptions
    for (const backendId of peer.catalogSubscriptions) {
      const catalog = this.catalogs.get(backendId);
      if (catalog) {
        catalog.subscribers.delete(peerSessionId);
      }
    }

    // Clean up channels
    for (const channelId of peer.channels) {
      this.removeChannel(channelId);
    }

    this.wsToPeer.delete(peer.ws);
    this.peers.delete(peerSessionId);
    return peer;
  }

  getPeerByWs(ws: WebSocket): PeerSession | undefined {
    return this.wsToPeer.get(ws);
  }

  // ==========================================================================
  // Registry Management
  // ==========================================================================

  /** Register or update a backend in the registry. Returns the new revision. */
  registryUpsert(item: BackendPresence): RegistryRevision {
    this.registry.items.set(item.backendId, item);
    const revision = ++this.registry.revision;

    const event: RegistryEvent = { revision, op: 'upsert', item };
    this.appendRegistryEvent(event);

    return revision;
  }

  /** Remove a backend from the registry. Returns the new revision. */
  registryRemove(backendId: BackendId): RegistryRevision {
    this.registry.items.delete(backendId);
    const revision = ++this.registry.revision;

    const event: RegistryEvent = { revision, op: 'remove', backendId };
    this.appendRegistryEvent(event);

    return revision;
  }

  /** Get registry events after a given revision, or null if not available. */
  getRegistryDelta(sinceRevision: RegistryRevision): RegistryEvent[] | null {
    if (this.registry.eventLog.length === 0) return null;

    const oldestInLog = this.registry.eventLog[0].revision;
    if (sinceRevision < oldestInLog) return null; // Gap too large, need snapshot

    return this.registry.eventLog.filter(e => e.revision > sinceRevision);
  }

  private appendRegistryEvent(event: RegistryEvent): void {
    this.registry.eventLog.push(event);
    while (this.registry.eventLog.length > this.registry.eventLogMaxSize) {
      this.registry.eventLog.shift();
    }
  }

  // ==========================================================================
  // Backend Lease Management
  // ==========================================================================

  addLease(lease: BackendLease): void {
    this.leases.set(lease.backendId, lease);
  }

  removeLease(backendId: BackendId): void {
    const lease = this.leases.get(backendId);
    if (lease?.leaseTimer) {
      clearTimeout(lease.leaseTimer);
    }
    this.leases.delete(backendId);
  }

  /** Remove a backend completely: lease, catalog, stream demand, registry. */
  removeBackend(backendId: BackendId): void {
    this.removeLease(backendId);
    this.catalogs.delete(backendId);
    this.streamDemand.delete(backendId);
    // Registry removal is done separately (caller decides when to broadcast)
  }

  // ==========================================================================
  // Catalog Management
  // ==========================================================================

  /** Initialize or replace catalog state for a backend. */
  setCatalogSnapshot(backendId: BackendId, epoch: Epoch, revision: CatalogRevision, items: SessionCatalogItem[]): void {
    const existing = this.catalogs.get(backendId);
    const subscribers = existing?.subscribers ?? new Set<PeerSessionId>();

    const itemMap = new Map<string, SessionCatalogItem>();
    for (const item of items) {
      itemMap.set(item.sessionId, item);
    }

    this.catalogs.set(backendId, {
      backendId,
      epoch,
      revision,
      items: itemMap,
      eventLog: [],
      subscribers,
    });
  }

  /** Reset catalog contents while preserving subscribers across epoch changes. */
  resetCatalog(backendId: BackendId, epoch: Epoch): BackendCatalogState | null {
    const existing = this.catalogs.get(backendId);
    if (!existing) return null;

    existing.epoch = epoch;
    existing.revision = 0;
    existing.items.clear();
    existing.eventLog.length = 0;
    return existing;
  }

  /** Apply a catalog upsert event. Returns the catalog state or null if backend not found. */
  catalogUpsert(backendId: BackendId, epoch: Epoch, revision: CatalogRevision, item: SessionCatalogItem): BackendCatalogState | null {
    const catalog = this.catalogs.get(backendId);
    if (!catalog || catalog.epoch !== epoch) return null;

    catalog.revision = revision;
    catalog.items.set(item.sessionId, item);

    const event: CatalogDeltaEvent = { revision, op: 'upsert', item };
    this.appendCatalogEvent(catalog, event);

    return catalog;
  }

  /** Apply a catalog remove event. Returns the catalog state or null if backend not found. */
  catalogRemove(backendId: BackendId, epoch: Epoch, revision: CatalogRevision, sessionId: string): BackendCatalogState | null {
    const catalog = this.catalogs.get(backendId);
    if (!catalog || catalog.epoch !== epoch) return null;

    catalog.revision = revision;
    catalog.items.delete(sessionId);

    const event: CatalogDeltaEvent = { revision, op: 'remove', sessionId };
    this.appendCatalogEvent(catalog, event);

    return catalog;
  }

  /** Get catalog events after a given revision, or null if not available. */
  getCatalogDelta(backendId: BackendId, sinceRevision: CatalogRevision): CatalogDeltaEvent[] | null {
    const catalog = this.catalogs.get(backendId);
    if (!catalog) return null;
    if (catalog.eventLog.length === 0) return null;

    const oldestInLog = catalog.eventLog[0].revision;
    if (sinceRevision < oldestInLog) return null;

    return catalog.eventLog.filter(e => e.revision > sinceRevision);
  }

  /** Add a subscriber to a backend's catalog. */
  addCatalogSubscriber(backendId: BackendId, peerSessionId: PeerSessionId): void {
    const catalog = this.catalogs.get(backendId);
    if (catalog) {
      catalog.subscribers.add(peerSessionId);
    }
  }

  /** Remove a subscriber from a backend's catalog. */
  removeCatalogSubscriber(backendId: BackendId, peerSessionId: PeerSessionId): void {
    const catalog = this.catalogs.get(backendId);
    if (catalog) {
      catalog.subscribers.delete(peerSessionId);
    }
  }

  private appendCatalogEvent(catalog: BackendCatalogState, event: CatalogDeltaEvent): void {
    catalog.eventLog.push(event);
    while (catalog.eventLog.length > this.config.catalogEventLogMaxSize) {
      catalog.eventLog.shift();
    }
  }

  // ==========================================================================
  // Channel Management
  // ==========================================================================

  addChannel(channel: ChannelState): void {
    this.channels.set(channel.channelId, channel);

    // Track on peer
    const peer = this.peers.get(channel.peerSessionId);
    if (peer) {
      peer.channels.add(channel.channelId);
    }

    // Update stream demand
    this.incrementChannelCount(channel.backendId);
  }

  removeChannel(channelId: ChannelId): ChannelState | undefined {
    const channel = this.channels.get(channelId);
    if (!channel) return undefined;

    // Remove from peer
    const peer = this.peers.get(channel.peerSessionId);
    if (peer) {
      peer.channels.delete(channelId);
    }

    this.channels.delete(channelId);

    // Update stream demand
    this.decrementChannelCount(channel.backendId);

    return channel;
  }

  /** Find existing channel for a peer+backend pair. */
  findChannel(peerSessionId: PeerSessionId, backendId: BackendId): ChannelState | undefined {
    for (const channel of this.channels.values()) {
      if (channel.peerSessionId === peerSessionId && channel.backendId === backendId) {
        return channel;
      }
    }
    return undefined;
  }

  // ==========================================================================
  // Stream Demand Management
  // ==========================================================================

  /** Get current stream demand for a backend. */
  getStreamDemand(backendId: BackendId): boolean {
    return this.streamDemand.get(backendId)?.active ?? false;
  }

  private incrementChannelCount(backendId: BackendId): boolean {
    let demand = this.streamDemand.get(backendId);
    if (!demand) {
      demand = { channelCount: 0, active: false };
      this.streamDemand.set(backendId, demand);
    }

    demand.channelCount++;

    // 0→1 transition: activate
    if (demand.channelCount === 1 && !demand.active) {
      demand.active = true;
      return true; // Caller should send stream_demand { active: true }
    }
    return false;
  }

  private decrementChannelCount(backendId: BackendId): boolean {
    const demand = this.streamDemand.get(backendId);
    if (!demand) return false;

    demand.channelCount = Math.max(0, demand.channelCount - 1);

    // 1→0 transition: deactivate
    if (demand.channelCount === 0 && demand.active) {
      demand.active = false;
      return true; // Caller should send stream_demand { active: false }
    }
    return false;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /** Clear all timers. Call on shutdown. */
  destroy(): void {
    for (const lease of this.leases.values()) {
      if (lease.leaseTimer) {
        clearTimeout(lease.leaseTimer);
      }
    }
    this.leases.clear();
    this.peers.clear();
    this.wsToPeer.clear();
    this.registry.items.clear();
    this.registry.eventLog.length = 0;
    this.catalogs.clear();
    this.channels.clear();
    this.streamDemand.clear();
  }
}
