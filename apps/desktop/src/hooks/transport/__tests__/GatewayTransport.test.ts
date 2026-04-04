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
      onBackendDataSnapshot: vi.fn(),
      onBackendDataEvent: vi.fn(),
      onBackendSubscribed: vi.fn(),
      onBackendUnsubscribed: vi.fn(),
      onBackendServerMessage: vi.fn(),
      onRunStreamEvent: vi.fn(),
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
      expect(transport.subscribedBackends.size).toBe(0);
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

  describe('isBackendSubscribed', () => {
    it('returns false when backend is not subscribed', () => {
      expect(transport.isBackendSubscribed('backend-123')).toBe(false);
    });

    it('returns true when backend is subscribed', () => {
      transport.subscribedBackends.add('backend-123');
      expect(transport.isBackendSubscribed('backend-123')).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('sends subscribe_backend message when connected', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      transport.subscribe('backend-123');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('subscribe_backend');
      expect(sentMessage.backendId).toBe('backend-123');
    });

    it('does not send if already subscribed to backend', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;
      transport.subscribedBackends.add('backend-123');

      transport.subscribe('backend-123');

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('sends unsubscribe_backend message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.unsubscribe('backend-123');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('unsubscribe_backend');
      expect(sentMessage.backendId).toBe('backend-123');
    });
  });

  describe('sendToBackend', () => {
    it('sends message when subscribed to backend', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      transport.subscribedBackends.add('backend-123');

      const message: ClientMessage = {
        type: 'run_start',
        clientRequestId: 'test-request-id',
        sessionId: 'session-456',
        input: 'Test'
      };

      transport.sendToBackend('backend-123', message);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('backend_client_message');
      expect(sentMessage.backendId).toBe('backend-123');
      expect(sentMessage.message).toEqual(message);
    });

    it('logs error when not subscribed to backend', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      transport.sendToBackend('backend-123', { type: 'run_start', clientRequestId: 'test', sessionId: 'test', input: '' } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[GatewayTransport] Cannot send: not subscribed to backend',
        'backend-123'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('requestBackendDataSnapshot', () => {
    it('sends request_backend_data_snapshot message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.requestBackendDataSnapshot('backend-1');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('request_backend_data_snapshot');
      expect(sentMessage.backendId).toBe('backend-1');
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
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.getRegistryItems().size).toBe(1);
      expect(mockConfig.onRegistryChanged).toHaveBeenCalled();
    });

    it('handles registry_snapshot replacing previous items', () => {
      const mockWs = (transport as any).ws;

      // First snapshot
      mockWs.onmessage({ data: JSON.stringify({
        type: 'registry_snapshot',
        items: [
          { backendId: 'backend-1', name: 'Backend 1', epoch: 1 },
          { backendId: 'backend-2', name: 'Backend 2', epoch: 1 },
        ],
      }) } as MessageEvent);

      expect(transport.getRegistryItems().size).toBe(2);

      // Second snapshot removes backend-1
      mockWs.onmessage({ data: JSON.stringify({
        type: 'registry_snapshot',
        items: [
          { backendId: 'backend-2', name: 'Backend 2', epoch: 1 },
        ],
      }) } as MessageEvent);

      expect(transport.getRegistryItems().size).toBe(1);
      expect(transport.getRegistryItems().has('backend-1')).toBe(false);
      expect(transport.getRegistryItems().has('backend-2')).toBe(true);
    });

    it('handles backend_data_snapshot', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'backend_data_snapshot',
        backendId: 'backend-1',
        sessions: [{ sessionId: 'session-1', title: 'Session 1', createdAt: 1, updatedAt: 1, runStatus: 'idle' }],
        projects: [{ projectId: 'project-1', name: 'Project 1', createdAt: 1, updatedAt: 1 }],
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onBackendDataSnapshot).toHaveBeenCalledWith('backend-1', message.sessions, message.projects);
    });

    it('handles backend_subscribed', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'backend_subscribed',
        backendId: 'backend-123',
        epoch: 1,
        capabilities: ['run']
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.subscribedBackends.has('backend-123')).toBe(true);
      expect(transport.isBackendSubscribed('backend-123')).toBe(true);
      expect(mockConfig.onBackendSubscribed).toHaveBeenCalledWith('backend-123', 1, ['run']);
    });

    it('handles backend_unsubscribed', () => {
      const mockWs = (transport as any).ws;
      // Set up an existing subscription
      transport.subscribedBackends.add('backend-123');

      const message = {
        type: 'backend_unsubscribed',
        backendId: 'backend-123',
        reason: 'Backend disconnected'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.subscribedBackends.has('backend-123')).toBe(false);
      expect(transport.isBackendSubscribed('backend-123')).toBe(false);
      expect(mockConfig.onBackendUnsubscribed).toHaveBeenCalledWith('backend-123', 'Backend disconnected');
    });

    it('handles backend_server_message', () => {
      const mockWs = (transport as any).ws;
      // Set up an existing subscription
      transport.subscribedBackends.add('backend-123');

      const innerMessage: ServerMessage = {
        type: 'delta',
        runId: 'test-run-id',
        sessionId: 'test-session',
        content: 'Hello'
      };

      const message = {
        type: 'backend_server_message',
        backendId: 'backend-123',
        message: innerMessage
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onBackendServerMessage).toHaveBeenCalledWith('backend-123', innerMessage);
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
      (transport as any).subscribedBackends.add('backend-1');

      const message = {
        type: 'run_stream_event',
        backendId: 'backend-1',
        sessionId: 'session-1',
        event: 'delta',
        data: 'test'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onRunStreamEvent).toHaveBeenCalledWith('backend-1', 'session-1', message);
    });

    it('handles session_content_patch', () => {
      const mockWs = (transport as any).ws;
      (transport as any).subscribedBackends.add('backend-1');

      const message = {
        type: 'session_content_patch',
        backendId: 'backend-1',
        sessionId: 'session-1',
        messages: [{ role: 'assistant', content: 'Hello' }],
        latestOffset: 5
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onContentPatch).toHaveBeenCalledWith('backend-1', 'session-1', message.messages, 5);
    });

    it('handles session_content_patch_error', () => {
      const mockWs = (transport as any).ws;
      (transport as any).subscribedBackends.add('backend-1');

      const message = {
        type: 'session_content_patch_error',
        backendId: 'backend-1',
        sessionId: 'session-1',
        afterOffset: 3,
        message: 'Session not found'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onContentPatchError).toHaveBeenCalledWith('backend-1', 'session-1', 3, 'Session not found');
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

  describe('content operations', () => {
    it('sends catch_up_session_content message', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.catchUpContent('backend-1', 'session-1', 10);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('catch_up_session_content');
      expect(sentMessage.backendId).toBe('backend-1');
      expect(sentMessage.sessionId).toBe('session-1');
      expect(sentMessage.afterOffset).toBe(10);
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
