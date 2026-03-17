import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const existsSyncMock = vi.fn<(path: string) => boolean>();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

describe('mcp-bridge-launch', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers compiled js bridge when available', async () => {
    existsSyncMock.mockImplementation((filePath) => filePath.endsWith('/plugins/mcp-bridge.js'));

    const { resolveMcpBridgeLaunchConfig } = await import('../mcp-bridge-launch.js');
    const result = resolveMcpBridgeLaunchConfig('file:///tmp/providers/kimi-sdk.js');

    expect(result.command).toBe(process.execPath);
    expect(result.args).toEqual(['/tmp/plugins/mcp-bridge.js']);
  });

  it('falls back to ts bridge with tsx loader in dev', async () => {
    existsSyncMock.mockImplementation((filePath) => filePath.endsWith('/plugins/mcp-bridge.ts'));

    const { resolveMcpBridgeLaunchConfig } = await import('../mcp-bridge-launch.js');
    const result = resolveMcpBridgeLaunchConfig('file:///tmp/providers/kimi-sdk.js');

    expect(result.command).toBe(process.execPath);
    expect(result.args).toEqual(['--import', 'tsx/esm', '/tmp/plugins/mcp-bridge.ts']);
  });
});
