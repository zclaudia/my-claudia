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
  isGatewayTarget: () => false,
  parseBackendId: () => '',
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
});
