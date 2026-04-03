import { createContext, useContext, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useMultiServerSocket } from '../hooks/useMultiServerSocket';
import { useEmbeddedServer, type EmbeddedServerStatus } from '../hooks/useEmbeddedServer';
import { useWslServer, type WslServerState } from '../hooks/useWslServer';
import { useBackendFacade } from '../hooks/useBackendFacade';
import { usePermissionStore } from '../stores/permissionStore';
import { usePromptRequestStore } from '../stores/promptRequestStore';
import { useServerStore } from '../stores/serverStore';
import { useGatewayStore } from '../stores/gatewayStore';
import { encryptCredential, isEncryptionAvailable } from '../utils/crypto';
import type { ClientMessage } from '@my-claudia/shared';

interface ConnectionContextValue {
  // Active server operations (backward compatible)
  sendMessage: (message: ClientMessage) => void;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;

  // Multi-server operations
  connectServer: (serverId: string) => void;
  disconnectServer: (serverId: string) => void;
  sendToServer: (serverId: string, message: ClientMessage) => void;
  isServerConnected: (serverId: string) => boolean;
  getConnectedServers: () => string[];

  // Permission decision handlers (shared across all components)
  handlePermissionDecision: (requestId: string, allow: boolean, remember?: boolean, credential?: string, feedback?: string) => Promise<void>;
  handlePromptAnswer: (requestId: string, formattedAnswer: string) => void;

  // Embedded server debug info
  embeddedServerStatus: EmbeddedServerStatus;
  embeddedServerError: string | null;
  embeddedServerPort: number | null;
  restartEmbeddedServer: () => Promise<void>;

  // WSL server (Windows only) — lives here so it survives WindowsSetup unmount
  wslServer: WslServerState & { start: () => void };
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null);

interface ConnectionProviderProps {
  children: ReactNode;
  standaloneServerUrl?: string;
  standaloneServerId?: string;
  standaloneServerName?: string;
  standaloneGatewayUrl?: string;
  standaloneGatewaySecret?: string;
}

export function ConnectionProvider({
  children,
  standaloneServerUrl,
  standaloneServerId,
  standaloneServerName: _standaloneServerName,
  standaloneGatewayUrl,
  standaloneGatewaySecret,
}: ConnectionProviderProps) {
  // On desktop, spawn an embedded server with a random port.
  // Skip when standaloneServerUrl is provided (standalone window connects to existing server).
  const embeddedServer = useEmbeddedServer({ disabled: !!standaloneServerUrl });

  // WSL server hook — must live at this level (not in WindowsSetup) so the
  // spawned wsl.exe process and its event listeners survive component unmounts.
  const wslServer = useWslServer();

  // Initialize BackendFacade — syncs facade state to gatewayStore for backward compat
  useBackendFacade();

  // Update the local server address when the embedded server is ready
  useEffect(() => {
    if (embeddedServer.port) {
      useServerStore.getState().setLocalServerPort(embeddedServer.port);
    }
  }, [embeddedServer.port]);

  // For standalone windows, pre-configure the server port from the provided URL
  useEffect(() => {
    if (!standaloneServerUrl) return;
    try {
      const raw = standaloneServerUrl.startsWith('http') ? standaloneServerUrl : `http://${standaloneServerUrl}`;
      const url = new URL(raw);
      const port = parseInt(url.port);
      if (port) useServerStore.getState().setLocalServerPort(port);
    } catch { /* ignore malformed URL */ }
  }, [standaloneServerUrl]);

  // Set the active server for standalone windows.
  useEffect(() => {
    if (!standaloneServerId) return;
    useServerStore.getState().setActiveServer(standaloneServerId);
  }, [standaloneServerId]);

  // Seed gateway runtime config for standalone windows so remote pop-outs can
  // connect immediately without waiting for local polling state to hydrate.
  useEffect(() => {
    if (!standaloneGatewayUrl || !standaloneGatewaySecret) return;
    useGatewayStore.setState({
      gatewayUrl: standaloneGatewayUrl,
      gatewaySecret: standaloneGatewaySecret,
    });
  }, [standaloneGatewayUrl, standaloneGatewaySecret]);

  // Use the multi-server socket hook that manages multiple connections
  const socket = useMultiServerSocket();

  const handlePermissionDecision = useCallback(async (
    requestId: string,
    allow: boolean,
    remember?: boolean,
    credential?: string,
    feedback?: string,
  ) => {
    // Find the request to get serverId for routing
    const request = usePermissionStore.getState().pendingRequests.find(r => r.requestId === requestId);
    const targetServerId = request?.serverId;

    let encryptedCredentialValue: string | undefined;

    // Encrypt credential if provided
    if (credential && allow) {
      const { activeServerId, getActiveServerConnection, connections } = useServerStore.getState();
      const connServerId = targetServerId || activeServerId;
      const conn = connServerId ? connections[connServerId] : getActiveServerConnection();
      if (conn?.publicKey && isEncryptionAvailable(conn.publicKey)) {
        try {
          encryptedCredentialValue = await encryptCredential(credential, conn.publicKey);
        } catch (err) {
          console.error('[ConnectionContext] Failed to encrypt credential:', err);
        }
      }
    }

    const message = {
      type: 'permission_decision' as const,
      requestId,
      allow,
      remember,
      ...(feedback && { feedback }),
      ...(encryptedCredentialValue && { encryptedCredential: encryptedCredentialValue }),
    };

    if (targetServerId) {
      socket.sendToServer(targetServerId, message);
    } else {
      socket.sendMessage(message);
    }
    usePermissionStore.getState().clearRequestById(requestId);
  }, [socket]);

  const handlePromptAnswer = useCallback((requestId: string, formattedAnswer: string) => {
    const request = usePromptRequestStore.getState().pendingRequests.find(r => r.requestId === requestId);
    const targetServerId = request?.serverId;

    const message = {
      type: 'prompt_answer' as const,
      requestId,
      formattedAnswer,
    };

    if (targetServerId) {
      socket.sendToServer(targetServerId, message);
    } else {
      socket.sendMessage(message);
    }
    usePromptRequestStore.getState().clearRequestById(requestId);
  }, [socket]);

  const value: ConnectionContextValue = useMemo(() => ({
    // Active server operations
    sendMessage: socket.sendMessage,
    isConnected: socket.isConnected,
    connect: socket.connect,
    disconnect: socket.disconnect,

    // Multi-server operations
    connectServer: socket.connectServer,
    disconnectServer: socket.disconnectServer,
    sendToServer: socket.sendToServer,
    isServerConnected: socket.isServerConnected,
    getConnectedServers: socket.getConnectedServers,

    // Permission handlers
    handlePermissionDecision,
    handlePromptAnswer,

    // Embedded server debug info
    embeddedServerStatus: embeddedServer.status,
    embeddedServerError: embeddedServer.error,
    embeddedServerPort: embeddedServer.port,
    restartEmbeddedServer: embeddedServer.restart,

    // WSL server
    wslServer,
  }), [
    socket, handlePermissionDecision, handlePromptAnswer,
    embeddedServer.status, embeddedServer.error, embeddedServer.port, embeddedServer.restart,
    wslServer,
  ]);

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
}
