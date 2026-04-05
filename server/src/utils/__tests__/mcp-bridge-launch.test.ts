import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const existsSyncMock = vi.fn<(path: string) => boolean>();
const getBridgeToolsMock = vi.fn(() => [{ id: 'push_file' }]);

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

vi.mock('../../domains/plugins/tool-registry.js', () => ({
  toolRegistry: {
    getBridgeTools: getBridgeToolsMock,
  },
}));

describe('mcp-bridge-launch', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    getBridgeToolsMock.mockReset();
    getBridgeToolsMock.mockReturnValue([{ id: 'push_file' }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers compiled js bridge when available', async () => {
    existsSyncMock.mockImplementation((filePath) => filePath.endsWith('/domains/plugins/mcp-bridge.js'));

    const { resolveMcpBridgeLaunchConfig } = await import('../mcp-bridge-launch.js');
    const result = resolveMcpBridgeLaunchConfig('file:///tmp/providers/kimi-sdk.js');

    expect(result.command).toBe(process.execPath);
    expect(result.args).toEqual(['/dist/domains/plugins/mcp-bridge.js']);
  });

  it('prefers server/dist js bridge over source ts bridge in dev', async () => {
    existsSyncMock.mockImplementation((filePath) =>
      filePath === '/repo/server/dist/domains/plugins/mcp-bridge.js'
      || filePath === '/repo/server/src/domains/plugins/mcp-bridge.ts'
    );

    const { resolveMcpBridgeLaunchConfig } = await import('../mcp-bridge-launch.js');
    const result = resolveMcpBridgeLaunchConfig('file:///repo/server/src/utils/mcp-bridge-launch.ts');

    expect(result.command).toBe(process.execPath);
    expect(result.args).toEqual(['/repo/server/dist/domains/plugins/mcp-bridge.js']);
  });

  it('falls back to ts bridge with tsx loader in dev', async () => {
    existsSyncMock.mockImplementation((filePath) => filePath.endsWith('/domains/plugins/mcp-bridge.ts'));

    const { resolveMcpBridgeLaunchConfig } = await import('../mcp-bridge-launch.js');
    const result = resolveMcpBridgeLaunchConfig('file:///tmp/providers/kimi-sdk.js');

    expect(result.command).toBe(process.execPath);
    expect(result.args).toEqual(['--import', 'tsx/esm', '/tmp/domains/plugins/mcp-bridge.ts']);
  });

  it('does not force an empty CLAUDIA_SESSION_ID when no static session is provided', async () => {
    const { buildMcpBridgeEntry } = await import('../mcp-bridge-launch.js');
    const entry = buildMcpBridgeEntry(3100);

    expect(entry).toBeTruthy();
    expect(entry?.env.CLAUDIA_BRIDGE_URL).toBe('http://127.0.0.1:3100');
    expect(entry?.env).not.toHaveProperty('CLAUDIA_SESSION_ID');
  });

  it('keeps explicit session IDs when provided', async () => {
    const { buildMcpBridgeEntry } = await import('../mcp-bridge-launch.js');
    const entry = buildMcpBridgeEntry(3100, 'session-123');

    expect(entry?.env.CLAUDIA_SESSION_ID).toBe('session-123');
  });
});
