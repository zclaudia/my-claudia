import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AGENT_TOOLS, executeToolCall } from '../agentTools';
import type { ToolCall } from '../clientAI';

// Mock stores
vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: vi.fn(),
  },
  isGatewayTarget: (id: string) => id.startsWith('gw:'),
}));

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: vi.fn(),
  },
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(),
  },
}));

// Mock api module
vi.mock('../api', () => ({
  getProjects: vi.fn(),
  getSessions: vi.fn(),
  getSessionMessages: vi.fn(),
  searchMessages: vi.fn(),
  exportSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getProviders: vi.fn(),
  listDirectory: vi.fn(),
  getFileContent: vi.fn(),
  archiveSessions: vi.fn(),
}));

// Mock gatewayProxy
vi.mock('../gatewayProxy', () => ({
  resolveGatewayBackendUrl: vi.fn(),
  getGatewayAuthHeaders: vi.fn(),
}));

import { useGatewayStore } from '../../stores/gatewayStore';
import { useServerStore } from '../../stores/serverStore';
import { useChatStore } from '../../stores/chatStore';
import * as api from '../api';
import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from '../gatewayProxy';

const mockGatewayState = useGatewayStore.getState as ReturnType<typeof vi.fn>;
const mockServerState = useServerStore.getState as ReturnType<typeof vi.fn>;
const mockChatState = useChatStore.getState as ReturnType<typeof vi.fn>;

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

/** Desktop mode gateway state */
function desktopGw(overrides: Record<string, unknown> = {}) {
  return {
    discoveredBackends: [],
    gatewayUrl: null,
    gatewaySecret: null,
    hasDirectConfig: () => false,
    ...overrides,
  };
}

/** Mobile mode gateway state */
function mobileGw(overrides: Record<string, unknown> = {}) {
  return {
    discoveredBackends: [],
    gatewayUrl: 'wss://gw.example.com',
    gatewaySecret: 'gw-secret',
    hasDirectConfig: () => true,
    ...overrides,
  };
}

