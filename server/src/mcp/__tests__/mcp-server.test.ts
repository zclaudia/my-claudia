import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const connectMock = vi.fn();
  const serverCloseMock = vi.fn();
  const handleRequestMock = vi.fn();
  const transportCloseMock = vi.fn();
  let sessionCounter = 0;

  class MockTransport {
    sessionId?: string;
    onclose?: () => void;

    constructor(private options: { sessionIdGenerator?: () => string }) {}

    async handleRequest(_req: unknown, _res: unknown, _body?: unknown): Promise<void> {
      if (!this.sessionId) {
        sessionCounter += 1;
        this.sessionId = this.options.sessionIdGenerator?.() ?? `session-${sessionCounter}`;
      }
      handleRequestMock(this.sessionId);
    }

    async close(): Promise<void> {
      transportCloseMock(this.sessionId);
      this.onclose?.();
    }
  }

  return {
    connectMock,
    serverCloseMock,
    handleRequestMock,
    transportCloseMock,
    MockTransport,
    resetSessionCounter: () => { sessionCounter = 0; },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class MockServer {
    private transport?: InstanceType<typeof mocks.MockTransport>;

    setRequestHandler(): void {}
    async connect(transport: InstanceType<typeof mocks.MockTransport>): Promise<void> {
      this.transport = transport;
      mocks.connectMock();
      if (!transport.sessionId) {
        transport.sessionId = 'session-1';
      }
    }
    async close(): Promise<void> {
      mocks.serverCloseMock();
      await this.transport?.close();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: mocks.MockTransport,
}));

vi.mock('../../domains/plugins/tool-registry.js', () => ({
  toolRegistry: {
    getBridgeTools: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
  },
}));

import {
  getMcpServerInfo,
  handleMcpRequest,
  handleMcpSessionClose,
} from '../mcp-server.js';

function createReq(headers: Record<string, string> = {}): any {
  return { headers };
}

function createRes(): any {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

describe('mcp-server', () => {
  beforeEach(async () => {
    const info = getMcpServerInfo();
    if ((info.activeSessions as number) > 0) {
      await handleMcpSessionClose(createReq({ 'mcp-session-id': 'session-1' }), createRes());
    }

    mocks.connectMock.mockClear();
    mocks.serverCloseMock.mockClear();
    mocks.handleRequestMock.mockClear();
    mocks.transportCloseMock.mockClear();
    mocks.resetSessionCounter();
  });

  it('reuses the existing server/transport for the same session', async () => {
    await handleMcpRequest(createReq(), createRes(), { jsonrpc: '2.0' });
    await handleMcpRequest(createReq({ 'mcp-session-id': 'session-1' }), createRes(), { jsonrpc: '2.0' });

    expect(mocks.connectMock).toHaveBeenCalledTimes(1);
    expect(mocks.handleRequestMock).toHaveBeenCalledTimes(2);
    expect(getMcpServerInfo().activeSessions).toBe(1);
  });

  it('closes both transport and server when session is deleted', async () => {
    await handleMcpRequest(createReq(), createRes(), { jsonrpc: '2.0' });
    await handleMcpSessionClose(createReq({ 'mcp-session-id': 'session-1' }), createRes());

    expect(mocks.transportCloseMock).toHaveBeenCalledWith('session-1');
    expect(mocks.serverCloseMock).toHaveBeenCalledTimes(1);
    expect(getMcpServerInfo().activeSessions).toBe(0);
  });
});
