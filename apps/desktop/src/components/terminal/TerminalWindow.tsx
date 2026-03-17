import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ConnectionProvider, useConnection } from '../../contexts/ConnectionContext';
import { WindowContextBar } from '../chat/SessionChatWindow';
import { XTerminal } from './XTerminal';

/** Notify main window when this terminal window closes */
function useWindowCloseSync(terminalId: string) {
  const { sendMessage } = useConnection();

  useEffect(() => {
    let dispose: (() => void) | undefined;
    (async () => {
      const { emitTo } = await import('@tauri-apps/api/event');
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const unlistenCloseRequested = await win.onCloseRequested(() => {
        sendMessage({ type: 'terminal_detach', terminalId });
        void emitTo('main', 'terminal-window-closed', { terminalId }).catch(() => {});
      });

      dispose = () => {
        unlistenCloseRequested();
      };
    })();

    return () => {
      dispose?.();
    };
  }, [sendMessage, terminalId]);
}

interface TerminalWindowProps {
  terminalId: string;
  projectId: string;
  serverUrl: string;
  authToken: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
}

/** Standalone terminal window rendered in a separate Tauri window */
export function TerminalWindow({
  terminalId,
  projectId,
  serverUrl,
  authToken: _authToken,
  serverId,
  serverName,
  gatewayUrl,
  gatewaySecret,
}: TerminalWindowProps) {
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      {serverName && (
        <WindowContextBar serverName={serverName} projectId={projectId} />
      )}
      <ConnectionProvider
        standaloneServerUrl={serverUrl}
        standaloneServerId={serverId}
        standaloneServerName={serverName}
        standaloneGatewayUrl={gatewayUrl}
        standaloneGatewaySecret={gatewaySecret}
      >
        <TerminalWindowContent terminalId={terminalId} projectId={projectId} />
      </ConnectionProvider>
    </div>
  );
}

function TerminalWindowContent({ terminalId, projectId }: { terminalId: string; projectId: string }) {
  useWindowCloseSync(terminalId);
  const { isConnected } = useConnection();

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Connecting...</span>
      </div>
    );
  }

  return (
    <>
      {/* Drag region header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0 bg-card"
        data-tauri-drag-region
      >
        <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="text-xs font-mono text-muted-foreground truncate" data-tauri-drag-region>
          Terminal
        </span>
      </div>

      {/* Terminal content - attach to existing PTY */}
      <div className="flex-1 overflow-hidden">
        <XTerminal
          key={terminalId}
          terminalId={terminalId}
          projectId={projectId}
          mode="attach"
        />
      </div>
    </>
  );
}
