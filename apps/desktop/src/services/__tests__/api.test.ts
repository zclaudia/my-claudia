import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  getSessions,
  createSession,
  updateSession,
  deleteSession,
  getSessionMessages,
  deleteSessionDraft,
  getProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  getProviderCommands,
  getProviderTypeCommands,
  listDirectory,
  listCommands,
  executeCommand,
  getBaseUrl,
  getAuthHeaders,
  AuthError,
  getSessionRunState,
  updateSessionWorkingDirectory,
  resetSessionSdkSession,
  dismissInterrupted,
  unlockSession,
  getProjectWorktrees,
  createProjectWorktree,
  archiveSessions,
  restoreSessions,
  getArchivedSessions,
  exportSession,
  getProviderCapabilities,
  getProviderTypeCapabilities,
  getFileContent,
  getServerInfo,
  getServerGatewayConfig,
  updateServerGatewayConfig,
  getServerGatewayStatus,
  connectServerToGateway,
  disconnectServerFromGateway,
  getServers,
  createServer,
  updateServer,
  deleteServer as deleteServerFn,
  ensureAgent,
  getAgentConfig,
  updateAgentConfig,
  getNotificationConfig,
  updateNotificationConfig,
  sendTestNotification,
  getMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServer,
  importMcpServers,
  listLocalPRs,
  createLocalPR,
  closeLocalPR,
  reviewLocalPR,
  mergeLocalPR,
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  triggerScheduledTask,
  listScheduledTaskTemplates,
  enableTemplateTask,
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow as deleteWorkflowFn,
  triggerWorkflow,
  listWorkflowRuns,
  getWorkflowRun,
  cancelWorkflowRun,
  approveWorkflowStep,
  rejectWorkflowStep,
  fetchLocalApi,
  setProjectReviewProvider,
  getWorktreeConfigs,
  upsertWorktreeConfig,
  searchMessages,
  getSearchHistory,
  clearSearchHistory,
  getSearchSuggestions,
  // Supervision API
  initSupervisionAgent,
  getSupervisionAgent,
  updateSupervisionAgentAction,
  getSupervisionTasks,
  createSupervisionTask,
  openTaskSession,
  getTaskPlanStatus,
  submitTaskPlan,
  updateSupervisionTask,
  approveSupervisionTask,
  rejectSupervisionTask,
  approveSupervisionTaskResult,
  rejectSupervisionTaskResult,
  retryTask,
  cancelTask,
  runTaskNow,
  resolveSupervisionConflict,
  reloadSupervisionContext,
  getSupervisionContext,
  getSupervisionBudget,
  getSupervisionV2Logs,
  // Local PR additional
  precheckLocalPRCreation,
  retryLocalPRReview,
  cancelLocalPRMerge,
  resolveLocalPRConflict,
  reopenLocalPR,
  revertLocalPRMerge,
  cancelLocalPRQueue,
  retryLocalPR,
  // Workflow additional
  getWorkflow,
  listWorkflowTemplates,
  listWorkflowStepTypes,
  createWorkflowFromTemplate,
  // Scheduled tasks
  listGlobalScheduledTasks,
} from '../api';

// Mock the serverStore
vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: () => ({
      activeServerId: 'server-1',
      getActiveServer: () => ({
        id: 'server-1',
        name: 'Test Server',
        address: 'localhost:3100',
      }),
      getDefaultServer: () => ({
        id: 'server-1',
        name: 'Test Server',
        address: 'localhost:3100',
      }),
      activeServerSupports: () => true,
    }),
  },
}));

// Mock the gatewayStore
vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: () => ({
      gatewayUrl: null,
      gatewaySecret: null,
      backendApiKeys: {},
    }),
  },
  isGatewayTarget: (id: string) => id?.startsWith('gw:'),
  parseBackendId: (id: string) => id?.slice(3),
}));

