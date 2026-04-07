/**
 * EmbeddedBackendFacadeProvider
 *
 * Assembles EmbeddedGatewayAdapter + BackendFacadeRuntimeCore + FacadeWsHub
 * to provide the full embedded facade stack.
 *
 * See docs/design/backend-facade.md § "Provider 与 RuntimeCore 的关系"
 */

import {
  BackendFacadeRuntimeCore,
  DEFAULT_GC_INTERVAL,
} from '@my-claudia/shared/facade/index';
import type {
  BackendFacade,
  BackendFacadeEvent,
  BackendFacadeSnapshot,
} from '@my-claudia/shared/facade/index';
import type { ClientMessage } from '@my-claudia/shared/protocol/messages';
import type { GatewayClient } from './gateway-client.js';
import { EmbeddedGatewayAdapter } from './embedded-adapter.js';
import type { LocalBackendHandler } from './embedded-adapter.js';
import { FacadeWsHub } from './ws-hub.js';

export class EmbeddedBackendFacadeProvider implements BackendFacade {
  private readonly adapter: EmbeddedGatewayAdapter;
  private readonly core: BackendFacadeRuntimeCore;
  private readonly hub: FacadeWsHub;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    gatewayClient: GatewayClient,
    localHandler: LocalBackendHandler | null,
    serverPort: number,
  ) {
    this.adapter = new EmbeddedGatewayAdapter(gatewayClient, localHandler, serverPort);
    this.core = new BackendFacadeRuntimeCore({
      adapter: this.adapter,
      mode: 'embedded',
      localBackendMatcher: (presence, identity) =>
        presence.instanceId === identity.instanceId,
      onLocalBackendIdChanged: (backendId) => {
        this.adapter.setLocalBackendId(backendId);
      },
    });
    this.hub = new FacadeWsHub(this.core);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  connect(): void {
    this.core.start();
    this.hub.start();
    this.startGcTimer();
  }

  disconnect(): void {
    this.stopGcTimer();
    this.hub.stop();
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
  // WsHub access (for attaching to express/http server)
  // --------------------------------------------------------------------------

  getWsHub(): FacadeWsHub { return this.hub; }

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
