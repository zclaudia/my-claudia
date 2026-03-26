import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appendFileSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const existsSyncMock = vi.fn(() => false);
const unlinkSyncMock = vi.fn();
const loadMcpServersFromDbMock = vi.fn(() => ({}));
const buildMcpBridgeEntryMock = vi.fn(() => null);

vi.mock('fs', () => ({
  appendFileSync: appendFileSyncMock,
  writeFileSync: writeFileSyncMock,
  mkdirSync: mkdirSyncMock,
  existsSync: existsSyncMock,
  unlinkSync: unlinkSyncMock,
}));

vi.mock('../../utils/mcp-config.js', () => ({
  loadMcpServersFromDb: loadMcpServersFromDbMock,
}));

vi.mock('../../utils/mcp-bridge-launch.js', () => ({
  buildMcpBridgeEntry: buildMcpBridgeEntryMock,
}));

describe('codex-app-server', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
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
    expect(writeFileSyncMock).toHaveBeenCalledTimes(2);
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
});