vi.mock('../gatewayProxy', () => ({
  resolveGatewayBackendUrl: (id: string) => `http://gateway/${id}`,
  getGatewayAuthHeaders: () => ({ Authorization: 'Bearer gw-token' }),
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('api', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Helper to setup fetch mock response
  const mockResponse = <T>(data: T, success = true) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success, data }),
    });
  };

  const mockError = (message: string, code = 'ERROR') => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        success: false,
        error: { code, message },
      }),
    });
  };

  describe('Projects API', () => {
    it('getProjects returns project list', async () => {
      const projects = [{ id: 'p1', name: 'Project 1' }];
      mockResponse(projects);

      const result = await getProjects();

      expect(result).toEqual(projects);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/projects',
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    it('createProject creates and returns project', async () => {
      const project = { id: 'p1', name: 'New Project', type: 'code' };
      mockResponse(project);

      const result = await createProject({ name: 'New Project' });

      expect(result).toEqual(project);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/projects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Project' }),
        })
      );
    });

    it('updateProject updates project', async () => {
      mockResponse(undefined);

      await updateProject('p1', { name: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/projects/p1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Updated' }),
        })
      );
    });

    it('deleteProject deletes project', async () => {
      mockResponse(undefined);

      await deleteProject('p1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/projects/p1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('throws on API error', async () => {
      mockError('Project not found');

      await expect(getProjects()).rejects.toThrow('Project not found');
    });
  });

  describe('Sessions API', () => {
    it('getSessions returns sessions', async () => {
      const sessions = [{ id: 's1', projectId: 'p1' }];
      mockResponse(sessions);

      const result = await getSessions();

      expect(result).toEqual(sessions);
    });

    it('getSessions filters by projectId', async () => {
      const sessions = [{ id: 's1', projectId: 'p1' }];
      mockResponse(sessions);

      await getSessions('p1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/sessions?projectId=p1',
        expect.any(Object)
      );
    });

    it('createSession creates session', async () => {
      const session = { id: 's1', projectId: 'p1', name: 'Session' };
      mockResponse(session);

      const result = await createSession({ projectId: 'p1', name: 'Session' });

      expect(result).toEqual(session);
    });

    it('updateSession updates session', async () => {
      mockResponse(undefined);

      await updateSession('s1', { name: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/sessions/s1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Updated' }),
        })
      );
    });

    it('deleteSession deletes session', async () => {
      mockResponse(undefined);

      await deleteSession('s1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/sessions/s1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('getSessionMessages returns paginated messages', async () => {
      const data = {
        messages: [{ id: 'm1', content: 'Hello' }],
        pagination: { total: 1, hasMore: false },
      };
      mockResponse(data);

      const result = await getSessionMessages('s1');

      expect(result).toEqual(data);
    });

    it('getSessionMessages supports before/after cursors', async () => {
      mockResponse({ messages: [], pagination: { total: 0, hasMore: false } });

      await getSessionMessages('s1', { limit: 10, before: 1000, after: 500 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('before=1000'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('after=500'),
        expect.any(Object)
      );
    });

    it('deleteSessionDraft deletes the draft', async () => {
      mockResponse(undefined);

      await deleteSessionDraft('s1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/sessions/s1/draft',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Providers API', () => {
    it('getProviders returns providers', async () => {
      const providers = [{ id: 'prov1', name: 'Provider' }];
      mockResponse(providers);

      const result = await getProviders();

      expect(result).toEqual(providers);
    });

    it('createProvider creates provider', async () => {
      const provider = { id: 'prov1', name: 'New Provider' };
      mockResponse(provider);

      const result = await createProvider({ name: 'New Provider' });

      expect(result).toEqual(provider);
    });

    it('updateProvider updates provider', async () => {
      mockResponse(undefined);

      await updateProvider('prov1', { name: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/providers/prov1',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('deleteProvider deletes provider', async () => {
      mockResponse(undefined);

      await deleteProvider('prov1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/providers/prov1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('setDefaultProvider sets default', async () => {
      mockResponse(undefined);

      await setDefaultProvider('prov1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/providers/prov1/set-default',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('getProviderCommands returns commands', async () => {
      const commands = [{ command: '/help', description: 'Help' }];
      mockResponse(commands);

      const result = await getProviderCommands('prov1');

      expect(result).toEqual(commands);
    });

    it('getProviderTypeCommands returns commands by type', async () => {
      const commands = [{ command: '/help', description: 'Help' }];
      mockResponse(commands);

      const result = await getProviderTypeCommands('claude');

      expect(result).toEqual(commands);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/providers/type/claude/commands',
        expect.any(Object)
      );
    });
  });

  describe('Files API', () => {
    it('listDirectory returns directory entries', async () => {
      const data = {
        entries: [{ name: 'src', type: 'directory' }],
        currentPath: '',
        hasMore: false,
      };
      mockResponse(data);

      const result = await listDirectory({ projectRoot: '/project' });

      expect(result).toEqual(data);
    });

    it('listDirectory builds query params correctly', async () => {
      mockResponse({ entries: [], currentPath: '', hasMore: false });

      await listDirectory({
        projectRoot: '/project',
        relativePath: 'src',
        query: 'test',
        maxResults: 10,
      });

      const call = mockFetch.mock.calls[0][0];
      expect(call).toContain('projectRoot=%2Fproject');
      expect(call).toContain('relativePath=src');
      expect(call).toContain('query=test');
      expect(call).toContain('maxResults=10');
    });
  });

  describe('Extended Sessions API', () => {
    it('getSessionRunState', async () => {
      mockResponse({ sessionId: 's1', isRunning: true, activeRunId: 'r1' });
      const result = await getSessionRunState('s1');
      expect(result.isRunning).toBe(true);
    });

    it('updateSessionWorkingDirectory', async () => {
      mockResponse(undefined);
      await updateSessionWorkingDirectory('s1', '/new/path');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/s1/working-directory'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('resetSessionSdkSession', async () => {
      mockResponse({ sessionId: 's1', reset: true });
      await resetSessionSdkSession('s1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/s1/reset-sdk-session'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('dismissInterrupted', async () => {
      mockResponse(undefined);
      await dismissInterrupted('s1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/s1/dismiss-interrupted'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('unlockSession', async () => {
      mockResponse({ id: 's1', isReadOnly: false });
      const result = await unlockSession('s1');
      expect(result.id).toBe('s1');
    });

    it('archiveSessions', async () => {
      mockResponse(undefined);
      await archiveSessions(['s1', 's2']);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/archive'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('restoreSessions', async () => {
      mockResponse(undefined);
      await restoreSessions(['s1']);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/restore'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('getArchivedSessions', async () => {
      mockResponse([{ id: 's1' }]);
      const result = await getArchivedSessions();
      expect(result).toHaveLength(1);
    });

    it('exportSession', async () => {
      mockResponse({ markdown: '# Test', sessionName: 'Test' });
      const result = await exportSession('s1');
      expect(result.markdown).toBe('# Test');
    });

    it('getProjectWorktrees', async () => {
      mockResponse([{ path: '/wt1' }]);
      const result = await getProjectWorktrees('p1');
      expect(result).toHaveLength(1);
    });

    it('getProjectWorktrees returns empty on failure', async () => {
      mockResponse(null, false);
      const result = await getProjectWorktrees('p1');
      expect(result).toEqual([]);
    });

    it('createProjectWorktree', async () => {
      mockResponse({ path: '/wt1', branch: 'feature' });
      const result = await createProjectWorktree('p1', 'feature');
      expect(result.branch).toBe('feature');
    });
  });

  describe('Search API', () => {
    it('searchMessages', async () => {
      mockResponse({ results: [{ id: 'm1', content: 'found' }] });
      const result = await searchMessages('test');
      expect(result).toHaveLength(1);
    });

    it('getSearchHistory', async () => {
      mockResponse({ history: [{ query: 'test' }] });
      const result = await getSearchHistory();
      expect(result).toHaveLength(1);
    });

    it('clearSearchHistory', async () => {
      mockResponse(undefined);
      await clearSearchHistory();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/search/history'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('getSearchSuggestions', async () => {
      mockResponse({ suggestions: ['suggestion1'] });
      const result = await getSearchSuggestions('sug');
      expect(result).toEqual(['suggestion1']);
    });
  });

  describe('Extended Providers API', () => {
    it('getProviderCapabilities', async () => {
      mockResponse({ streaming: true });
      const result = await getProviderCapabilities('prov1');
      expect(result).toEqual({ streaming: true });
    });

    it('getProviderTypeCapabilities', async () => {
      mockResponse({ streaming: true });
      const result = await getProviderTypeCapabilities('claude');
      expect(result).toEqual({ streaming: true });
    });
  });

  describe('Server Management API', () => {
    it('getServerInfo', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ success: true, data: { version: '1.0' } }),
      });
      const result = await getServerInfo('localhost:3100');
      expect(result).toBeDefined();
    });

    it('getServerGatewayConfig', async () => {
      mockResponse({ gatewayUrl: 'url', secret: 'sec' });
      const result = await getServerGatewayConfig();
      expect(result.gatewayUrl).toBe('url');
    });

    it('updateServerGatewayConfig', async () => {
      mockResponse({ gatewayUrl: 'url' });
      await updateServerGatewayConfig({ gatewayUrl: 'url' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/server/gateway/config'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('getServerGatewayStatus', async () => {
      mockResponse({ connected: true });
      const result = await getServerGatewayStatus();
      expect(result.connected).toBe(true);
    });

    it('connectServerToGateway', async () => {
      mockResponse({ message: 'connected' });
      const result = await connectServerToGateway();
      expect(result.message).toBe('connected');
    });

    it('disconnectServerFromGateway', async () => {
      mockResponse({ message: 'disconnected' });
      const result = await disconnectServerFromGateway();
      expect(result.message).toBe('disconnected');
    });

    it('getServers', async () => {
      mockResponse([{ id: 's1' }]);
      const result = await getServers();
      expect(result).toHaveLength(1);
    });

    it('createServer', async () => {
      mockResponse({ id: 's1', name: 'New' });
      const result = await createServer({ name: 'New', address: 'localhost:3100' } as any);
      expect(result.id).toBe('s1');
    });

    it('updateServer', async () => {
      mockResponse(undefined);
      await updateServer('s1', { name: 'Updated' } as any);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/servers/s1'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('deleteServer', async () => {
      mockResponse(undefined);
      await deleteServerFn('s1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/servers/s1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Agent API', () => {
    it('ensureAgent', async () => {
      mockResponse({ projectId: 'p1', sessionId: 's1' });
      const result = await ensureAgent();
      expect(result.projectId).toBe('p1');
    });

    it('getAgentConfig', async () => {
      mockResponse({ maxConcurrent: 3 });
      const result = await getAgentConfig();
      expect(result.maxConcurrent).toBe(3);
    });

    it('updateAgentConfig', async () => {
      mockResponse(undefined);
      await updateAgentConfig({ maxConcurrent: 5 } as any);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/agent/config'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('Notifications API', () => {
    it('getNotificationConfig', async () => {
      mockResponse({ enabled: true });
      const result = await getNotificationConfig();
      expect(result.enabled).toBe(true);
    });

    it('updateNotificationConfig', async () => {
      mockResponse(undefined);
      await updateNotificationConfig({ enabled: false } as any);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/config'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('sendTestNotification', async () => {
      mockResponse(undefined);
      await sendTestNotification();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/test'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('MCP Servers API', () => {
    it('getMcpServers', async () => {
      mockResponse([{ id: 'mcp1' }]);
      const result = await getMcpServers();
      expect(result).toHaveLength(1);
    });

    it('createMcpServer', async () => {
      mockResponse({ id: 'mcp1' });
      const result = await createMcpServer({ name: 'Test', command: 'node', args: [] } as any);
      expect(result.id).toBe('mcp1');
    });

    it('updateMcpServer', async () => {
      mockResponse({ id: 'mcp1' });
      const result = await updateMcpServer('mcp1', { name: 'Updated' });
      expect(result.id).toBe('mcp1');
    });

    it('deleteMcpServer', async () => {
      mockResponse(undefined);
      await deleteMcpServer('mcp1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/mcp-servers/mcp1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('toggleMcpServer', async () => {
      mockResponse({ id: 'mcp1', enabled: true });
      const result = await toggleMcpServer('mcp1');
      expect(result.enabled).toBe(true);
    });

    it('importMcpServers', async () => {
      mockResponse({ imported: [], skipped: [] });
      const result = await importMcpServers();
      expect(result.imported).toEqual([]);
    });
  });

  describe('Local PRs API', () => {
    it('listLocalPRs', async () => {
      mockResponse([{ id: 'pr1' }]);
      const result = await listLocalPRs('p1');
      expect(result).toHaveLength(1);
    });

    it('createLocalPR', async () => {
      mockResponse({ id: 'pr1' });
      const result = await createLocalPR('p1', { title: 'PR', sourceBranch: 'feature', targetBranch: 'main' });
      expect(result.id).toBe('pr1');
    });

    it('closeLocalPR', async () => {
      mockResponse({ id: 'pr1', status: 'closed' });
      const result = await closeLocalPR('pr1');
      expect(result.status).toBe('closed');
    });

    it('reviewLocalPR', async () => {
      mockResponse({ id: 'pr1' });
      const result = await reviewLocalPR('pr1');
      expect(result.id).toBe('pr1');
    });

    it('mergeLocalPR', async () => {
      mockResponse({ id: 'pr1', status: 'merged' });
      const result = await mergeLocalPR('pr1');
      expect(result.status).toBe('merged');
    });

    it('setProjectReviewProvider', async () => {
      mockResponse(undefined);
      await setProjectReviewProvider('p1', 'prov1');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('getWorktreeConfigs', async () => {
      mockResponse([{ projectId: 'p1' }]);
      const result = await getWorktreeConfigs('p1');
      expect(result).toHaveLength(1);
    });

    it('upsertWorktreeConfig', async () => {
      mockResponse({ projectId: 'p1' });
      const result = await upsertWorktreeConfig('p1', { autoCreatePR: true, autoReview: false });
      expect(result.projectId).toBe('p1');
    });
  });

  describe('Scheduled Tasks API', () => {
    it('listScheduledTasks', async () => {
      mockResponse([{ id: 'st1' }]);
      const result = await listScheduledTasks('p1');
      expect(result).toHaveLength(1);
    });

    it('createScheduledTask', async () => {
      mockResponse({ id: 'st1' });
      const result = await createScheduledTask('p1', { name: 'Task' } as any);
      expect(result.id).toBe('st1');
    });

    it('updateScheduledTask', async () => {
      mockResponse({ id: 'st1' });
      const result = await updateScheduledTask('st1', { name: 'Updated' } as any);
      expect(result.id).toBe('st1');
    });

    it('deleteScheduledTask', async () => {
      mockResponse(undefined);
      await deleteScheduledTask('st1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/scheduled-tasks/st1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('triggerScheduledTask', async () => {
      mockResponse({ id: 'st1' });
      const result = await triggerScheduledTask('st1');
      expect(result.id).toBe('st1');
    });

    it('listScheduledTaskTemplates', async () => {
      mockResponse([{ id: 'tpl1' }]);
      const result = await listScheduledTaskTemplates();
      expect(result).toHaveLength(1);
    });

    it('enableTemplateTask', async () => {
      mockResponse({ id: 'st1' });
      const result = await enableTemplateTask('p1', 'tpl1');
      expect(result.id).toBe('st1');
    });
  });

  describe('Workflows API', () => {
    it('listWorkflows', async () => {
      mockResponse([{ id: 'w1' }]);
      const result = await listWorkflows('p1');
      expect(result).toHaveLength(1);
    });

    it('createWorkflow', async () => {
      mockResponse({ id: 'w1' });
      const result = await createWorkflow('p1', { name: 'WF', definition: {} } as any);
      expect(result.id).toBe('w1');
    });

    it('updateWorkflow', async () => {
      mockResponse({ id: 'w1' });
      const result = await updateWorkflow('w1', { name: 'Updated' } as any);
      expect(result.id).toBe('w1');
    });

    it('deleteWorkflow', async () => {
      mockResponse(undefined);
      await deleteWorkflowFn('w1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/workflows/w1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('triggerWorkflow', async () => {
      mockResponse({ id: 'wr1' });
      const result = await triggerWorkflow('w1');
      expect(result.id).toBe('wr1');
    });

    it('listWorkflowRuns', async () => {
      mockResponse([{ id: 'wr1' }]);
      const result = await listWorkflowRuns('w1');
      expect(result).toHaveLength(1);
    });

    it('getWorkflowRun', async () => {
      mockResponse({ run: { id: 'wr1' }, stepRuns: [] });
      const result = await getWorkflowRun('wr1');
      expect(result.run.id).toBe('wr1');
    });

    it('cancelWorkflowRun', async () => {
      mockResponse(undefined);
      await cancelWorkflowRun('wr1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/workflow-runs/wr1/cancel'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('approveWorkflowStep', async () => {
      mockResponse(undefined);
      await approveWorkflowStep('sr1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/workflow-step-runs/sr1/approve'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('rejectWorkflowStep', async () => {
      mockResponse(undefined);
      await rejectWorkflowStep('sr1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/workflow-step-runs/sr1/reject'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Auth and URL helpers', () => {
    it('getBaseUrl returns http:// prefixed address', () => {
      const url = getBaseUrl();
      expect(url).toBe('http://localhost:3100');
    });

    it('getAuthHeaders returns empty for direct server', () => {
      const headers = getAuthHeaders();
      expect(headers).toEqual({});
    });

    it('AuthError has correct name', () => {
      const err = new AuthError('test');
      expect(err.name).toBe('AuthError');
      expect(err.message).toBe('test');
    });

    it('fetchApi throws AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      await expect(getProjects()).rejects.toThrow(AuthError);
    });

    it('fetchApi throws AuthError on 403', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      await expect(getProjects()).rejects.toThrow(AuthError);
    });

    it('fetchLocalApi works', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ success: true, data: 'local' }),
      });
      const result = await fetchLocalApi('/api/test');
      expect(result.data).toBe('local');
    });
  });

  describe('Files API extended', () => {
    it('getFileContent returns file content', async () => {
      mockResponse({ content: 'hello', language: 'ts' });
      const result = await getFileContent({ projectRoot: '/p', relativePath: 'file.ts' });
      expect(result.content).toBe('hello');
    });
  });

  describe('Commands API', () => {
    it('listCommands returns builtin and custom', async () => {
      const data = {
        builtin: [{ command: '/help', description: 'Help' }],
        custom: [],
        count: 1,
      };
      mockResponse(data);

      const result = await listCommands();

      expect(result).toEqual(data);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/commands/list',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('executeCommand executes and returns result', async () => {
      const result = {
        type: 'builtin',
        command: '/help',
        action: 'help',
        data: { content: 'Help text' },
      };
      mockResponse(result);

      const response = await executeCommand({
        commandName: '/help',
      });

      expect(response).toEqual(result);
    });
  });

  describe('Supervision API', () => {
    it('initSupervisionAgent initializes agent', async () => {
      const agent = { id: 'agent-1', projectId: 'p1' };
      mockResponse(agent);
      const result = await initSupervisionAgent('p1', { systemPrompt: 'test' });
      expect(result).toEqual(agent);
    });

    it('getSupervisionAgent returns agent', async () => {
      const agent = { id: 'agent-1', projectId: 'p1' };
      mockResponse(agent);
      const result = await getSupervisionAgent('p1');
      expect(result).toEqual(agent);
    });

    it('getSupervisionAgent returns null on error', async () => {
      mockError('Not found', 'NOT_FOUND');
      const result = await getSupervisionAgent('p1');
      expect(result).toBeNull();
    });

    it('updateSupervisionAgentAction updates agent', async () => {
      const agent = { id: 'agent-1', projectId: 'p1', status: 'paused' };
      mockResponse(agent);
      const result = await updateSupervisionAgentAction('p1', 'pause');
      expect(result).toEqual(agent);
    });

    it('getSupervisionTasks returns tasks', async () => {
      const tasks = [{ id: 't1', title: 'Task 1' }];
      mockResponse(tasks);
      const result = await getSupervisionTasks('p1');
      expect(result).toEqual(tasks);
    });

    it('createSupervisionTask creates a task', async () => {
      const task = { id: 't1', title: 'New Task' };
      mockResponse(task);
      const result = await createSupervisionTask('p1', { title: 'New Task', description: 'Desc', priority: 0 });
      expect(result).toEqual(task);
    });

    it('openTaskSession opens a session', async () => {
      mockResponse({ sessionId: 's1' });
      const result = await openTaskSession('t1');
      expect(result).toEqual({ sessionId: 's1' });
    });

    it('getTaskPlanStatus returns status', async () => {
      const status = { hasPlan: true, planSummary: 'Plan' };
      mockResponse(status);
      const result = await getTaskPlanStatus('t1');
      expect(result).toEqual(status);
    });

    it('submitTaskPlan submits plan', async () => {
      const result = { task: { id: 't1' }, sessionId: 's1' };
      mockResponse(result);
      const response = await submitTaskPlan('t1');
      expect(response).toEqual(result);
    });

    it('updateSupervisionTask updates a task', async () => {
      const task = { id: 't1', title: 'Updated' };
      mockResponse(task);
      const result = await updateSupervisionTask('t1', { title: 'Updated' });
      expect(result).toEqual(task);
    });

    it('approveSupervisionTask approves', async () => {
      const task = { id: 't1', status: 'pending' };
      mockResponse(task);
      const result = await approveSupervisionTask('t1');
      expect(result).toEqual(task);
    });

    it('rejectSupervisionTask rejects', async () => {
      const task = { id: 't1', status: 'cancelled' };
      mockResponse(task);
      const result = await rejectSupervisionTask('t1');
      expect(result).toEqual(task);
    });

    it('approveSupervisionTaskResult approves result', async () => {
      const task = { id: 't1', status: 'approved' };
      mockResponse(task);
      const result = await approveSupervisionTaskResult('t1');
      expect(result).toEqual(task);
    });

    it('rejectSupervisionTaskResult rejects result', async () => {
      const task = { id: 't1', status: 'rejected' };
      mockResponse(task);
      const result = await rejectSupervisionTaskResult('t1', 'Bad result');
      expect(result).toEqual(task);
    });

    it('retryTask retries', async () => {
      const task = { id: 't1', status: 'pending' };
      mockResponse(task);
      const result = await retryTask('t1');
      expect(result).toEqual(task);
    });

    it('cancelTask cancels', async () => {
      const task = { id: 't1', status: 'cancelled' };
      mockResponse(task);
      const result = await cancelTask('t1');
      expect(result).toEqual(task);
    });

    it('runTaskNow runs immediately', async () => {
      const task = { id: 't1', status: 'running' };
      mockResponse(task);
      const result = await runTaskNow('t1');
      expect(result).toEqual(task);
    });

    it('resolveSupervisionConflict resolves', async () => {
      const task = { id: 't1', status: 'running' };
      mockResponse(task);
      const result = await resolveSupervisionConflict('t1');
      expect(result).toEqual(task);
    });

    it('reloadSupervisionContext reloads', async () => {
      mockResponse(undefined);
      await reloadSupervisionContext('p1');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('getSupervisionContext returns context', async () => {
      const ctx = [{ type: 'file', path: 'a.ts' }];
      mockResponse(ctx);
      const result = await getSupervisionContext('p1');
      expect(result).toEqual(ctx);
    });

    it('getSupervisionBudget returns budget', async () => {
      const budget = { maxConcurrentTasks: 3, currentActiveTasks: 1, maxTotalTasks: 10, currentTotalTasks: 5, maxBudgetUsd: 100 };
      mockResponse(budget);
      const result = await getSupervisionBudget('p1');
      expect(result).toEqual(budget);
    });

    it('getSupervisionV2Logs returns logs', async () => {
      const logs = { logs: [{ id: 'l1' }], totalCount: 1, hasMore: false };
      mockResponse(logs);
      const result = await getSupervisionV2Logs('p1');
      expect(result).toEqual(logs);
    });
  });

  describe('Additional Local PR API', () => {
    it('precheckLocalPRCreation returns precheck result', async () => {
      const result = { canCreate: true };
      mockResponse(result);
      const response = await precheckLocalPRCreation('p1', 'feature');
      expect(response).toEqual(result);
    });

    it('retryLocalPRReview retries review', async () => {
      const pr = { id: 'pr1', status: 'reviewing' };
      mockResponse(pr);
      const result = await retryLocalPRReview('pr1');
      expect(result).toEqual(pr);
    });

    it('cancelLocalPRMerge cancels merge', async () => {
      const pr = { id: 'pr1', status: 'approved' };
      mockResponse(pr);
      const result = await cancelLocalPRMerge('pr1');
      expect(result).toEqual(pr);
    });

    it('resolveLocalPRConflict resolves', async () => {
      const pr = { id: 'pr1', status: 'resolving' };
      mockResponse(pr);
      const result = await resolveLocalPRConflict('pr1');
      expect(result).toEqual(pr);
    });

    it('reopenLocalPR reopens', async () => {
      const pr = { id: 'pr1', status: 'open' };
      mockResponse(pr);
      const result = await reopenLocalPR('pr1');
      expect(result).toEqual(pr);
    });

    it('revertLocalPRMerge reverts', async () => {
      const pr = { id: 'pr1', status: 'open' };
      mockResponse(pr);
      const result = await revertLocalPRMerge('pr1');
      expect(result).toEqual(pr);
    });

    it('cancelLocalPRQueue cancels queue', async () => {
      const pr = { id: 'pr1', status: 'open' };
      mockResponse(pr);
      const result = await cancelLocalPRQueue('pr1');
      expect(result).toEqual(pr);
    });

    it('retryLocalPR retries', async () => {
      const pr = { id: 'pr1', status: 'reviewing' };
      mockResponse(pr);
      const result = await retryLocalPR('pr1');
      expect(result).toEqual(pr);
    });
  });

  describe('Additional Workflow API', () => {
    it('getWorkflow returns workflow', async () => {
      const wf = { id: 'wf1', name: 'My Workflow' };
      mockResponse(wf);
      const result = await getWorkflow('wf1');
      expect(result).toEqual(wf);
    });

    it('listWorkflowTemplates returns templates', async () => {
      const templates = [{ id: 't1', name: 'Template' }];
      mockResponse(templates);
      const result = await listWorkflowTemplates();
      expect(result).toEqual(templates);
    });

    it('listWorkflowStepTypes returns step types', async () => {
      const types = [{ type: 'shell', name: 'Shell' }];
      mockResponse(types);
      const result = await listWorkflowStepTypes();
      expect(result).toEqual(types);
    });

    it('createWorkflowFromTemplate creates workflow', async () => {
      const wf = { id: 'wf1', name: 'From Template' };
      mockResponse(wf);
      const result = await createWorkflowFromTemplate('p1', 't1');
      expect(result).toEqual(wf);
    });
  });

  describe('Additional misc API', () => {
    it('sendTestNotification sends notification', async () => {
      mockResponse(undefined);
      await sendTestNotification();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/test'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('toggleMcpServer toggles server', async () => {
      const server = { id: 'mcp1', enabled: true };
      mockResponse(server);
      const result = await toggleMcpServer('mcp1');
      expect(result).toEqual(server);
    });

    it('searchMessages searches with filters', async () => {
      const results = [{ id: 'm1', content: 'hello' }];
      mockResponse({ results });
      const result = await searchMessages('hello', { projectId: 'p1' });
      expect(result).toEqual(results);
    });

    it('clearSearchHistory clears history', async () => {
      mockResponse(undefined);
      await clearSearchHistory();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/search/history'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('upsertWorktreeConfig upserts config', async () => {
      const config = { projectId: 'p1', worktreePath: '/path' };
      mockResponse(config);
      const result = await upsertWorktreeConfig('p1', { worktreePath: '/path', autoCreatePR: true, autoReview: false });
      expect(result).toEqual(config);
    });

    it('listGlobalScheduledTasks returns tasks', async () => {
      const tasks = [{ id: 'st1', name: 'Daily task' }];
      mockResponse(tasks);
      const result = await listGlobalScheduledTasks();
      expect(result).toEqual(tasks);
    });

    it('enableTemplateTask enables template', async () => {
      const task = { id: 'st1', enabled: true };
      mockResponse(task);
      const result = await enableTemplateTask('p1', 'tmpl1');
      expect(result).toEqual(task);
    });
  });

  describe('fetchLocalApi', () => {
    it('fetches from local server', async () => {
      mockResponse({ key: 'value' });
      const result = await fetchLocalApi('/api/test');
      expect(result).toEqual({ success: true, data: { key: 'value' } });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/test',
        expect.any(Object)
      );
    });

    it('throws AuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ success: false }),
      });
      await expect(fetchLocalApi('/api/test')).rejects.toThrow(AuthError);
    });

    it('throws AuthError on 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ success: false }),
      });
      await expect(fetchLocalApi('/api/test')).rejects.toThrow(AuthError);
    });
  });

  describe('error branches for local PR functions', () => {
    const mockError = () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, error: { message: 'Server error' } }),
      });
    };

    const mockErrorNoMessage = () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false }),
      });
    };

    it('cancelLocalPRQueue throws on error', async () => {
      mockError();
      await expect(cancelLocalPRQueue('pr1')).rejects.toThrow('Server error');
    });

    it('cancelLocalPRQueue throws default message', async () => {
      mockErrorNoMessage();
      await expect(cancelLocalPRQueue('pr1')).rejects.toThrow('Failed to cancel queue');
    });

    it('retryLocalPR throws on error', async () => {
      mockError();
      await expect(retryLocalPR('pr1')).rejects.toThrow('Server error');
    });

    it('retryLocalPR throws default message', async () => {
      mockErrorNoMessage();
      await expect(retryLocalPR('pr1')).rejects.toThrow('Failed to retry');
    });

    it('setProjectReviewProvider throws on error', async () => {
      mockError();
      await expect(setProjectReviewProvider('p1', 'prov1')).rejects.toThrow('Server error');
    });

    it('setProjectReviewProvider throws default message', async () => {
      mockErrorNoMessage();
      await expect(setProjectReviewProvider('p1', 'prov1')).rejects.toThrow('Failed to set review provider');
    });

    it('getWorktreeConfigs throws on error', async () => {
      mockError();
      await expect(getWorktreeConfigs('p1')).rejects.toThrow('Server error');
    });

    it('getWorktreeConfigs throws default message', async () => {
      mockErrorNoMessage();
      await expect(getWorktreeConfigs('p1')).rejects.toThrow('Failed to list worktree configs');
    });

    it('upsertWorktreeConfig throws on error', async () => {
      mockError();
      await expect(upsertWorktreeConfig('p1', { worktreePath: '/path', autoCreatePR: true, autoReview: false })).rejects.toThrow('Server error');
    });

    it('upsertWorktreeConfig throws default message', async () => {
      mockErrorNoMessage();
      await expect(upsertWorktreeConfig('p1', { worktreePath: '/path', autoCreatePR: false, autoReview: false })).rejects.toThrow('Failed to update worktree config');
    });
  });
});
