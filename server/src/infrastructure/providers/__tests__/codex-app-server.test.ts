import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appendFileSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const existsSyncMock = vi.fn(() => false);
const unlinkSyncMock = vi.fn();
const readFileSyncMock = vi.fn(() => '');
const realpathSyncMock = vi.fn((value: string) => value);
const loadMcpServersFromDbMock = vi.fn(() => ({}));
const buildMcpBridgeEntryMock = vi.fn(() => null);

vi.mock('fs', () => ({
  appendFileSync: appendFileSyncMock,
  writeFileSync: writeFileSyncMock,
  mkdirSync: mkdirSyncMock,
  existsSync: existsSyncMock,
  unlinkSync: unlinkSyncMock,
  readFileSync: readFileSyncMock,
  realpathSync: realpathSyncMock,
}));

vi.mock('../../../utils/mcp-config.js', () => ({
  loadMcpServersFromDb: loadMcpServersFromDbMock,
}));

vi.mock('../../../utils/mcp-bridge-launch.js', () => ({
  buildMcpBridgeEntry: buildMcpBridgeEntryMock,
}));

async function drain<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust generator
  }
}

describe('codex-app-server', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('');
    realpathSyncMock.mockImplementation((value: string) => value);
    loadMcpServersFromDbMock.mockReturnValue({});
    buildMcpBridgeEntryMock.mockReturnValue(null);
  });

  afterEach(async () => {
    const mod = await import('../codex-app-server');
    mod.destroyAllAppServerClients();
    mod.resetAppServerClientsForTests();
  });

  it('creates a new app-server client when MCP config changes', async () => {
    loadMcpServersFromDbMock
      .mockReturnValueOnce({ Alpha: { command: 'alpha-mcp' } })
      .mockReturnValueOnce({ Beta: { command: 'beta-mcp' } });

    const mod = await import('../codex-app-server');

    const options = {
      cwd: '/tmp/project',
      db: {} as unknown as import('better-sqlite3').Database,
      env: { TEST_ENV: '1' },
      claudiaSessionId: 'session-1',
    };

    const first = mod.getOrCreateAppServerClient(options);
    const second = mod.getOrCreateAppServerClient(options);

    expect(first).not.toBe(second);
    expect(writeFileSyncMock).toHaveBeenCalledTimes(4);
  });

  it('does not reap clients with active turns during idle cleanup', async () => {
    const mod = await import('../codex-app-server');

    const active = mod.getOrCreateAppServerClient({
      cwd: '/tmp/project',
      env: { TEST_ENV: 'active' },
      claudiaSessionId: 'session-active',
    });
    const idle = mod.getOrCreateAppServerClient({
      cwd: '/tmp/project',
      env: { TEST_ENV: 'idle' },
      claudiaSessionId: 'session-idle',
    });

    const activeDestroySpy = vi.spyOn(active, 'destroy');
    const idleDestroySpy = vi.spyOn(idle, 'destroy');

    active.lastActivity = 0;
    active.activeTurns = 1;
    idle.lastActivity = 0;
    idle.activeTurns = 0;

    mod.runIdleCleanup(mod.IDLE_TIMEOUT_MS + 1);

    expect(activeDestroySpy).not.toHaveBeenCalled();
    expect(idleDestroySpy).toHaveBeenCalledTimes(1);
  });

  it('trusts the codex config directory before relying on project config.toml', async () => {
    realpathSyncMock.mockReturnValue('/private/tmp/my-claudia-dev/codex-config');

    const mod = await import('../codex-app-server');
    mod.getOrCreateAppServerClient({
      cwd: '/tmp/project',
      env: { TEST_ENV: 'trust' },
      claudiaSessionId: 'session-trust',
    });

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('/.codex/config.toml'),
      expect.stringContaining('[projects."/private/tmp/my-claudia-dev/codex-config"]'),
      'utf-8',
    );
  });

  it('starts a fresh thread when a known thread is resumed in a different cwd', async () => {
    const mod = await import('../codex-app-server');
    const startThread = vi
      .spyOn(mod.CodexAppServerClient.prototype, 'startThread')
      .mockResolvedValueOnce('thread-main')
      .mockResolvedValueOnce('thread-worktree');
    const resumeThread = vi
      .spyOn(mod.CodexAppServerClient.prototype, 'resumeThread')
      .mockResolvedValue(undefined);
    const runTurn = vi.spyOn(mod.CodexAppServerClient.prototype, 'runTurn').mockImplementation(async function* (threadId) {
      yield { type: 'result', sessionId: threadId, isComplete: true } as never;
    });

    const baseOptions = {
      cwd: '/tmp/project',
      env: { TEST_ENV: 'cwd-switch' },
      claudiaSessionId: 'session-cwd-switch',
    };

    await drain(mod.runCodexAppServer('first', baseOptions, vi.fn()));
    await drain(mod.runCodexAppServer('second', {
      ...baseOptions,
      cwd: '/tmp/project/.worktrees/fix',
      sessionId: 'thread-main',
    }, vi.fn()));

    expect(resumeThread).not.toHaveBeenCalled();
    expect(startThread).toHaveBeenNthCalledWith(1, '/tmp/project');
    expect(startThread).toHaveBeenNthCalledWith(2, '/tmp/project/.worktrees/fix');
    expect(runTurn).toHaveBeenLastCalledWith(
      'thread-worktree',
      expect.any(Array),
      expect.any(Function),
      expect.objectContaining({ cwd: '/tmp/project/.worktrees/fix' }),
    );
  });

  it('resumes a known thread when the cwd is unchanged after normalization', async () => {
    const mod = await import('../codex-app-server');
    const startThread = vi
      .spyOn(mod.CodexAppServerClient.prototype, 'startThread')
      .mockResolvedValue('thread-main');
    const resumeThread = vi
      .spyOn(mod.CodexAppServerClient.prototype, 'resumeThread')
      .mockResolvedValue(undefined);
    vi.spyOn(mod.CodexAppServerClient.prototype, 'runTurn').mockImplementation(async function* (threadId) {
      yield { type: 'result', sessionId: threadId, isComplete: true } as never;
    });

    const baseOptions = {
      cwd: '/tmp/project/',
      env: { TEST_ENV: 'cwd-same' },
      claudiaSessionId: 'session-cwd-same',
    };

    await drain(mod.runCodexAppServer('first', baseOptions, vi.fn()));
    await drain(mod.runCodexAppServer('second', {
      ...baseOptions,
      cwd: '/tmp/project',
      sessionId: 'thread-main',
    }, vi.fn()));

    expect(startThread).toHaveBeenCalledTimes(1);
    expect(resumeThread).toHaveBeenCalledWith('thread-main');
  });

  it('starts fresh for a managed worktree when thread cwd memory is unavailable', async () => {
    const mod = await import('../codex-app-server');
    const startThread = vi
      .spyOn(mod.CodexAppServerClient.prototype, 'startThread')
      .mockResolvedValue('thread-worktree');
    const resumeThread = vi
      .spyOn(mod.CodexAppServerClient.prototype, 'resumeThread')
      .mockResolvedValue(undefined);
    vi.spyOn(mod.CodexAppServerClient.prototype, 'runTurn').mockImplementation(async function* (threadId) {
      yield { type: 'result', sessionId: threadId, isComplete: true } as never;
    });

    await drain(mod.runCodexAppServer('input', {
      cwd: '/tmp/project/.worktrees/fix',
      sessionId: 'thread-from-db',
      env: { TEST_ENV: 'cwd-memory-missing' },
      claudiaSessionId: 'session-cwd-memory-missing',
    }, vi.fn()));

    expect(resumeThread).not.toHaveBeenCalled();
    expect(startThread).toHaveBeenCalledWith('/tmp/project/.worktrees/fix');
  });
});
