import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseTransport } from '../BaseTransport';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared';

// Create a concrete implementation for testing
class TestTransport extends BaseTransport {
  connect(): void {
    this.status = 'connecting';
    this.ws = new WebSocket(this.config.url);
    this.setupWebSocket(this.ws);
  }
}

describe('BaseTransport', () => {
  let mockConfig: any;
  let transport: TestTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      url: 'ws://localhost:3000',
      onMessage: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn()
    };

    transport = new TestTransport(mockConfig);
  });

  afterEach(() => {
    transport.disconnect();
  });

  describe('constructor', () => {
    it('initializes with config', () => {
      expect(transport.getStatus()).toBe('disconnected');
    });
  });

  describe('connect', () => {
    it('creates WebSocket connection', () => {
      transport.connect();

      expect(transport.getStatus()).toBe('connecting');
    });
  });

  describe('disconnect', () => {
    it('closes WebSocket connection', () => {
      transport.connect();
      transport.disconnect();

      expect(transport.getStatus()).toBe('disconnected');
    });
  });

  describe('send', () => {
    it('sends message when connected', async () => {
      transport.connect();

      // Simulate WebSocket opening
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message: ClientMessage = {
        type: 'run',
        sessionId: 'test-session',
        input: 'Hello'
      };

      transport.send(message);

      // WebSocket.send should have been called
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('logs error when not connected', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const message: ClientMessage = {
        type: 'run',
        sessionId: 'test-session',
        input: 'Hello'
      };

      transport.send(message);

      expect(consoleSpy).toHaveBeenCalledWith('[Transport] Cannot send message: not connected');
      consoleSpy.mockRestore();
    });
  });

  describe('isConnected', () => {
    it('returns false when WebSocket is null', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('returns false when WebSocket is not OPEN', () => {
      transport.connect();
      // Mock WebSocket is created with readyState = OPEN by default
      // We need to explicitly set it to CONNECTING
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.CONNECTING;
      expect(transport.isConnected()).toBe(false);
    });

    it('returns true when WebSocket is OPEN', async () => {
      transport.connect();

      // Simulate WebSocket opening
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      expect(transport.isConnected()).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('returns disconnected initially', () => {
      expect(transport.getStatus()).toBe('disconnected');
    });

    it('returns connecting after connect called', () => {
      transport.connect();
      expect(transport.getStatus()).toBe('connecting');
    });
  });

  describe('WebSocket event handlers', () => {
    it('calls onOpen when WebSocket opens', async () => {
      transport.connect();

      // Simulate WebSocket open event
      const mockWs = (transport as any).ws;
      mockWs.onopen();

      expect(transport.getStatus()).toBe('connected');
      expect(mockConfig.onOpen).toHaveBeenCalled();
    });

    it('calls onClose when WebSocket closes', async () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.onclose();

      expect(transport.getStatus()).toBe('disconnected');
      expect(mockConfig.onClose).toHaveBeenCalled();
    });

    it('calls onError when WebSocket errors', async () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      const error = new Event('error');
      mockWs.onerror(error);

      expect(transport.getStatus()).toBe('error');
      expect(mockConfig.onError).toHaveBeenCalledWith(error);
    });

    it('calls onMessage with parsed message', async () => {
      transport.connect();

      const serverMessage: ServerMessage = {
        type: 'assistant',
        content: 'Hello back'
      };

      const mockWs = (transport as any).ws;
      mockWs.onmessage({ data: JSON.stringify(serverMessage) } as MessageEvent);

      expect(mockConfig.onMessage).toHaveBeenCalledWith(serverMessage);
    });

    it('logs error on invalid JSON message', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.onmessage({ data: 'invalid json' } as MessageEvent);

      expect(consoleSpy).toHaveBeenCalledWith('[Transport] Failed to parse message:', expect.any(Error));
      expect(mockConfig.onMessage).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
