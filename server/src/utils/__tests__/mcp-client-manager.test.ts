import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const disconnectMock = vi.fn();
const callToolMock = vi.fn();
const listToolsMock = vi.fn();
const ctorMock = vi.fn();

vi.mock('../mcp-client.js', () => ({
  McpClient: class MockMcpClient {
    isConnected = true;

    constructor(...args: unknown[]) {
      ctorMock(...args);
    }

    connect = connectMock;
    disconnect = disconnectMock;
    callTool = callToolMock;
    listTools = listToolsMock;
  },
}));

describe('McpClientManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses cached client when config is unchanged', async () => {
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();
    const config = { command: 'node', args: ['srv.js'], env: { A: '1' } };

    const first = await manager.getClient('test', config);
    const second = await manager.getClient('test', config);

    expect(first).toBe(second);
    expect(ctorMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('recreates client when config changes for the same server name', async () => {
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();

    await manager.getClient('test', { command: 'node', args: ['srv.js'], env: { A: '1' } });
    await manager.getClient('test', { command: 'node', args: ['srv.js'], env: { A: '2' } });

    expect(ctorMock).toHaveBeenCalledTimes(2);
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
