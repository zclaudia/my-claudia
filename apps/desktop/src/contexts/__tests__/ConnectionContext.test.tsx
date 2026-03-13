import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConnectionProvider, useConnection, ConnectionContext } from '../ConnectionContext';

// Mock useEmbeddedServer
vi.mock('../../hooks/useEmbeddedServer', () => ({
  useEmbeddedServer: vi.fn(() => ({
    port: null,
    status: 'disabled' as const,
    error: null,
  })),
}));

// Mock useMultiServerSocket
const mockSocket = {
  sendMessage: vi.fn(),
  isConnected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  connectServer: vi.fn(),
  disconnectServer: vi.fn(),
  sendToServer: vi.fn(),
  isServerConnected: vi.fn(() => false),
  getConnectedServers: vi.fn(() => []),
};

vi.mock('../../hooks/useMultiServerSocket', () => ({
  useMultiServerSocket: () => mockSocket,
}));

// Mock stores
const mockPermissionStore = {
  pendingRequests: [] as any[],
  clearRequestById: vi.fn(),
};

vi.mock('../../stores/permissionStore', () => ({
  usePermissionStore: {
    getState: () => mockPermissionStore,
  },
}));

const mockAskUserStore = {
  pendingRequests: [] as any[],
  clearRequestById: vi.fn(),
};

vi.mock('../../stores/askUserQuestionStore', () => ({
  useAskUserQuestionStore: {
    getState: () => mockAskUserStore,
  },
}));

const mockServerStore = {
  activeServerId: null as string | null,
  servers: [],
  setLocalServerPort: vi.fn(),
  getActiveServerConnection: vi.fn(() => null),
  connections: {},
};

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: () => mockServerStore,
  },
}));

vi.mock('../../utils/crypto', () => ({
  encryptCredential: vi.fn(() => 'encrypted_value'),
  isEncryptionAvailable: vi.fn(() => false),
}));

