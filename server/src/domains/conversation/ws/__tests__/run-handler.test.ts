import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const sendMessageMock = vi.fn();
const broadcastToOthersMock = vi.fn();
const broadcastRunMessageMock = vi.fn();
const getNextOffsetMock = vi.fn(() => 0);
const upsertAssistantMessageMock = vi.fn();
const findProcessPidsByTaskCommandMock = vi.fn();
const cleanupPendingPermissionsMock = vi.fn();
const selectSkillsMock = vi.fn();
const getDiscoveredSkillsMock = vi.fn();
const loadSkillContentMock = vi.fn();
const buildSkillDirectoryHintMock = vi.fn(() => 'skill directory');
const assembleSystemPromptMock = vi.fn(async () => 'workspace prompt');
const assembleContextMock = vi.fn(() => 'assembled system prompt');
const providerRunMock = vi.fn();
const pluginEventsEmitMock = vi.fn(async () => {});
const toolRegistryGetAllMock = vi.fn(() => []);
const cancelBySessionMock = vi.fn();
const getGatewayClientMock = vi.fn(() => null);

vi.mock('../broadcast.js', () => ({
  sendMessage: sendMessageMock,
  broadcastToOtherAuthenticatedClients: broadcastToOthersMock,
  broadcastRunMessage: broadcastRunMessageMock,
}));

vi.mock('../run-lifecycle.js', () => ({
  getNextOffset: getNextOffsetMock,
  upsertAssistantMessage: upsertAssistantMessageMock,
  findProcessPidsByTaskCommand: findProcessPidsByTaskCommandMock,
  cleanupPendingPermissions: cleanupPendingPermissionsMock,
}));

vi.mock('../../../../plugins/skill-tools.js', () => ({
  getDiscoveredSkills: getDiscoveredSkillsMock,
  loadSkillContent: loadSkillContentMock,
  buildSkillDirectoryHint: buildSkillDirectoryHintMock,
}));

vi.mock('../../../../plugins/skill-selector.js', () => ({
  selectSkills: selectSkillsMock,
}));

const mockProviderRegistry = {
  getOrDefault: vi.fn(() => ({
    run: providerRunMock,
    manifest: undefined,
    getRunState: vi.fn(() => ({})),
  })),
  get: vi.fn(),
};

vi.mock('../../context/engine.js', () => ({
  createContextEngine: vi.fn(() => ({
    assemble: assembleContextMock,
  })),
}));

vi.mock('../../../../events/index.js', () => ({
  pluginEvents: {
    emit: pluginEventsEmitMock,
  },
}));

vi.mock('../../../../services/workspace.js', () => ({
  workspaceService: {
    assembleSystemPrompt: assembleSystemPromptMock,
  },
}));

vi.mock('../../../../plugins/tool-registry.js', () => ({
  toolRegistry: {
    getAll: toolRegistryGetAllMock,
  },
}));

vi.mock('../../../../domains/gateway/gateway-instance.js', () => ({
  getGatewayClient: getGatewayClientMock,
}));

vi.mock('../../interactions/interaction-dispatcher.js', () => ({
  interactionDispatcher: {
    cancelBySession: cancelBySessionMock,
  },
}));

vi.mock('../../interactions/interaction-normalizer.js', () => ({
  normalizeFromToolUse: vi.fn(() => null),
  normalizeFromAskUser: vi.fn(() => null),
}));

vi.mock('../../../../utils/provider-trace.js', () => ({
  createTraceRecorder: vi.fn(() => ({
    log: vi.fn(),
    setMeta: vi.fn(),
  })),
  summarizeProviderMessage: vi.fn(() => ''),
  summarizeServerMessage: vi.fn(() => ''),
}));