function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: `call-${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

/** Set up state for active backend (desktop, local server) */
function setupActiveBackend() {
  mockServerState.mockReturnValue({
    servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
    activeServerId: 'local-1',
  });
  mockGatewayState.mockReturnValue(desktopGw());
}

/** Set up state for remote backend access */
function setupRemoteBackend() {
  mockServerState.mockReturnValue({
    servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
    activeServerId: 'local-1',
  });
  mockGatewayState.mockReturnValue(desktopGw({
    gatewayUrl: 'wss://gw.example.com',
    gatewaySecret: 'my-secret',
  }));
  (resolveGatewayBackendUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://gw.example.com/api/proxy/remote-1');
  (getGatewayAuthHeaders as ReturnType<typeof vi.fn>).mockReturnValue({ 'Authorization': 'Bearer my-secret' });
}

// ============================================
// Tool Definitions
// ============================================

describe('AGENT_TOOLS', () => {
  const expectedTools = [
    'list_backends', 'list_projects', 'list_sessions', 'get_session_messages',
    'search_messages', 'summarize_session', 'create_session', 'delete_session',
    'list_providers', 'list_files', 'read_file', 'archive_sessions',
    'send_task_to_session', 'get_session_status',
  ];

  it('defines all 14 tools', () => {
    expect(AGENT_TOOLS).toHaveLength(14);
  });

  it.each(expectedTools)('has %s tool', (toolName) => {
    const tool = AGENT_TOOLS.find(t => t.function.name === toolName);
    expect(tool).toBeDefined();
    expect(tool!.type).toBe('function');
    expect(tool!.function.description).toBeTruthy();
  });
});

// ============================================
// executeToolCall
// ============================================

describe('executeToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- list_backends ----

  describe('list_backends (desktop)', () => {
    it('lists local servers and gateway backends', async () => {
      mockServerState.mockReturnValue({
        servers: [
          { id: 'local-1', name: 'My Local', address: 'http://localhost:3100' },
        ],
      });
      mockGatewayState.mockReturnValue(desktopGw({
        discoveredBackends: [
          { backendId: 'remote-1', name: 'Remote Box', online: true, isLocal: false },
        ],
      }));

      const result = await executeToolCall(makeToolCall('list_backends'));
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
      mockGatewayState.mockReturnValue(desktopGw());

      const result = await executeToolCall(makeToolCall('list_backends'));
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(0);
    });

    it('skips isLocal backends from gateway list (desktop)', async () => {
      mockServerState.mockReturnValue({ servers: [] });
      mockGatewayState.mockReturnValue(desktopGw({
        discoveredBackends: [
          { backendId: 'local-gw', name: 'Local via GW', online: true, isLocal: true },
        ],
      }));

      const result = await executeToolCall(makeToolCall('list_backends'));
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(0);
    });
  });

  describe('list_backends (mobile)', () => {
    it('excludes localhost server on mobile', async () => {
      mockServerState.mockReturnValue({
        servers: [{ id: 'local', name: 'Local Server', address: 'localhost:3100' }],
      });
      mockGatewayState.mockReturnValue(mobileGw({
        discoveredBackends: [
          { backendId: 'coder-server', name: 'Coder Server', online: true, isLocal: false },
        ],
      }));

      const result = await executeToolCall(makeToolCall('list_backends'));
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(1);
      expect(parsed.backends[0]).toMatchObject({ id: 'coder-server', name: 'Coder Server' });
    });

    it('includes isLocal gateway backend on mobile', async () => {
      mockServerState.mockReturnValue({
        servers: [{ id: 'local', name: 'Local Server', address: 'localhost:3100' }],
      });
      mockGatewayState.mockReturnValue(mobileGw({
        discoveredBackends: [
          { backendId: 'my-backend', name: 'My Backend', online: true, isLocal: true },
        ],
      }));

      const result = await executeToolCall(makeToolCall('list_backends'));
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(1);
      expect(parsed.backends[0]).toMatchObject({ id: 'my-backend', name: 'My Backend', online: true });
    });

    it('skips offline gateway backends on mobile', async () => {
      mockServerState.mockReturnValue({ servers: [] });
      mockGatewayState.mockReturnValue(mobileGw({
        discoveredBackends: [
          { backendId: 'offline-1', name: 'Offline', online: false },
        ],
      }));

      const result = await executeToolCall(makeToolCall('list_backends'));
      const parsed = JSON.parse(result);
      expect(parsed.backends).toHaveLength(0);
    });
  });

  // ---- list_projects ----

  describe('list_projects', () => {
    it('calls api.getProjects for active backend', async () => {
      setupActiveBackend();
      const mockProjects = [
        { id: 'p1', name: 'Project A', type: 'git', rootPath: '/home/user/project-a', extra: 'ignored' },
        { id: 'p2', name: 'Project B', type: 'local', rootPath: '/tmp/b' },
      ];
      (api.getProjects as ReturnType<typeof vi.fn>).mockResolvedValue(mockProjects);

      const result = await executeToolCall(makeToolCall('list_projects'));
      const parsed = JSON.parse(result);

      expect(api.getProjects).toHaveBeenCalled();
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ id: 'p1', name: 'Project A', type: 'git', rootPath: '/home/user/project-a' });
      // extra field should be excluded
      expect(parsed[0].extra).toBeUndefined();
    });

    it('uses remoteFetch for non-active backend', async () => {
      setupRemoteBackend();
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ success: true, data: [{ id: 'p1', name: 'Remote Project', type: 'git', rootPath: '/remote' }] }),
      });

      const result = await executeToolCall(makeToolCall('list_projects', { backendId: 'remote-1' }));
      const parsed = JSON.parse(result);

      expect(api.getProjects).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gw.example.com/api/proxy/remote-1/api/projects',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Authorization': 'Bearer my-secret' }),
        }),
      );
      expect(parsed[0]).toMatchObject({ id: 'p1', name: 'Remote Project' });
    });
  });

  // ---- list_sessions ----

  describe('list_sessions', () => {
    it('calls api.getSessions with projectId filter', async () => {
      setupActiveBackend();
      const mockSessions = [
        { id: 's1', name: 'Session 1', projectId: 'p1', updatedAt: '2024-01-01', type: 'chat', extra: 'x' },
      ];
      (api.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue(mockSessions);

      const result = await executeToolCall(makeToolCall('list_sessions', { projectId: 'p1' }));
      const parsed = JSON.parse(result);

      expect(api.getSessions).toHaveBeenCalledWith('p1');
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({ id: 's1', name: 'Session 1', projectId: 'p1', updatedAt: '2024-01-01', type: 'chat' });
    });

    it('calls api.getSessions without filter when no projectId', async () => {
      setupActiveBackend();
      (api.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await executeToolCall(makeToolCall('list_sessions'));

      expect(api.getSessions).toHaveBeenCalledWith(undefined);
    });
  });

  // ---- get_session_messages ----

  describe('get_session_messages', () => {
    it('returns messages with default limit of 20', async () => {
      setupActiveBackend();
      const longContent = 'x'.repeat(600);
      (api.getSessionMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
        messages: [
          { role: 'user', content: longContent, createdAt: '2024-01-01' },
          { role: 'assistant', content: 'short', createdAt: '2024-01-02' },
        ],
      });

      const result = await executeToolCall(makeToolCall('get_session_messages', { sessionId: 's1' }));
      const parsed = JSON.parse(result);

      expect(api.getSessionMessages).toHaveBeenCalledWith('s1', { limit: 20 });
      expect(parsed).toHaveLength(2);
      // Content should be truncated to 500 chars
      expect(parsed[0].content).toHaveLength(500);
      expect(parsed[1].content).toBe('short');
    });

    it('respects custom limit', async () => {
      setupActiveBackend();
      (api.getSessionMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: [] });

      await executeToolCall(makeToolCall('get_session_messages', { sessionId: 's1', limit: 5 }));

      expect(api.getSessionMessages).toHaveBeenCalledWith('s1', { limit: 5 });
    });
  });

  // ---- search_messages ----

  describe('search_messages', () => {
    it('searches with query and projectId', async () => {
      setupActiveBackend();
      const results = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, content: `result ${i}` }));
      (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(results);

      const result = await executeToolCall(makeToolCall('search_messages', { query: 'auth bug', projectId: 'p1' }));
      const parsed = JSON.parse(result);

      expect(api.searchMessages).toHaveBeenCalledWith('auth bug', { projectId: 'p1' });
      // Results should be capped at 20
      expect(parsed).toHaveLength(20);
    });
  });

  // ---- summarize_session ----

  describe('summarize_session', () => {
    it('exports and truncates to 8000 chars', async () => {
      setupActiveBackend();
      const longMarkdown = 'M'.repeat(10000);
      (api.exportSession as ReturnType<typeof vi.fn>).mockResolvedValue({ markdown: longMarkdown });

      const result = await executeToolCall(makeToolCall('summarize_session', { sessionId: 's1' }));

      expect(api.exportSession).toHaveBeenCalledWith('s1');
      expect(result).toHaveLength(8000);
    });

    it('returns short markdown as-is', async () => {
      setupActiveBackend();
      (api.exportSession as ReturnType<typeof vi.fn>).mockResolvedValue({ markdown: '# Summary\nShort session.' });

      const result = await executeToolCall(makeToolCall('summarize_session', { sessionId: 's1' }));

      expect(result).toBe('# Summary\nShort session.');
    });
  });

  // ---- create_session ----

  describe('create_session', () => {
    it('creates session and returns summary', async () => {
      setupActiveBackend();
      (api.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'new-s1', name: 'New Session', projectId: 'p1', extra: 'ignored',
      });

      const result = await executeToolCall(makeToolCall('create_session', { projectId: 'p1', name: 'New Session' }));
      const parsed = JSON.parse(result);

      expect(api.createSession).toHaveBeenCalledWith({ projectId: 'p1', name: 'New Session' });
      expect(parsed).toEqual({ id: 'new-s1', name: 'New Session', projectId: 'p1' });
    });
  });

  // ---- delete_session ----

  describe('delete_session', () => {
    it('deletes session and returns success', async () => {
      setupActiveBackend();
      (api.deleteSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await executeToolCall(makeToolCall('delete_session', { sessionId: 's1' }));
      const parsed = JSON.parse(result);

      expect(api.deleteSession).toHaveBeenCalledWith('s1');
      expect(parsed).toEqual({ success: true, deleted: 's1' });
    });
  });

  // ---- list_providers ----

  describe('list_providers', () => {
    it('returns provider summary', async () => {
      setupActiveBackend();
      (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'prov-1', name: 'Claude', type: 'anthropic', isDefault: true, apiKey: 'secret' },
      ]);

      const result = await executeToolCall(makeToolCall('list_providers'));
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({ id: 'prov-1', name: 'Claude', type: 'anthropic', isDefault: true });
      // Should not leak apiKey
      expect(parsed[0].apiKey).toBeUndefined();
    });
  });

  // ---- list_files ----

  describe('list_files', () => {
    it('lists directory with projectRoot and relativePath', async () => {
      setupActiveBackend();
      const files = [{ name: 'src', type: 'directory' }, { name: 'README.md', type: 'file' }];
      (api.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(files);

      const result = await executeToolCall(makeToolCall('list_files', {
        projectRoot: '/home/user/project',
        relativePath: 'src',
      }));
      const parsed = JSON.parse(result);

      expect(api.listDirectory).toHaveBeenCalledWith({
        projectRoot: '/home/user/project',
        relativePath: 'src',
      });
      expect(parsed).toEqual(files);
    });
  });

  // ---- read_file ----

  describe('read_file', () => {
    it('reads file and truncates to 10000 chars', async () => {
      setupActiveBackend();
      const longContent = 'L'.repeat(15000);
      (api.getFileContent as ReturnType<typeof vi.fn>).mockResolvedValue({ content: longContent });

      const result = await executeToolCall(makeToolCall('read_file', {
        projectRoot: '/home/user/project',
        relativePath: 'src/index.ts',
      }));

      expect(api.getFileContent).toHaveBeenCalledWith({
        projectRoot: '/home/user/project',
        relativePath: 'src/index.ts',
      });
      expect(result).toHaveLength(10000);
    });

    it('handles string result from api', async () => {
      setupActiveBackend();
      (api.getFileContent as ReturnType<typeof vi.fn>).mockResolvedValue('file content here');

      const result = await executeToolCall(makeToolCall('read_file', {
        projectRoot: '/root',
        relativePath: 'file.txt',
      }));

      expect(result).toBe('file content here');
    });
  });

  // ---- archive_sessions ----

  describe('archive_sessions', () => {
    it('archives sessions and returns count', async () => {
      setupActiveBackend();
      (api.archiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await executeToolCall(makeToolCall('archive_sessions', {
        sessionIds: ['s1', 's2', 's3'],
      }));
      const parsed = JSON.parse(result);

      expect(api.archiveSessions).toHaveBeenCalledWith(['s1', 's2', 's3']);
      expect(parsed).toEqual({ success: true, archived: 3 });
    });
  });

  // ---- Meta-agent: send_task_to_session ----

  describe('send_task_to_session', () => {
    it('returns error when no context provided', async () => {
      const result = await executeToolCall(
        makeToolCall('send_task_to_session', { sessionId: 's1', input: 'do something' }),
      );
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('No WebSocket connection');
    });

    it('returns error when not connected', async () => {
      const context = { sendWsMessage: vi.fn(), isConnected: false };

      const result = await executeToolCall(
        makeToolCall('send_task_to_session', { sessionId: 's1', input: 'do something' }),
        context,
      );
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('Not connected');
    });

    it('sends run_start message via WebSocket', async () => {
      const sendWsMessage = vi.fn();
      const context = { sendWsMessage, isConnected: true };

      const result = await executeToolCall(
        makeToolCall('send_task_to_session', { sessionId: 's1', input: 'implement auth' }),
        context,
      );
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain('s1');
      expect(parsed.clientRequestId).toBe('meta_test-uuid-1234');
      expect(sendWsMessage).toHaveBeenCalledWith({
        type: 'run_start',
        clientRequestId: 'meta_test-uuid-1234',
        sessionId: 's1',
        input: 'implement auth',
      });
    });
  });

  // ---- Meta-agent: get_session_status ----

  describe('get_session_status', () => {
    it('reports active run when present', async () => {
      mockChatState.mockReturnValue({
        activeRuns: { 'run-1': 's1', 'run-2': 's2' },
        messages: {
          s1: [
            { role: 'user', content: 'hello', createdAt: '2024-01-01' },
            { role: 'assistant', content: 'hi there', createdAt: '2024-01-02' },
          ],
        },
      });

      const result = await executeToolCall(makeToolCall('get_session_status', { sessionId: 's1' }));
      const parsed = JSON.parse(result);

      expect(parsed.hasActiveRun).toBe(true);
      expect(parsed.activeRunId).toBe('run-1');
      expect(parsed.totalMessages).toBe(2);
      expect(parsed.recentMessages).toHaveLength(2);
    });

    it('reports no active run when none', async () => {
      mockChatState.mockReturnValue({
        activeRuns: { 'run-2': 's2' },
        messages: { s1: [] },
      });

      const result = await executeToolCall(makeToolCall('get_session_status', { sessionId: 's1' }));
      const parsed = JSON.parse(result);

      expect(parsed.hasActiveRun).toBe(false);
      expect(parsed.activeRunId).toBeNull();
      expect(parsed.totalMessages).toBe(0);
    });

    it('returns at most 5 recent messages with truncated content', async () => {
      const longContent = 'C'.repeat(300);
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent,
        createdAt: `2024-01-${i + 1}`,
      }));
      mockChatState.mockReturnValue({
        activeRuns: {},
        messages: { s1: messages },
      });

      const result = await executeToolCall(makeToolCall('get_session_status', { sessionId: 's1' }));
      const parsed = JSON.parse(result);

      expect(parsed.totalMessages).toBe(10);
      expect(parsed.recentMessages).toHaveLength(5);
      // Content should be truncated to 200 chars
      expect(parsed.recentMessages[0].content).toHaveLength(200);
    });

    it('handles missing session gracefully', async () => {
      mockChatState.mockReturnValue({
        activeRuns: {},
        messages: {},
      });

      const result = await executeToolCall(makeToolCall('get_session_status', { sessionId: 'nonexistent' }));
      const parsed = JSON.parse(result);

      expect(parsed.hasActiveRun).toBe(false);
      expect(parsed.totalMessages).toBe(0);
      expect(parsed.recentMessages).toEqual([]);
    });
  });

  // ---- Remote backend routing ----

  describe('remote backend routing', () => {
    it('routes to remoteFetch for non-active backendId', async () => {
      setupRemoteBackend();
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ success: true, data: [] }),
      });

      await executeToolCall(makeToolCall('list_sessions', { backendId: 'remote-1' }));

      expect(api.getSessions).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Authorization': 'Bearer my-secret' }),
        }),
      );
    });

    it('uses api.ts directly when backendId is omitted', async () => {
      setupActiveBackend();
      (api.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await executeToolCall(makeToolCall('list_sessions'));

      expect(api.getSessions).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses api.ts directly when backendId matches active server', async () => {
      mockServerState.mockReturnValue({
        servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
        activeServerId: 'local-1',
      });
      mockGatewayState.mockReturnValue(desktopGw());
      (api.getProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await executeToolCall(makeToolCall('list_projects', { backendId: 'local-1' }));

      expect(api.getProjects).toHaveBeenCalled();
    });

    it('treats "local" as active backend in desktop mode', async () => {
      setupActiveBackend();
      (api.getProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await executeToolCall(makeToolCall('list_projects', { backendId: 'local' }));

      expect(api.getProjects).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeToolCall(makeToolCall('unknown_tool'));
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Unknown tool');
    });

    it('returns error on invalid JSON arguments', async () => {
      const result = await executeToolCall({
        id: 'call-bad',
        type: 'function',
        function: { name: 'list_projects', arguments: 'not valid json' },
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Tool execution failed');
    });

    it('returns error when API call fails', async () => {
      setupActiveBackend();
      (api.getProjects as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const result = await executeToolCall(makeToolCall('list_projects'));
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Network error');
    });
  });
});
