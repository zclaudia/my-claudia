import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayTransport } from '../GatewayTransport';
import type { ClientMessage, ServerMessage, GatewayToClientMessage } from '@my-claudia/shared';

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
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onBackendsUpdated: vi.fn(),
      onBackendAuthResult: vi.fn(),
      onBackendMessage: vi.fn(),
      onBackendDisconnected: vi.fn(),
      onSubscriptionAck: vi.fn()
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
    });

    it('clears authenticated state on connect', () => {
      transport.connect();
      expect((transport as any).gatewayAuthenticated).toBe(false);
      expect((transport as any).authenticatedBackends.size).toBe(0);
    });
  });

  describe('disconnect', () => {
    it('closes WebSocket and clears state', () => {
      transport.connect();
      transport.disconnect();

      expect((transport as any).ws).toBeNull();
      expect((transport as any).gatewayAuthenticated).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('returns false when WebSocket is null', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('returns false when not gatewayAuthenticated', () => {
      transport.connect();
      expect(transport.isConnected()).toBe(false);
    });

    it('returns true when WebSocket is open and gatewayAuthenticated', async () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).gatewayAuthenticated = true;

      expect(transport.isConnected()).toBe(true);
    });
  });

  describe('isBackendAuthenticated', () => {
    it('returns false when backend not authenticated', () => {
      expect(transport.isBackendAuthenticated('backend-123')).toBe(false);
    });

    it('returns true when backend is authenticated', () => {
      (transport as any).authenticatedBackends.add('backend-123');
      expect(transport.isBackendAuthenticated('backend-123')).toBe(true);
    });
  });

  describe('authenticateBackend', () => {
    it('sends connect_backend message when connected', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).gatewayAuthenticated = true;

      transport.authenticateBackend('backend-123');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('connect_backend');
      expect(sentMessage.backendId).toBe('backend-123');
    });

    it('calls onBackendAuthResult with failure when not connected', () => {
      transport.authenticateBackend('backend-123');

      expect(mockConfig.onBackendAuthResult).toHaveBeenCalledWith(
        'backend-123',
        false,
        'Not connected to gateway'
      );
    });
  });

  describe('sendToBackend', () => {
    it('sends message through gateway when authenticated', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticatedBackends.add('backend-123');

      const message: ClientMessage = {
        type: 'run',
        sessionId: 'session-456',
        input: 'Test'
      };

      transport.sendToBackend('backend-123', message);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('send_to_backend');
      expect(sentMessage.backendId).toBe('backend-123');
      expect(sentMessage.message).toEqual(message);
    });

    it('logs error when not connected', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      transport.sendToBackend('backend-123', { type: 'run' } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[GatewayTransport] Cannot send: not connected'
      );
      consoleSpy.mockRestore();
    });

    it('logs error when backend not authenticated', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      transport.sendToBackend('backend-123', { type: 'run' } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[GatewayTransport] Cannot send: not authenticated to backend',
        'backend-123'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('requestBackendsList', () => {
    it('sends list_backends message when connected', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).gatewayAuthenticated = true;

      transport.requestBackendsList();

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('list_backends');
    });

    it('does nothing when not connected', () => {
      transport.requestBackendsList();
      // Should not throw
    });
  });

  describe('updateSubscriptions', () => {
    it('sends update_subscriptions message when connected', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).gatewayAuthenticated = true;

      transport.updateSubscriptions(['backend-1', 'backend-2'], false);

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('update_subscriptions');
      expect(sentMessage.subscribedBackendIds).toEqual(['backend-1', 'backend-2']);
      expect(sentMessage.subscribeAll).toBe(false);
    });
  });

  describe('WebSocket event handlers', () => {
    it('sends gateway_auth on open', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.onopen();

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('gateway_auth');
      expect(sentMessage.gatewaySecret).toBe('test-secret');
    });

    it('calls onDisconnected on close', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.onclose();

      expect(mockConfig.onDisconnected).toHaveBeenCalled();
    });

    it('calls onError on error', async () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      const error = new Event('error');
      mockWs.onerror(error);

      expect(mockConfig.onError).toHaveBeenCalledWith(error);
    });
  });

  describe('handleGatewayMessage', () => {
    beforeEach(async () => {
      transport.connect();
    });

    it('handles gateway_auth_result success', async () => {
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message: GatewayToClientMessage = {
        type: 'gateway_auth_result',
        success: true,
        backends: []
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect((transport as any).gatewayAuthenticated).toBe(true);
      expect(mockConfig.onConnected).toHaveBeenCalled();
    });

    it('handles gateway_auth_result failure', async () => {
      const mockWs = (transport as any).ws;

      const message: GatewayToClientMessage = {
        type: 'gateway_auth_result',
        success: false,
        error: 'Invalid secret'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onError).toHaveBeenCalledWith('Invalid secret');
    });

    it('handles backends_list', async () => {
      const mockWs = (transport as any).ws;
      (transport as any).gatewayAuthenticated = true;

      const message: GatewayToClientMessage = {
        type: 'backends_list',
        backends: [
          { id: 'backend-1', name: 'Backend 1', address: 'http://localhost:3000' }
        ]
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onBackendsUpdated).toHaveBeenCalledWith(message.backends);
    });

    it('handles backend_auth_result success', async () => {
      const mockWs = (transport as any).ws;

      const message: GatewayToClientMessage = {
        type: 'backend_auth_result',
        backendId: 'backend-123',
        success: true
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect((transport as any).authenticatedBackends.has('backend-123')).toBe(true);
      expect(mockConfig.onBackendAuthResult).toHaveBeenCalledWith(
        'backend-123',
        true,
        undefined,
        undefined
      );
    });

    it('handles backend_auth_result failure', async () => {
      const mockWs = (transport as any).ws;

      const message: GatewayToClientMessage = {
        type: 'backend_auth_result',
        backendId: 'backend-123',
        success: false,
        error: 'Backend not found'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onBackendAuthResult).toHaveBeenCalledWith(
        'backend-123',
        false,
        'Backend not found',
        undefined
      );
    });

    it('handles backend_message', async () => {
      const mockWs = (transport as any).ws;

      const innerMessage: ServerMessage = {
        type: 'assistant',
        content: 'Hello'
      };

      const message: GatewayToClientMessage = {
        type: 'backend_message',
        backendId: 'backend-123',
        message: innerMessage
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onBackendMessage).toHaveBeenCalledWith('backend-123', innerMessage);
    });

    it('handles backend_disconnected', async () => {
      const mockWs = (transport as any).ws;
      (transport as any).authenticatedBackends.add('backend-123');

      const message: GatewayToClientMessage = {
        type: 'backend_disconnected',
        backendId: 'backend-123'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect((transport as any).authenticatedBackends.has('backend-123')).toBe(false);
      expect(mockConfig.onBackendDisconnected).toHaveBeenCalledWith('backend-123');
    });

    it('handles subscription_ack', async () => {
      const mockWs = (transport as any).ws;

      const message: GatewayToClientMessage = {
        type: 'subscription_ack',
        subscribedBackendIds: ['backend-1', 'backend-2']
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onSubscriptionAck).toHaveBeenCalledWith(['backend-1', 'backend-2']);
    });

    it('handles gateway_error', async () => {
      const mockWs = (transport as any).ws;

      const message: GatewayToClientMessage = {
        type: 'gateway_error',
        message: 'Something went wrong'
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onError).toHaveBeenCalledWith('Something went wrong');
    });
  });
});
