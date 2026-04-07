/**
 * AppLifecycleManager
 *
 * Manages mobile/Windows reconnection via three layers:
 * 1. Visibility change detection (background/foreground)
 * 2. Network change detection (online/offline)
 * 3. Client-side health probing (25s interval)
 * 4. Heartbeat staleness detection — marks connections degraded when
 *    state_heartbeat messages stop arriving and triggers proactive recovery.
 *
 * Only active when the facade supports forceReconnect (direct gateway mode).
 * The facade handles all auto-recovery — this manager just ensures the WS
 * connection stays alive by calling facade.forceReconnect() on resume/online.
 */

import type { BackendFacade } from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';

const HEALTH_PROBE_INTERVAL_MS = 25_000;
/** Mark connection degraded if no heartbeat for 75s (2.5 × 30s heartbeat interval). */
const HEARTBEAT_STALE_THRESHOLD_MS = 75_000;

class AppLifecycleManager {
  private facade: BackendFacade | null = null;
  private backgroundSince: number | null = null;
  private healthProbeTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  /** Timestamp of the last health probe tick — used to detect OS freeze. */
  private lastHealthProbeTickAt = 0;

  // Bound handlers for cleanup
  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.onForeground();
    } else {
      this.onBackground();
    }
  };

  private handleOnline = (): void => {
    if (document.visibilityState !== 'visible') return;
    console.log('[AppLifecycleManager] Network online — triggering reconnect');
    this.facade?.forceReconnect?.();
  };

  start(facade: BackendFacade): void {
    if (this.started) this.stop();
    this.facade = facade;
    this.started = true;

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('online', this.handleOnline);

    this.startHealthProbe();
  }

  stop(): void {
    this.started = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('online', this.handleOnline);

    this.stopHealthProbe();
    this.facade = null;
    this.backgroundSince = null;
  }

  private onBackground(): void {
    this.backgroundSince = Date.now();
    this.stopHealthProbe();
    console.log('[AppLifecycleManager] App went to background');
  }

  private onForeground(): void {
    const wasBackgroundMs = this.backgroundSince
      ? Date.now() - this.backgroundSince
      : 0;
    this.backgroundSince = null;

    console.log(`[AppLifecycleManager] App returned to foreground (background for ${Math.round(wasBackgroundMs / 1000)}s)`);

    this.facade?.forceReconnect?.();

    // Restart health probe and run one immediately
    this.startHealthProbe();
    this.facade?.probeHealth?.();
  }

  private startHealthProbe(): void {
    this.stopHealthProbe();
    // Only probe if facade supports it (direct gateway mode)
    if (!this.facade?.probeHealth) return;
    this.lastHealthProbeTickAt = Date.now();
    this.healthProbeTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastHealthProbeTickAt;
      this.lastHealthProbeTickAt = now;

      // Freeze detection: if elapsed time is much larger than the probe interval,
      // the app was likely frozen by the OS (background on mobile). Treat as
      // foreground resume — this doesn't depend on visibilitychange which may
      // not fire reliably on all Android WebView implementations.
      if (elapsed > HEALTH_PROBE_INTERVAL_MS * 2) {
        console.log(`[AppLifecycleManager] Freeze detected: ${Math.round(elapsed / 1000)}s since last tick (expected ${HEALTH_PROBE_INTERVAL_MS / 1000}s)`);
        // Don't go through onForeground() — backgroundSince may be null if
        // visibilitychange never fired. Force reconnect unconditionally.
        this.facade?.forceReconnect?.();
        this.facade?.probeHealth?.();
        return;
      }

      this.facade?.probeHealth?.();
      this.checkHeartbeatStaleness(now);
    }, HEALTH_PROBE_INTERVAL_MS);
  }

  private stopHealthProbe(): void {
    if (this.healthProbeTimer) {
      clearInterval(this.healthProbeTimer);
      this.healthProbeTimer = null;
    }
  }

  /**
   * Check all remote connections for stale heartbeats.
   * If a connection hasn't received a state_heartbeat within the threshold,
   * mark it degraded and trigger proactive recovery (session sync via REST).
   */
  private checkHeartbeatStaleness(now: number): void {
    const store = useServerStore.getState();
    const { connections } = store;

    for (const [serverId, conn] of Object.entries(connections)) {
      // Skip local connections — they use IPC, not remote heartbeat
      if (conn.isLocalConnection) continue;
      // Skip connections that haven't received any heartbeat yet (not fully initialized)
      if (!conn.lastHeartbeatAt) continue;

      const staleDuration = now - conn.lastHeartbeatAt;
      if (staleDuration > HEARTBEAT_STALE_THRESHOLD_MS && conn.connectionQuality !== 'degraded') {
        console.warn(
          `[AppLifecycleManager] Heartbeat stale for ${serverId}: ${Math.round(staleDuration / 1000)}s since last heartbeat — marking degraded`,
        );
        store.setConnectionQuality(serverId, 'degraded');

        // Proactive recovery: sync session state via REST to catch any missed
        // permission requests or run completions
        this.triggerStateRecovery(serverId);
      }
    }
  }

  /**
   * Trigger proactive state recovery for a degraded connection.
   * Uses REST API (independent of WebSocket heartbeat) to fetch current state.
   */
  private triggerStateRecovery(serverId: string): void {
    import('./sessionSync').then(({ eagerSyncCurrentSession, recoverCurrentSessionTail }) => {
      console.log(`[AppLifecycleManager] Triggering state recovery for ${serverId}`);
      void eagerSyncCurrentSession(serverId);
      void recoverCurrentSessionTail(serverId);
    }).catch((err) => {
      console.error('[AppLifecycleManager] Failed to trigger state recovery:', err);
    });
  }
}

export const appLifecycleManager = new AppLifecycleManager();
