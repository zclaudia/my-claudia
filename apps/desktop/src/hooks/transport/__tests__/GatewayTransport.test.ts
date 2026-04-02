import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayTransport } from '../GatewayTransport';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared';

// Mock stores
vi.mock('../../../stores/sessionsStore', () => ({
  useSessionsStore: {
    getState: vi.fn(() => ({
      setRemoteSessions: vi.fn(),
      handleSessionEvent: vi.fn(),
      clearBackendSessions: vi.fn(),
      clearAllSessions: vi.fn()
    }))
  }
}));

// Mock sessionSync service
vi.mock('../../../services/sessionSync', () => ({
  startSessionSync: vi.fn(),
  stopSessionSync: vi.fn()
}));

describe('GatewayTransport', () => {
  let mockConfig: any;
  let transport: GatewayTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      url: 'ws://gateway.example.com',
      gatewaySecret: 'test-secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onRegistryChanged: vi.fn(),
      onCatalogSnapshot: vi.fn(),
      onCatalogEvent: vi.fn(),
      onCatalogReset: vi.fn(),
      onChannelOpened: vi.fn(),
      onChannelRejected: vi.fn(),
      onChannelClosed: vi.fn(),
      onChannelMessage: vi.fn(),
      onRunStreamEvent: vi.fn(),
      onSessionStreamClosed: vi.fn(),
      onContentPatch: vi.fn(),
      onContentPatchError: vi.fn(),
    };

    transport = new GatewayTransport(mockConfig);
  });

  afterEach(() => {
    transport.disconnect();
  });

  describe('constructor', () => {
    it('initializes with config', () => {
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('creates WebSocket connection', () => {
      transport.connect();

      expect((transport as any).ws).not.toBeNull();
    });

    it('closes existing WebSocket before creating new one', () => {
      transport.connect();
      const firstWs = (transport as any).ws;

      transport.connect();
      const secondWs = (transport as any).ws;

      expect(firstWs.close).toHaveBeenCalled();
      expect(secondWs).not.toBe(firstWs);
    });

    it('clears authenticated state on connect', () => {
      transport.connect();
      expect((transport as any).authenticated).toBe(false);
      expect(transport.channels.size).toBe(0);
    });
  });

  describe('disconnect', () => {
    it('closes WebSocket and clears state', () => {
      transport.connect();
      transport.disconnect();

      expect((transport as any).ws).toBeNull();
      expect((transport as any).authenticated).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('returns false when WebSocket is null', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('returns false when not authenticated', () => {
      transport.connect();
      expect(transport.isConnected()).toBe(false);
    });

    it('returns true when WebSocket is open and authenticated', () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      expect(transport.isConnected()).toBe(true);
    });
  });

  describe('isBackendAuthenticated', () => {
    it('returns false when backend has no open channel', () => {
      expect(transport.isBackendAuthenticated('backend-123')).toBe(false);
    });

    it('returns true when backend has an open channel', () => {
      (transport as any).backendToChannel.set('backend-123', 'channel-1');
      expect(transport.isBackendAuthenticated('backend-123')).toBe(true);
    });
  });

  describe('openChannel', () => {
    it('sends open_backend_channel message when connected', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      transport.openChannel('backend-123', 1);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('open_backend_channel');
      expect(sentMessage.backendId).toBe('backend-123');
      expect(sentMessage.expectedEpoch).toBe(1);
    });

    it('does not send if channel already open for backend', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;
      (transport as any).backendToChannel.set('backend-123', 'channel-1');

      transport.openChannel('backend-123', 1);

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('sendToBackend', () => {
    it('sends message through channel when channel is open', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).backendToChannel.set('backend-123', 'channel-1');

      const message: ClientMessage = {
        type: 'run_start',
        clientRequestId: 'test-request-id',
        sessionId: 'session-456',
        input: 'Test'
      };

      transport.sendToBackend('backend-123', message);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('channel_client_message');
      expect(sentMessage.channelId).toBe('channel-1');
      expect(sentMessage.message).toEqual(message);
    });

    it('logs error when channel not open for backend', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      transport.sendToBackend('backend-123', { type: 'run_start', clientRequestId: 'test', sessionId: 'test', input: '' } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[GatewayTransport] Cannot send: channel not open for backend',
        'backend-123'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('subscribeCatalog', () => {
    it('sends subscribe_backend_catalog message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.subscribeCatalog('backend-1', 1, 5);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('subscribe_backend_catalog');
      expect(sentMessage.backendId).toBe('backend-1');
      expect(sentMessage.expectedEpoch).toBe(1);
      expect(sentMessage.lastRevision).toBe(5);
    });
  });

  describe('unsubscribeCatalog', () => {
    it('sends unsubscribe_backend_catalog message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.unsubscribeCatalog('backend-1', 1);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('unsubscribe_backend_catalog');
      expect(sentMessage.backendId).toBe('backend-1');
      expect(sentMessage.expectedEpoch).toBe(1);
    });
  });

  describe('WebSocket event handlers', () => {
    it('sends peer_hello on open', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.onopen();

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('peer_hello');
      expect(sentMessage.gatewaySecret).toBe('test-secret');
      expect(sentMessage.protocolVersion).toBe(2);
      expect(sentMessage.peerType).toBe('client-only');
      expect(sentMessage.identity).toEqual({ deviceId: 'device-1', instanceId: 'instance-1' });
    });

    it('calls onDisconnected on close', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.onclose({ code: 1000, reason: '', wasClean: true });

      expect(mockConfig.onDisconnected).toHaveBeenCalled();
    });

    it('calls onError on error', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      const error = new Event('error');
      mockWs.onerror(error);

      expect(mockConfig.onError).toHaveBeenCalledWith(error);
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      transport.connect();
    });

    it('handles peer_ready', () => {
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message = {
        type: 'peer_ready',
        peerSessionId: 'peer-session-1',
        recoveryToken: 'token-abc',
        registrySync: {
          mode: 'snapshot',
          items: [
            { backendId: 'backend-1', name: 'Backend 1', epoch: 1 }
          ],
          revision: 1
        }
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect((transport as any).authenticated).toBe(true);
      expect(transport.getPeerSessionId()).toBe('peer-session-1');
      expect(transport.getRecoveryToken()).toBe('token-abc');
      expect(mockConfig.onConnected).toHaveBeenCalledWith('peer-session-1', 'token-abc');
      expect(mockConfig.onRegistryChanged).toHaveBeenCalled();
    });

    it('handles registry_snapshot', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'registry_snapshot',
        items: [
          { backendId: 'backend-1', name: 'Backend 1', epoch: 1 }
        ],
        revision: 2
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.getRegistryRevision()).toBe(2);
      expect(transport.getRegistryItems().size).toBe(1);
      expect(mockConfig.onRegistryChanged).toHaveBeenCalled();
    });

    it('handles registry_delta', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'registry_delta',
        events: [
          { op: 'upsert', revision: 2, item: { backendId: 'backend-2', name: 'Backend 2', epoch: 1 } }
        ],
        toRevision: 2
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.getRegistryRevision()).toBe(2);
      expect(transport.getRegistryItems().has('backend-2')).toBe(true);
      expect(mockConfig.onRegistryChanged).toHaveBeenCalled();
    });

    it('handles registry_event with correct revision', () => {
      const mockWs = (transport as any).ws;
      // Set initial revision to 0 (default)

      const message = {
        type: 'registry_event',
        event: {
          op: 'upsert',
          revision: 1,
          item: { backendId: 'backend-1', name: 'Backend 1', epoch: 1 }
        }
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.getRegistryRevision()).toBe(1);
      expect(mockConfig.onRegistryChanged).toHaveBeenCalled();
    });

    it('handles registry_event gap by requesting resync', () => {
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      // Clear any prior send calls (e.g. peer_hello from onopen)
      mockWs.send.mockClear();

      const message = {
        type: 'registry_event',
        event: {
          op: 'upsert',
          revision: 5, // gap: expected 1
          item: { backendId: 'backend-1', name: 'Backend 1', epoch: 1 }
        }
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      // Should send resync_registry
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('resync_registry');
      expect(sentMessage.lastRevision).toBe(0);
    });

    it('handles backend_catalog_snapshot', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'backend_catalog_snapshot',
        backendId: 'backend-1',
        epoch: 1,
        items: [{ sessionId: 'session-1', name: 'Session 1' }],
        revision: 1
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onCatalogSnapshot).toHaveBeenCalledWith('backend-1', 1, message.items);
    });

    it('handles backend_channel_opened', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'backend_channel_opened',
        backendId: 'backend-123',
        channelId: 'channel-1',
        epoch: 1,
        capabilities: ['run']
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.channels.has('channel-1')).toBe(true);
      expect(transport.isBackendAuthenticated('backend-123')).toBe(true);
      expect(mockConfig.onChannelOpened).toHaveBeenCalledWith('backend-123', 'channel-1', 1, ['run']);
    });

    it('handles backend_channel_rejected', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'backend_channel_rejected',
        backendId: 'backend-123',
        reason: 'Epoch mismatch'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onChannelRejected).toHaveBeenCalledWith('backend-123', 'Epoch mismatch');
    });

    it('handles backend_channel_closed', () => {
      const mockWs = (transport as any).ws;
      // Set up an existing channel
      transport.channels.set('channel-1', { backendId: 'backend-123', epoch: 1 });
      (transport as any).backendToChannel.set('backend-123', 'channel-1');

      const message = {
        type: 'backend_channel_closed',
        channelId: 'channel-1',
        backendId: 'backend-123',
        reason: 'Backend disconnected'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.channels.has('channel-1')).toBe(false);
      expect(transport.isBackendAuthenticated('backend-123')).toBe(false);
      expect(mockConfig.onChannelClosed).toHaveBeenCalledWith('channel-1', 'backend-123', 'Backend disconnected');
    });

    it('handles channel_server_message', () => {
      const mockWs = (transport as any).ws;
      // Set up an existing channel
      transport.channels.set('channel-1', { backendId: 'backend-123', epoch: 1 });

      const innerMessage: ServerMessage = {
        type: 'delta',
        runId: 'test-run-id',
        sessionId: 'test-session',
        content: 'Hello'
      };

      const message = {
        type: 'channel_server_message',
        channelId: 'channel-1',
        message: innerMessage
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onChannelMessage).toHaveBeenCalledWith('backend-123', innerMessage);
    });

    it('handles gateway_error', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'gateway_error',
        code: 'GENERIC_ERROR',
        message: 'Something went wrong'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onError).toHaveBeenCalledWith('GENERIC_ERROR: Something went wrong');
    });

    it('handles run_stream_event', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'run_stream_event',
        channelId: 'channel-1',
        sessionId: 'session-1',
        event: 'delta',
        data: 'test'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onRunStreamEvent).toHaveBeenCalledWith('channel-1', 'session-1', message);
    });

    it('handles session_stream_closed', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'session_stream_closed',
        channelId: 'channel-1',
        sessionId: 'session-1',
        reason: 'completed'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onSessionStreamClosed).toHaveBeenCalledWith('channel-1', 'session-1', 'completed');
    });

    it('handles session_content_patch', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'session_content_patch',
        channelId: 'channel-1',
        sessionId: 'session-1',
        messages: [{ role: 'assistant', content: 'Hello' }],
        latestOffset: 5
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onContentPatch).toHaveBeenCalledWith('channel-1', 'session-1', message.messages, 5);
    });

    it('handles session_content_patch_error', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'session_content_patch_error',
        channelId: 'channel-1',
        sessionId: 'session-1',
        afterOffset: 3,
        message: 'Session not found'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onContentPatchError).toHaveBeenCalledWith('channel-1', 'session-1', 3, 'Session not found');
    });
  });

  describe('health probe', () => {
    it('sends ping when connected', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      transport.probeHealth();

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('ping');
      expect(sentMessage.ts).toBeDefined();
    });

    it('does nothing when not connected', () => {
      transport.probeHealth();
      // Should not throw
    });

    it('clears health probe timeout on pong', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      transport.probeHealth();
      expect((transport as any).healthProbeTimeout).not.toBeNull();

      mockWs.onmessage({ data: JSON.stringify({ type: 'pong', ts: Date.now() }) } as MessageEvent);
      expect((transport as any).healthProbeTimeout).toBeNull();
    });
  });

  describe('stream operations', () => {
    it('sends open_session_stream message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.openSessionStream('channel-1', 'session-1');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('open_session_stream');
      expect(sentMessage.channelId).toBe('channel-1');
      expect(sentMessage.sessionId).toBe('session-1');
    });

    it('sends close_session_stream message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.closeSessionStream('channel-1', 'session-1');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('close_session_stream');
      expect(sentMessage.channelId).toBe('channel-1');
      expect(sentMessage.sessionId).toBe('session-1');
    });
  });

  describe('content operations', () => {
    it('sends catch_up_session_content message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.catchUpContent('channel-1', 'session-1', 10);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('catch_up_session_content');
      expect(sentMessage.channelId).toBe('channel-1');
      expect(sentMessage.sessionId).toBe('session-1');
      expect(sentMessage.afterOffset).toBe(10);
    });
  });

  describe('channel operations', () => {
    it('sends close_backend_channel message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.closeChannel('channel-1');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('close_backend_channel');
      expect(sentMessage.channelId).toBe('channel-1');
    });

    it('getChannelId returns channel for backend', () => {
      (transport as any).backendToChannel.set('backend-123', 'channel-1');
      expect(transport.getChannelId('backend-123')).toBe('channel-1');
    });

    it('getChannelId returns undefined when no channel', () => {
      expect(transport.getChannelId('backend-123')).toBeUndefined();
    });
  });

  describe('forceReconnect', () => {
    it('resets reconnect attempt and reconnects', () => {
      transport.connect();
      const firstWs = (transport as any).ws;

      transport.forceReconnect();

      expect(firstWs.close).toHaveBeenCalled();
      expect((transport as any).reconnectAttempt).toBe(0);
    });
  });
});
