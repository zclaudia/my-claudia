import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectTransport } from '../DirectTransport';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared';

describe('DirectTransport', () => {
  let mockConfig: any;
  let transport: DirectTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      url: 'ws://localhost:3100',
      onMessage: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn()
    };

    transport = new DirectTransport(mockConfig);
  });

  afterEach(() => {
    transport.disconnect();
  });

  describe('connect', () => {
    it('creates new WebSocket with config URL', () => {
      transport.connect();

      expect(transport.getStatus()).toBe('connecting');
    });

    it('closes existing WebSocket before creating new one', () => {
      transport.connect();
      const firstWs = (transport as any).ws;

      transport.connect();
      const secondWs = (transport as any).ws;

      expect(firstWs.close).toHaveBeenCalled();
      expect(secondWs).not.toBe(firstWs);
    });
  });

  describe('disconnect', () => {
    it('closes WebSocket and sets status to disconnected', () => {
      transport.connect();
      transport.disconnect();

      expect(transport.getStatus()).toBe('disconnected');
    });
  });

  describe('send', () => {
    it('sends message through WebSocket when connected', async () => {
      transport.connect();

      // Simulate WebSocket opening
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message: ClientMessage = {
        type: 'run_start',
        clientRequestId: 'test-request-id',
        sessionId: 'session-123',
        input: 'Test message'
      };

      transport.send(message);

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('does not send when WebSocket is closed', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const message: ClientMessage = {
        type: 'run_start',
        clientRequestId: 'test-request-id',
        sessionId: 'session-123',
        input: 'Test message'
      };

      transport.send(message);

      expect(consoleSpy).toHaveBeenCalledWith('[Transport] Cannot send message: not connected');
      consoleSpy.mockRestore();
    });
  });

  describe('isConnected', () => {
    it('returns true when WebSocket is open', async () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      expect(transport.isConnected()).toBe(true);
    });

    it('returns false when WebSocket is closed', () => {
      transport.connect();
      // Mock WebSocket is created with readyState = OPEN by default
      // We need to explicitly set it to CONNECTING
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.CONNECTING;
      expect(transport.isConnected()).toBe(false);
    });

    it('returns false after disconnect', () => {
      transport.connect();
      transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('event handling', () => {
    it('handles onopen event', async () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.onopen();

      expect(mockConfig.onOpen).toHaveBeenCalled();
      expect(transport.getStatus()).toBe('connected');
    });

    it('handles onclose event', async () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.onclose();

      expect(mockConfig.onClose).toHaveBeenCalled();
      expect(transport.getStatus()).toBe('disconnected');
    });

    it('handles onerror event', async () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      const error = new Event('error');
      mockWs.onerror(error);

      expect(mockConfig.onError).toHaveBeenCalledWith(error);
      expect(transport.getStatus()).toBe('error');
    });

    it('handles onmessage event with valid JSON', async () => {
      transport.connect();

      const serverMessage: ServerMessage = {
        type: 'delta',
        runId: 'test-run-id',
        sessionId: 'test-session',
        content: 'Response'
      };

      const mockWs = (transport as any).ws;
      mockWs.onmessage({ data: JSON.stringify(serverMessage) } as MessageEvent);

      expect(mockConfig.onMessage).toHaveBeenCalledWith(serverMessage);
    });

    it('handles onmessage event with invalid JSON', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.onmessage({ data: 'not json' } as MessageEvent);

      expect(consoleSpy).toHaveBeenCalled();
      expect(mockConfig.onMessage).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
