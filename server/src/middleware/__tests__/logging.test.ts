import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loggingMiddleware, detailedLoggingMiddleware } from '../logging.js';
import type { MessageContext, MessageHandler } from '../base.js';
import type { Response } from '@my-claudia/shared';

describe('middleware/logging', () => {
  let mockCtx: MessageContext;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockCtx = {
      client: {
        id: 'client-test-1',
        ws: {},
        authenticated: true,
        isLocal: true,
      },
      request: {
        id: 'req-test-123',
        type: 'user.create.request',
        payload: { name: 'Test User' },
        timestamp: Date.now(),
      },
      db: {} as any,
      metadata: new Map(),
    };

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('loggingMiddleware', () => {
    it('logs request type and client ID', async () => {
      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: { id: 1 },
        timestamp: Date.now(),
        metadata: { success: true },
      });

      await loggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('user.create.request')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('client-test-1')
      );
    });

    it('logs response success status', async () => {
      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: { id: 1 },
        timestamp: Date.now(),
        metadata: { success: true },
      });

      await loggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('SUCCESS')
      );
    });

    it('logs response failure status', async () => {
      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: null,
        timestamp: Date.now(),
        metadata: { success: false, error: { code: 'ERROR', message: 'Failed' } },
      });

      await loggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('FAILED')
      );
    });

    it('logs request duration', async () => {
      const handler: MessageHandler = async () => {
        await new Promise(r => setTimeout(r, 10));
        return {
          id: 'resp-1',
          type: 'user.create.response',
          payload: {},
          timestamp: Date.now(),
          metadata: { success: true },
        };
      };

      await loggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\d+ms/)
      );
    });

    it('logs "no response" when handler returns nothing', async () => {
      const handler: MessageHandler = async () => undefined;

      await loggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('no response')
      );
    });

    it('logs errors and re-throws', async () => {
      const error = new Error('Test error');
      const handler: MessageHandler = async () => {
        throw error;
      };

      await expect(loggingMiddleware(mockCtx, handler)).rejects.toThrow('Test error');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error'),
        error
      );
    });

    it('logs error duration', async () => {
      const handler: MessageHandler = async () => {
        await new Promise(r => setTimeout(r, 10));
        throw new Error('Test error');
      };

      await expect(loggingMiddleware(mockCtx, handler)).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\d+ms/),
        expect.any(Error)
      );
    });
  });

  describe('detailedLoggingMiddleware', () => {
    it('logs request payload (truncated)', async () => {
      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: {},
        timestamp: Date.now(),
        metadata: { success: true },
      });

      await detailedLoggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Request Details]',
        expect.objectContaining({
          type: 'user.create.request',
          requestId: 'req-test-123',
          clientId: 'client-test-1',
        })
      );
    });

    it('logs client authentication status', async () => {
      mockCtx.client.authenticated = false;
      mockCtx.client.isLocal = false;

      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: {},
        timestamp: Date.now(),
        metadata: { success: true },
      });

      await detailedLoggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Request Details]',
        expect.objectContaining({
          authenticated: false,
          isLocal: false,
        })
      );
    });

    it('logs response payload size', async () => {
      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: { data: 'x'.repeat(100) },
        timestamp: Date.now(),
        metadata: { success: true },
      });

      await detailedLoggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Response Details]',
        expect.objectContaining({
          payloadSize: expect.any(Number),
        })
      );
    });

    it('logs response success', async () => {
      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: {},
        timestamp: Date.now(),
        metadata: { success: true },
      });

      await detailedLoggingMiddleware(mockCtx, handler);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Response Details]',
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('logs error details when handler throws', async () => {
      const error = new Error('Detailed error');
      error.stack = 'Error: Detailed error\n    at test.js:1:1';

      const handler: MessageHandler = async () => {
        throw error;
      };

      await expect(detailedLoggingMiddleware(mockCtx, handler)).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Error Details]',
        expect.objectContaining({
          error: 'Detailed error',
          stack: expect.any(String),
        })
      );
    });

    it('truncates large payloads in log', async () => {
      mockCtx.request.payload = { data: 'x'.repeat(500) };

      const handler: MessageHandler = async () => ({
        id: 'resp-1',
        type: 'user.create.response',
        payload: {},
        timestamp: Date.now(),
        metadata: { success: true },
      });

      await detailedLoggingMiddleware(mockCtx, handler);

      // The payload should be truncated to 200 chars
      // console.log is called with '[Request Details]' as first arg, object as second
      const logCall = consoleLogSpy.mock.calls.find(
        call => call[1]?.payload !== undefined
      );
      expect(logCall).toBeDefined();
      expect(logCall![1].payload.length).toBeLessThanOrEqual(202); // 200 + quotes
    });
  });
});
