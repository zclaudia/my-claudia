import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AGENT_TOOLS, executeToolCall } from '../agentTools';
import type { ToolCall } from '../clientAI';

// Mock stores
vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: vi.fn(),
  },
}));

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: vi.fn(),
  },
}));

import { useGatewayStore } from '../../stores/gatewayStore';
import { useServerStore } from '../../stores/serverStore';

const mockGatewayState = useGatewayStore.getState as ReturnType<typeof vi.fn>;
const mockServerState = useServerStore.getState as ReturnType<typeof vi.fn>;

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AGENT_TOOLS', () => {
  it('has list_backends tool', () => {
    const tool = AGENT_TOOLS.find(t => t.function.name === 'list_backends');
    expect(tool).toBeDefined();
    expect(tool!.type).toBe('function');
    expect(tool!.function.description).toBeTruthy();
  });

  it('has call_api tool with required parameters', () => {
    const tool = AGENT_TOOLS.find(t => t.function.name === 'call_api');
    expect(tool).toBeDefined();
    expect(tool!.function.parameters.required).toContain('backendId');
    expect(tool!.function.parameters.required).toContain('method');
    expect(tool!.function.parameters.required).toContain('path');
  });
});

describe('executeToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_backends', () => {
    it('lists local servers and gateway backends', async () => {
      mockServerState.mockReturnValue({
        servers: [
          { id: 'local-1', name: 'My Local', address: 'http://localhost:3100' },
        ],
      });
      mockGatewayState.mockReturnValue({
        discoveredBackends: [
          { backendId: 'remote-1', name: 'Remote Box', online: true, isLocal: false },
        ],
      });

      const toolCall: ToolCall = {
        id: 'call-1',
        type: 'function',
        function: { name: 'list_backends', arguments: '{}' },
      };

      const result = await executeToolCall(toolCall);
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(2);
      expect(parsed.backends[0]).toMatchObject({ id: 'local', isLocal: true, online: true });
      expect(parsed.backends[1]).toMatchObject({ id: 'remote-1', isLocal: false, online: true });
    });

    it('skips gateway-prefixed servers from local list', async () => {
      mockServerState.mockReturnValue({
        servers: [
          { id: 'gw:abc', name: 'Gateway Proxy', address: 'http://remote:3100' },
        ],
      });
      mockGatewayState.mockReturnValue({
        discoveredBackends: [],
      });

      const result = await executeToolCall({
        id: 'call-1',
        type: 'function',
        function: { name: 'list_backends', arguments: '{}' },
      });
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(0);
    });

    it('skips local backends from gateway list', async () => {
      mockServerState.mockReturnValue({ servers: [] });
      mockGatewayState.mockReturnValue({
        discoveredBackends: [
          { backendId: 'local-gw', name: 'Local via GW', online: true, isLocal: true },
        ],
      });

      const result = await executeToolCall({
        id: 'call-1',
        type: 'function',
        function: { name: 'list_backends', arguments: '{}' },
      });
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(0);
    });
  });

  describe('call_api', () => {
    it('calls local backend API with correct URL', async () => {
      mockServerState.mockReturnValue({
        servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
      });
      mockGatewayState.mockReturnValue({
        gatewayUrl: null,
        gatewaySecret: null,
      });

      mockFetch.mockResolvedValueOnce({
        text: async () => JSON.stringify({ success: true, data: [] }),
      });

      const result = await executeToolCall({
        id: 'call-2',
        type: 'function',
        function: {
          name: 'call_api',
          arguments: JSON.stringify({ backendId: 'local', method: 'GET', path: '/api/projects' }),
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/projects',
        expect.objectContaining({ method: 'GET' }),
      );
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it('calls gateway-proxied backend with auth header', async () => {
      mockServerState.mockReturnValue({ servers: [] });
      mockGatewayState.mockReturnValue({
        gatewayUrl: 'wss://gw.example.com',
        gatewaySecret: 'my-secret',
      });

      mockFetch.mockResolvedValueOnce({
        text: async () => JSON.stringify({ success: true }),
      });

      await executeToolCall({
        id: 'call-3',
        type: 'function',
        function: {
          name: 'call_api',
          arguments: JSON.stringify({ backendId: 'remote-1', method: 'GET', path: '/api/sessions' }),
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gw.example.com/api/proxy/remote-1/api/sessions',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer my-secret',
          }),
        }),
      );
    });

    it('sends request body for POST requests', async () => {
      mockServerState.mockReturnValue({
        servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
      });
      mockGatewayState.mockReturnValue({ gatewayUrl: null, gatewaySecret: null });

      mockFetch.mockResolvedValueOnce({
        text: async () => JSON.stringify({ success: true }),
      });

      await executeToolCall({
        id: 'call-4',
        type: 'function',
        function: {
          name: 'call_api',
          arguments: JSON.stringify({
            backendId: 'local',
            method: 'POST',
            path: '/api/projects',
            body: { name: 'New Project' },
          }),
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/projects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Project' }),
        }),
      );
    });

    it('returns error when backend not found', async () => {
      mockServerState.mockReturnValue({ servers: [] });
      mockGatewayState.mockReturnValue({ gatewayUrl: null, gatewaySecret: null });

      const result = await executeToolCall({
        id: 'call-5',
        type: 'function',
        function: {
          name: 'call_api',
          arguments: JSON.stringify({ backendId: 'local', method: 'GET', path: '/api/projects' }),
        },
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Backend not found');
    });

    it('returns error on network failure', async () => {
      mockServerState.mockReturnValue({
        servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
      });
      mockGatewayState.mockReturnValue({ gatewayUrl: null, gatewaySecret: null });

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await executeToolCall({
        id: 'call-6',
        type: 'function',
        function: {
          name: 'call_api',
          arguments: JSON.stringify({ backendId: 'local', method: 'GET', path: '/api/projects' }),
        },
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Connection refused');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeToolCall({
        id: 'call-x',
        type: 'function',
        function: { name: 'unknown_tool', arguments: '{}' },
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Unknown tool');
    });
  });

  describe('malformed arguments', () => {
    it('returns error on invalid JSON arguments', async () => {
      const result = await executeToolCall({
        id: 'call-bad',
        type: 'function',
        function: { name: 'call_api', arguments: 'not valid json' },
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Tool execution failed');
    });
  });
});
