/**
 * AppLifecycleManager
 *
 * Manages mobile/Windows reconnection via three layers:
 * 1. Visibility change detection (background/foreground)
 * 2. Network change detection (online/offline)
 * 3. Client-side health probing (25s interval)
 *
 * Only active when the facade supports forceReconnect (direct gateway mode).
 */

import type { BackendFacade } from '@my-claudia/shared';

const BACKGROUND_THRESHOLD_MS = 5_000;
const HEALTH_PROBE_INTERVAL_MS = 25_000;

export interface AppLifecycleManagerOptions {
  onBackground?: () => void;
  onResume?: () => void;
  onNetworkOffline?: () => void;
}

class AppLifecycleManager {
  private facade: BackendFacade | null = null;
  private options: AppLifecycleManagerOptions = {};
  private backgroundSince: number | null = null;
  private healthProbeTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

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
    this.options.onResume?.();
  };

  private handleOffline = (): void => {
    console.log('[AppLifecycleManager] Network offline');
    this.options.onNetworkOffline?.();
  };

  start(facade: BackendFacade, options?: AppLifecycleManagerOptions): void {
    if (this.started) this.stop();
    this.facade = facade;
    this.options = options ?? {};
    this.started = true;

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    this.startHealthProbe();
  }

  stop(): void {
    this.started = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);

    this.stopHealthProbe();
    this.facade = null;
    this.options = {};
    this.backgroundSince = null;
  }

  private onBackground(): void {
    this.backgroundSince = Date.now();
    this.stopHealthProbe();
    console.log('[AppLifecycleManager] App went to background');
    this.options.onBackground?.();
  }

  private onForeground(): void {
    const wasBackgroundMs = this.backgroundSince
      ? Date.now() - this.backgroundSince
      : 0;
    this.backgroundSince = null;

    console.log(`[AppLifecycleManager] App returned to foreground (background for ${Math.round(wasBackgroundMs / 1000)}s)`);

    if (wasBackgroundMs > BACKGROUND_THRESHOLD_MS) {
      this.facade?.forceReconnect?.();
    }

    // Always sync on foreground return
    this.options.onResume?.();

    // Restart health probe and run one immediately
    this.startHealthProbe();
    this.facade?.probeHealth?.();
  }

  private startHealthProbe(): void {
    this.stopHealthProbe();
    // Only probe if facade supports it (direct gateway mode)
    if (!this.facade?.probeHealth) return;
    this.healthProbeTimer = setInterval(() => {
      this.facade?.probeHealth?.();
    }, HEALTH_PROBE_INTERVAL_MS);
  }

  private stopHealthProbe(): void {
    if (this.healthProbeTimer) {
      clearInterval(this.healthProbeTimer);
      this.healthProbeTimer = null;
    }
  }
}

export const appLifecycleManager = new AppLifecycleManager();
