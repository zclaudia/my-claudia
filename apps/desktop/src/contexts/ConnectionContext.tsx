import { createContext, useContext, useCallback, useEffect, type ReactNode } from 'react';
import { useMultiServerSocket } from '../hooks/useMultiServerSocket';
import { useEmbeddedServer, type EmbeddedServerStatus } from '../hooks/useEmbeddedServer';
import { usePermissionStore } from '../stores/permissionStore';
import { useAskUserQuestionStore } from '../stores/askUserQuestionStore';
import { useServerStore } from '../stores/serverStore';
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
  handleAskUserAnswer: (requestId: string, formattedAnswer: string) => void;

  // Embedded server debug info
  embeddedServerStatus: EmbeddedServerStatus;
  embeddedServerError: string | null;
  embeddedServerPort: number | null;
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children, standaloneServerUrl }: { children: ReactNode; standaloneServerUrl?: string }) {
  // On desktop, spawn an embedded server with a random port.
  // Skip when standaloneServerUrl is provided (standalone window connects to existing server).
  const embeddedServer = useEmbeddedServer({ disabled: !!standaloneServerUrl });

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

  const handleAskUserAnswer = useCallback((requestId: string, formattedAnswer: string) => {
    const request = useAskUserQuestionStore.getState().pendingRequests.find(r => r.requestId === requestId);
    const targetServerId = request?.serverId;

    const message = {
      type: 'ask_user_answer' as const,
      requestId,
      formattedAnswer,
    };

    if (targetServerId) {
      socket.sendToServer(targetServerId, message);
    } else {
      socket.sendMessage(message);
    }
    useAskUserQuestionStore.getState().clearRequestById(requestId);
  }, [socket]);

  const value: ConnectionContextValue = {
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
    handleAskUserAnswer,

    // Embedded server debug info
    embeddedServerStatus: embeddedServer.status,
    embeddedServerError: embeddedServer.error,
    embeddedServerPort: embeddedServer.port,
  };

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