describe('ConnectionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissionStore.pendingRequests = [];
    mockAskUserStore.pendingRequests = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('provides connection context to children', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });
    expect(result.current).toBeDefined();
    expect(result.current.sendMessage).toBeDefined();
    expect(result.current.isConnected).toBe(true);
  });

  it('throws when useConnection is used outside provider', () => {
    expect(() => {
      renderHook(() => useConnection());
    }).toThrow('useConnection must be used within a ConnectionProvider');
  });

  it('exposes embedded server state', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });
    expect(result.current.embeddedServerStatus).toBe('disabled');
    expect(result.current.embeddedServerError).toBeNull();
    expect(result.current.embeddedServerPort).toBeNull();
  });

  it('handlePermissionDecision sends message via socket', async () => {
    mockPermissionStore.pendingRequests = [
      { requestId: 'req-1', toolName: 'Bash', detail: '{}', serverId: undefined },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });

    await act(async () => {
      await result.current.handlePermissionDecision('req-1', true);
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permission_decision',
        requestId: 'req-1',
        allow: true,
      }),
    );
    expect(mockPermissionStore.clearRequestById).toHaveBeenCalledWith('req-1');
  });

  it('handlePermissionDecision routes to specific server', async () => {
    mockPermissionStore.pendingRequests = [
      { requestId: 'req-2', toolName: 'Bash', detail: '{}', serverId: 'server-1' },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });

    await act(async () => {
      await result.current.handlePermissionDecision('req-2', false);
    });

    expect(mockSocket.sendToServer).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        type: 'permission_decision',
        requestId: 'req-2',
        allow: false,
      }),
    );
  });

  it('handlePermissionDecision includes feedback when provided', async () => {
    mockPermissionStore.pendingRequests = [
      { requestId: 'req-3', toolName: 'Bash', detail: '{}' },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });

    await act(async () => {
      await result.current.handlePermissionDecision('req-3', false, false, undefined, 'Not needed');
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback: 'Not needed',
      }),
    );
  });

  it('handleAskUserAnswer sends answer via socket', () => {
    mockAskUserStore.pendingRequests = [
      { requestId: 'ask-1', question: 'what?', serverId: undefined },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });

    act(() => {
      result.current.handleAskUserAnswer('ask-1', 'My answer');
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledWith({
      type: 'ask_user_answer',
      requestId: 'ask-1',
      formattedAnswer: 'My answer',
    });
    expect(mockAskUserStore.clearRequestById).toHaveBeenCalledWith('ask-1');
  });

  it('handleAskUserAnswer routes to specific server', () => {
    mockAskUserStore.pendingRequests = [
      { requestId: 'ask-2', question: 'what?', serverId: 'server-1' },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });

    act(() => {
      result.current.handleAskUserAnswer('ask-2', 'Answer');
    });

    expect(mockSocket.sendToServer).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        type: 'ask_user_answer',
        requestId: 'ask-2',
      }),
    );
  });

  it('sets local server port when embedded server has a port', async () => {
    const { useEmbeddedServer } = await import('../../hooks/useEmbeddedServer');
    vi.mocked(useEmbeddedServer).mockReturnValue({
      port: 3456,
      status: 'running' as any,
      error: null,
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    renderHook(() => useConnection(), { wrapper });

    expect(mockServerStore.setLocalServerPort).toHaveBeenCalledWith(3456);

    // Reset to default
    vi.mocked(useEmbeddedServer).mockReturnValue({
      port: null,
      status: 'disabled' as any,
      error: null,
    });
  });

  it('parses standalone server URL and sets port', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider standaloneServerUrl="http://localhost:5678">{children}</ConnectionProvider>
    );

    renderHook(() => useConnection(), { wrapper });

    expect(mockServerStore.setLocalServerPort).toHaveBeenCalledWith(5678);
  });

  it('handles standalone URL without http prefix', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider standaloneServerUrl="localhost:4321">{children}</ConnectionProvider>
    );

    renderHook(() => useConnection(), { wrapper });

    expect(mockServerStore.setLocalServerPort).toHaveBeenCalledWith(4321);
  });

  it('encrypts credential when encryption is available', async () => {
    const { isEncryptionAvailable, encryptCredential } = await import('../../utils/crypto');
    vi.mocked(isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(encryptCredential).mockResolvedValue('encrypted_cred');

    mockServerStore.activeServerId = 'server-1';
    mockServerStore.connections = {
      'server-1': { publicKey: 'test-public-key' } as any,
    };

    mockPermissionStore.pendingRequests = [
      { requestId: 'req-cred', toolName: 'Bash', detail: '{}' },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });

    await act(async () => {
      await result.current.handlePermissionDecision('req-cred', true, false, 'mypassword');
    });

    expect(encryptCredential).toHaveBeenCalledWith('mypassword', 'test-public-key');
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedCredential: 'encrypted_cred',
      }),
    );

    // Reset
    vi.mocked(isEncryptionAvailable).mockReturnValue(false);
    mockServerStore.activeServerId = null;
    mockServerStore.connections = {};
  });

  it('handles encryption failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { isEncryptionAvailable, encryptCredential } = await import('../../utils/crypto');
    vi.mocked(isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(encryptCredential).mockRejectedValue(new Error('Encryption failed'));

    mockServerStore.activeServerId = 'server-1';
    mockServerStore.connections = {
      'server-1': { publicKey: 'test-key' } as any,
    };

    mockPermissionStore.pendingRequests = [
      { requestId: 'req-fail', toolName: 'Bash', detail: '{}' },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });

    await act(async () => {
      await result.current.handlePermissionDecision('req-fail', true, false, 'pass');
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to encrypt credential'),
      expect.any(Error),
    );
    // Should still send the message without encrypted credential
    expect(mockSocket.sendMessage).toHaveBeenCalled();

    consoleSpy.mockRestore();
    vi.mocked(isEncryptionAvailable).mockReturnValue(false);
    mockServerStore.activeServerId = null;
    mockServerStore.connections = {};
  });

  it('exposes multi-server operations', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConnectionProvider>{children}</ConnectionProvider>
    );

    const { result } = renderHook(() => useConnection(), { wrapper });
    expect(result.current.connectServer).toBeDefined();
    expect(result.current.disconnectServer).toBeDefined();
    expect(result.current.sendToServer).toBeDefined();
    expect(result.current.isServerConnected).toBeDefined();
    expect(result.current.getConnectedServers).toBeDefined();
  });
});
