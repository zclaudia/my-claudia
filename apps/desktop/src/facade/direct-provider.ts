/**
 * DirectBackendFacadeProvider
 *
 * Assembles DirectGatewayAdapter + BackendFacadeRuntimeCore for mobile/Windows
 * pure UI clients that connect directly to the gateway.
 *
 * See docs/design/backend-facade.md § "Provider 与 RuntimeCore 的关系"
 */

import {
  BackendFacadeRuntimeCore,
  DEFAULT_GC_INTERVAL,
} from '@my-claudia/shared';
import type {
  BackendFacade,
  BackendFacadeEvent,
  BackendFacadeSnapshot,
  ClientMessage,
} from '@my-claudia/shared';
import { DirectGatewayAdapter } from './direct-adapter';

export class DirectBackendFacadeProvider implements BackendFacade {
  private readonly adapter: DirectGatewayAdapter;
  private readonly core: BackendFacadeRuntimeCore;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: {
    url: string;
    gatewaySecret: string;
    deviceId: string;
    instanceId: string;
  }) {
    this.adapter = new DirectGatewayAdapter(config);
    this.core = new BackendFacadeRuntimeCore({
      adapter: this.adapter,
      mode: 'direct',
      // direct mode has no local backend
    });
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  connect(): void {
    this.core.start();
    this.adapter.commands.connection.connect();
    this.startGcTimer();
  }

  disconnect(): void {
    this.stopGcTimer();
    this.adapter.commands.connection.disconnect();
    this.core.clearDesiredState();
    this.core.stop();
  }

  // --------------------------------------------------------------------------
  // BackendFacade delegation
  // --------------------------------------------------------------------------

  getSnapshot(): BackendFacadeSnapshot { return this.core.getSnapshot(); }
  subscribe(listener: (snapshot: BackendFacadeSnapshot) => void): () => void { return this.core.subscribe(listener); }
  onEvent(listener: (event: BackendFacadeEvent) => void): () => void { return this.core.onEvent(listener); }

  openBackend(backendId: string): void { this.core.openBackend(backendId); }
  closeBackend(backendId: string): void { this.core.closeBackend(backendId); }
  sendToBackend(backendId: string, message: ClientMessage): void { this.core.sendToBackend(backendId, message); }

  openSessionStream(backendId: string, sessionId: string): void { this.core.openSessionStream(backendId, sessionId); }
  closeSessionStream(backendId: string, sessionId: string): void { this.core.closeSessionStream(backendId, sessionId); }
  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void { this.core.catchUpContent(backendId, sessionId, afterOffset); }

  getHttpBaseUrl(backendId: string): string | null { return this.core.getHttpBaseUrl(backendId); }
  getHttpHeaders(): Record<string, string> { return this.core.getHttpHeaders(); }

  // --------------------------------------------------------------------------
  // GC Timer
  // --------------------------------------------------------------------------

  private startGcTimer(): void {
    this.gcTimer = setInterval(() => {
      this.core.collectGarbage(Date.now());
    }, DEFAULT_GC_INTERVAL);
  }

  private stopGcTimer(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }
}