vi.mock('../../../../utils/provider-cwd.js', () => ({
  resolveProviderCwd: vi.fn(({ requestedCwd }) => requestedCwd),
}));

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      cli_path TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      created_at INTEGER,
      sdk_session_id TEXT,
      type TEXT,
      parent_session_id TEXT,
      working_directory TEXT,
      project_role TEXT,
      plan_status TEXT,
      task_id TEXT,
      provider_id TEXT,
      system_prompt TEXT,
      is_read_only INTEGER,
      last_run_status TEXT,
      updated_at INTEGER,
      archived_at INTEGER
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );

    CREATE TABLE IF NOT EXISTS permission_memories (
      id INTEGER PRIMARY KEY,
      session_id TEXT,
      remember_key TEXT,
      decision TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS permission_outside_workspace_roots (
      id INTEGER PRIMARY KEY,
      project_id TEXT,
      allowed_root TEXT,
      created_at INTEGER
    );
  `);

  const now = Date.now();
  db.prepare(`
    INSERT INTO providers (id, name, type, created_at, updated_at)
    VALUES ('provider-1', 'Claude', 'claude', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO projects (id, provider_id, root_path, system_prompt)
    VALUES ('project-1', 'provider-1', '/tmp', 'project system prompt')
  `).run();

  return db;
}

function insertSession(db: Database.Database, values: {
  id: string;
  type: 'agent' | 'regular' | 'background';
  sdkSessionId?: string | null;
}) {
  db.prepare(`
    INSERT INTO sessions (
      id, project_id, name, sdk_session_id, type, parent_session_id, working_directory, project_role,
      plan_status, task_id, provider_id, system_prompt, is_read_only, last_run_status, created_at, updated_at, archived_at
    )
    VALUES (?, 'project-1', 'Test Session', NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)
  `).run(values.id, values.type, Date.now(), Date.now());

  if (values.sdkSessionId !== undefined) {
    db.prepare(`UPDATE sessions SET sdk_session_id = ? WHERE id = ?`).run(values.sdkSessionId, values.id);
  }
}

async function* createProviderStream() {
  yield {
    type: 'init',
    sessionId: 'sdk-session-1',
    systemInfo: {
      cwd: '/tmp/project',
      permissionMode: 'default',
      tools: [],
      mcpServers: [],
      slashCommands: [],
      agents: [],
    },
  };
  yield {
    type: 'result',
    content: 'done',
    usage: { inputTokens: 1, outputTokens: 2 },
  };
}

describe('ws/run-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGatewayClientMock.mockReturnValue(null);
    providerRunMock.mockReturnValue(createProviderStream());
    assembleContextMock.mockReturnValue('assembled system prompt');
    assembleSystemPromptMock.mockResolvedValue('workspace prompt');
    buildSkillDirectoryHintMock.mockReturnValue('skill directory');
    toolRegistryGetAllMock.mockReturnValue([]);
    getDiscoveredSkillsMock.mockReturnValue([]);
    selectSkillsMock.mockReturnValue([]);
    loadSkillContentMock.mockImplementation((dirPath: string) => `loaded:${dirPath}`);
  });

  it('injects selected skill content into agent session prompts', async () => {
    const db = createDb();
    insertSession(db, { id: 'session-agent', type: 'agent' });

    const matchedSkill = {
      id: 'review-skill',
      dirPath: '/skills/review',
    };
    getDiscoveredSkillsMock.mockReturnValue([matchedSkill]);
    selectSkillsMock.mockReturnValue([matchedSkill]);

    const { handleRunStart } = await import('../run-handler.js');

    await handleRunStart(
      {
        id: 'client-1',
        ws: {} as any,
        isAlive: true,
        isLocal: true,
        authenticated: true,
      },
      {
        type: 'run_start',
        clientRequestId: 'req-1',
        sessionId: 'session-agent',
        input: 'please review this change',
      },
      db as any,
      {},
      undefined,
      {
        activeRuns: new Map(),
        processMonitor: null,
        notificationService: { notify: vi.fn() } as any,
        serverPort: null,
        broadcastHeartbeat: vi.fn(),
        providerRegistry: mockProviderRegistry,
      },
    );

    expect(selectSkillsMock).toHaveBeenCalledWith(
      [matchedSkill],
      expect.objectContaining({
        userInput: 'please review this change',
        os: process.platform,
      }),
    );
    expect(assembleContextMock).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({
        workspacePrompt: 'workspace prompt',
        skillDirectoryHint: 'skill directory',
        activeSkillsContent: 'loaded:/skills/review',
      }),
    );
    expect(providerRunMock).toHaveBeenCalledWith(
      'please review this change',
      expect.objectContaining({
        systemPrompt: 'assembled system prompt',
      }),
      expect.any(Function),
    );
  });

  it('prefers explicit _contextTemplate over the session-type default', async () => {
    const db = createDb();
    insertSession(db, { id: 'session-regular', type: 'regular' });

    const { handleRunStart } = await import('../run-handler.js');

    await handleRunStart(
      {
        id: 'client-1',
        ws: {} as any,
        isAlive: true,
        isLocal: true,
        authenticated: true,
      },
      {
        type: 'run_start',
        clientRequestId: 'req-2',
        sessionId: 'session-regular',
        input: 'debug this',
        _contextTemplate: 'review',
      } as any,
      db as any,
      {},
      undefined,
      {
        activeRuns: new Map(),
        processMonitor: null,
        notificationService: { notify: vi.fn() } as any,
        serverPort: null,
        broadcastHeartbeat: vi.fn(),
        providerRegistry: mockProviderRegistry,
      },
    );

    expect(assembleContextMock).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({
        activeSkillsContent: undefined,
      }),
    );
  });

  it('broadcasts session catalog updates when a run starts and finishes', async () => {
    const db = createDb();
    insertSession(db, { id: 'session-1', type: 'regular' });
    const broadcastSessionEvent = vi.fn();
    getGatewayClientMock.mockReturnValue({
      commands: {
        catalog: {
          broadcastSessionEvent,
        },
      },
    });

    const { handleRunStart } = await import('../run-handler.js');

    await handleRunStart(
      {
        id: 'client-1',
        ws: {} as any,
        isAlive: true,
        isLocal: true,
        authenticated: true,
      },
      {
        type: 'run_start',
        clientRequestId: 'req-3',
        sessionId: 'session-1',
        input: 'hello',
      },
      db as any,
      {},
      undefined,
      {
        activeRuns: new Map(),
        processMonitor: null,
        notificationService: { notify: vi.fn() } as any,
        serverPort: null,
        broadcastHeartbeat: vi.fn(),
        providerRegistry: mockProviderRegistry,
      },
    );

    expect(broadcastSessionEvent.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(broadcastSessionEvent.mock.calls[0]).toEqual([
      'updated',
      expect.objectContaining({ id: 'session-1', archivedAt: null }),
    ]);
    expect(broadcastSessionEvent.mock.calls.at(-1)).toEqual([
      'updated',
      expect.objectContaining({ id: 'session-1', archivedAt: null }),
    ]);
  });

  it('does not run session-scoped final cleanup twice after auto-reset retry handoff', async () => {
    const db = createDb();
    insertSession(db, { id: 'session-retry', type: 'regular', sdkSessionId: 'corrupted-session' });

    async function* crashStream() {
      throw new Error('process exited with code 1');
    }

    providerRunMock
      .mockReturnValueOnce(crashStream())
      .mockReturnValueOnce(createProviderStream());

    const { handleRunStart } = await import('../run-handler.js');

    await handleRunStart(
      {
        id: 'client-1',
        ws: {} as any,
        isAlive: true,
        isLocal: true,
        authenticated: true,
      },
      {
        type: 'run_start',
        clientRequestId: 'req-retry',
        sessionId: 'session-retry',
        input: 'retry this run',
      },
      db as any,
      {},
      undefined,
      {
        activeRuns: new Map(),
        processMonitor: null,
        notificationService: { notify: vi.fn() } as any,
        serverPort: null,
        broadcastHeartbeat: vi.fn(),
        providerRegistry: mockProviderRegistry,
      },
    );

    expect(providerRunMock).toHaveBeenCalledTimes(2);
    expect(cancelBySessionMock).toHaveBeenCalledTimes(1);
  });

  it('restores running state before continuing after auto-resolved permission timeout', async () => {
    vi.useFakeTimers();
    const db = createDb();
    insertSession(db, { id: 'session-background', type: 'background' });

    let observedStatusDuringResume: string | null = null;
    providerRunMock.mockImplementation(async function* (
      _input: string,
      _options: Record<string, unknown>,
      permissionCallback: (request: {
        requestId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
        detail: string;
        timeoutSeconds: number;
      }) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>
    ) {
      const decision = await permissionCallback({
        requestId: 'perm-timeout-1',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        detail: 'ls',
        timeoutSeconds: 1,
      });

      observedStatusDuringResume = (
        db.prepare('SELECT last_run_status FROM sessions WHERE id = ?').get('session-background') as { last_run_status: string | null }
      ).last_run_status;

      yield {
        type: 'result',
        content: decision.behavior,
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });

    const handleRunStartPromise = (await import('../run-handler.js')).handleRunStart(
      {
        id: 'client-1',
        ws: {} as any,
        isAlive: true,
        isLocal: true,
        authenticated: true,
      },
      {
        type: 'run_start',
        clientRequestId: 'req-timeout',
        sessionId: 'session-background',
        input: 'run background command',
        permissionOverride: {
          profile: {
            shellSafe: 'ask',
          },
          aiReview: {
            enabled: false,
          },
        },
      },
      db as any,
      {},
      undefined,
      {
        activeRuns: new Map(),
        processMonitor: null,
        notificationService: { notify: vi.fn() } as any,
        serverPort: null,
        broadcastHeartbeat: vi.fn(),
        providerRegistry: mockProviderRegistry,
      },
    );

    await vi.advanceTimersByTimeAsync(1000);
    await handleRunStartPromise;

    const sentMessages = sendMessageMock.mock.calls.map(([_, payload]) => payload);
    expect(observedStatusDuringResume).toBe('running');
    expect(sentMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'background_task_update',
        sessionId: 'session-background',
        status: 'running',
      }),
    ]));

    vi.useRealTimers();
  });
});
