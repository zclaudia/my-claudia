/**
 * StandaloneBackendFacadeProvider
 *
 * Facade provider for standalone mode (no gateway connected).
 * Provides the /ws/backend-facade endpoint with an empty backend list
 * and connected state. When gateway connects later, this provider
 * is replaced by EmbeddedBackendFacadeProvider.
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
import { StandaloneFacadeAdapter } from './standalone-adapter.js';
import type { LocalBackendHandler } from './embedded-adapter.js';
import { FacadeWsHub } from './ws-hub.js';

export class StandaloneBackendFacadeProvider implements BackendFacade {
  private readonly adapter: StandaloneFacadeAdapter;
  private readonly core: BackendFacadeRuntimeCore;
  private readonly hub: FacadeWsHub;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    serverPort: number;
    instanceId: string;
    deviceId: string;
    localHandler: LocalBackendHandler | null;
  }) {
    this.adapter = new StandaloneFacadeAdapter(options);
    this.core = new BackendFacadeRuntimeCore({
      adapter: this.adapter,
      mode: 'embedded',
      localBackendMatcher: (presence, identity) =>
        presence.instanceId === identity.instanceId,
    });
    this.hub = new FacadeWsHub(this.core);
  }

  connect(): void {
    this.core.start();
    this.hub.start();
    this.gcTimer = setInterval(() => this.core.collectGarbage(Date.now()), DEFAULT_GC_INTERVAL);
  }

  disconnect(): void {
    if (this.gcTimer) { clearInterval(this.gcTimer); this.gcTimer = null; }
    this.hub.stop();
    this.core.stop();
  }

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

  getWsHub(): FacadeWsHub { return this.hub; }
}
