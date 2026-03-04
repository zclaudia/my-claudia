import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenCodeAdapter } from '../opencode-adapter.js';
import * as opencodeSdk from '../opencode-sdk.js';
import type { PermissionRequest } from '@my-claudia/shared';

// Mock the opencode-sdk module
vi.mock('../opencode-sdk.js', () => ({
  runOpenCode: vi.fn(),
  abortOpenCodeSession: vi.fn(),
}));

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;
  let mockOnPermission: any;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenCodeAdapter();
    mockOnPermission = vi.fn();
  });

  describe('type', () => {
    it('returns "opencode"', () => {
      expect(adapter.type).toBe('opencode');
    });
  });

  describe('run', () => {
    it('calls runOpenCode with correct parameters', async () => {
      const mockGenerator = (async function* () {
        yield { type: 'system', subtype: 'init', cwd: '/test', session_id: 'test-session' };
      })();
      vi.mocked(opencodeSdk.runOpenCode).mockReturnValue(mockGenerator);

      const input = 'test input';
      const options = {
        cwd: '/test/dir',
        sessionId: 'session-123',
        cliPath: '/path/to/opencode',
        env: { API_KEY: 'test' },
        model: 'claude-sonnet-4',
        mode: 'plan',
        systemPrompt: 'Test prompt'
      };

      const generator = adapter.run(input, options, mockOnPermission);
      const results = [];
      for await (const msg of generator) {
        results.push(msg);
      }

      expect(opencodeSdk.runOpenCode).toHaveBeenCalledWith(
        input,
        {
          cwd: options.cwd,
          sessionId: options.sessionId,
          cliPath: options.cliPath,
          env: options.env,
          model: options.model,
          agent: options.mode,
          systemPrompt: options.systemPrompt,
        },
        mockOnPermission
      );
    });

    it('yields messages from runOpenCode', async () => {
      const messages = [
        { type: 'system', subtype: 'init', cwd: '/test', session_id: 'sess-1' },
        { type: 'assistant', content: 'Hello' },
        { type: 'result', subtype: 'success' },
      ];

      const mockGenerator = (async function* () {
        for (const msg of messages) {
          yield msg;
        }
      })();
      vi.mocked(opencodeSdk.runOpenCode).mockReturnValue(mockGenerator);

      const generator = adapter.run('input', { cwd: '/test' }, mockOnPermission);
      const results = [];
      for await (const msg of generator) {
        results.push(msg);
      }

      expect(results).toEqual(messages);
    });

    it('handles permission callback correctly', async () => {
      const permissionRequest: PermissionRequest = {
        type: 'tool',
        name: 'read_file',
        input: { path: '/test/file.txt' }
      };

      const mockGenerator = (async function* () {
        yield { type: 'permission', request: permissionRequest };
      })();
      vi.mocked(opencodeSdk.runOpenCode).mockReturnValue(mockGenerator);

      const generator = adapter.run('input', { cwd: '/test' }, mockOnPermission);
      for await (const _ of generator) {
        // Just consume the generator
      }

      // Verify the permission callback was passed to runOpenCode
      expect(opencodeSdk.runOpenCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        mockOnPermission
      );
    });
  });

  describe('abort', () => {
    it('calls abortOpenCodeSession with correct parameters', async () => {
      vi.mocked(opencodeSdk.abortOpenCodeSession).mockResolvedValue();

      await adapter.abort('session-123', '/test/dir');

      expect(opencodeSdk.abortOpenCodeSession).toHaveBeenCalledWith('/test/dir', 'session-123');
    });

    it('completes when called', async () => {
      // The actual abortOpenCodeSession handles errors internally and doesn't throw
      vi.mocked(opencodeSdk.abortOpenCodeSession).mockResolvedValue();

      // Should complete without throwing
      await adapter.abort('session-123', '/test/dir');

      expect(opencodeSdk.abortOpenCodeSession).toHaveBeenCalled();
    });
  });

  describe('getRunState', () => {
    it('returns providerCwd in state', () => {
      const options = {
        cwd: '/test/directory',
        sessionId: 'session-123'
      };

      const state = adapter.getRunState(options);

      expect(state).toEqual({
        providerCwd: '/test/directory'
      });
    });

    it('returns different cwd for different runs', () => {
      const options1 = { cwd: '/path/one' };
      const options2 = { cwd: '/path/two' };

      const state1 = adapter.getRunState(options1);
      const state2 = adapter.getRunState(options2);

      expect(state1.providerCwd).toBe('/path/one');
      expect(state2.providerCwd).toBe('/path/two');
    });
  });
});
