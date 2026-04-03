import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@tauri-apps/api/core')>();
  return {
    ...mod,
    invoke: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn(() => Promise.resolve(vi.fn())),
  })),
}));

vi.mock('../../../contexts/ConnectionContext', () => ({
  ConnectionProvider: ({
    children,
    standaloneServerUrl,
    standaloneServerId,
    standaloneGatewayUrl,
    standaloneGatewaySecret,
  }: any) => (
    <div
      data-testid="connection-provider"
      data-server-url={standaloneServerUrl}
      data-server-id={standaloneServerId}
      data-gateway-url={standaloneGatewayUrl}
      data-gateway-secret={standaloneGatewaySecret}
    >
      {children}
    </div>
  ),
  useConnection: () => ({
    isConnected: mockIsConnected,
    sendMessage: vi.fn(),
  }),
}));

vi.mock('../../chat/SessionChatWindow', () => ({
  WindowContextBar: ({ serverName, projectId }: any) => (
    <div data-testid="window-context">{serverName}:{projectId}</div>
  ),
}));

vi.mock('../XTerminal', () => ({
  XTerminal: ({ terminalId, projectId, mode }: any) => (
    <div data-testid="xterminal">{terminalId}:{projectId}:{mode}</div>
  ),
}));

let mockIsConnected = true;

import { TerminalWindow } from '../TerminalWindow';

describe('TerminalWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = true;
  });

  it('passes standalone remote context into ConnectionProvider', () => {
    render(
      <TerminalWindow
        terminalId="term-1"
        projectId="proj-1"
        serverUrl="http://127.0.0.1:43123/api/gateway-proxy/backend-1"
        authToken="token"
        serverId="gw:backend-1"
        serverName="Remote Backend"
        gatewayUrl="wss://gateway.example.com"
        gatewaySecret="secret-1"
      />
    );

    const provider = screen.getByTestId('connection-provider');
    expect(provider.getAttribute('data-server-id')).toBe('gw:backend-1');
    expect(provider.getAttribute('data-gateway-url')).toBe('wss://gateway.example.com');
    expect(provider.getAttribute('data-gateway-secret')).toBe('secret-1');
  });

  it('shows connecting state until the standalone connection is ready', () => {
    mockIsConnected = false;

    render(
      <TerminalWindow
        terminalId="term-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken=""
      />
    );

    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });
});
