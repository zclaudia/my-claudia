import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useMultiServerSocket } from '../hooks/useMultiServerSocket';
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
  handlePermissionDecision: (requestId: string, allow: boolean, remember?: boolean, credential?: string) => Promise<void>;
  handleAskUserAnswer: (requestId: string, formattedAnswer: string) => void;
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  // Use the multi-server socket hook that manages multiple connections
  const socket = useMultiServerSocket();

  const handlePermissionDecision = useCallback(async (
    requestId: string,
    allow: boolean,
    remember?: boolean,
    credential?: string,
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
