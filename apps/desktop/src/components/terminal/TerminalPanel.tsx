import { useCallback } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useConnection } from '../../contexts/ConnectionContext';
import { XTerminal } from './XTerminal';
import { xtermRegistry } from '../../utils/xtermRegistry';
import { isDesktopTauri } from '../../utils/platform';
import { openPopoutWindow, buildWindowTitle, getConnectionParams } from '../../utils/popoutWindow';

/** Quick-send keys for mobile toolbar */
const QUICK_KEYS: { label: string; data: string }[] = [
  { label: 'TAB', data: '\t' },
  { label: 'ESC', data: '\x1b' },
  { label: '\u2191', data: '\x1b[A' },   // Up arrow
  { label: '\u2193', data: '\x1b[B' },   // Down arrow
];

interface TerminalPanelProps {
  projectId: string;
  workingDirectory?: string;
}

async function openTerminalInNewWindow(terminalId: string, projectId: string) {
  const conn = getConnectionParams();
  const label = await openPopoutWindow({
    type: 'terminal',
    params: { terminalWindow: terminalId, projectId },
    title: buildWindowTitle('Terminal', conn.serverName, projectId),
    width: 800,
    height: 500,
  });

  // Track popped-out state and hide panel in main window
  useTerminalStore.getState().addPoppedOutTerminal(terminalId, label);
  usePluginStore.getState().updatePanelVisibility('terminal', false);
}

/** Terminal toolbar actions (reload + pop-out buttons) rendered in the shared BottomPanel header */
export function TerminalActions({ projectId }: { projectId: string }) {
  const terminalId = useTerminalStore((s) => s.terminals[projectId]);
  const isPoppedOut = useTerminalStore((s) => terminalId ? !!s.poppedOutTerminals[terminalId] : false);
  const { sendMessage } = useConnection();

  return (
    <div className="flex items-center gap-0.5">
      {/* Pop-out button (desktop only) */}
      {isDesktopTauri() && terminalId && !isPoppedOut && (
        <button
          onClick={() => openTerminalInNewWindow(terminalId, projectId)}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Open in new window"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      )}

      {/* Reload button */}
      <button
        onClick={() => {
          if (!terminalId) return;
          sendMessage({ type: 'terminal_close', terminalId });
          xtermRegistry.delete(terminalId);
          useTerminalStore.getState().closeTerminal(terminalId);
          useTerminalStore.getState().openTerminal(projectId);
        }}
        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
        title="Reload terminal"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0 1 15.36-5.36L20 4M20 15a9 9 0 0 1-15.36 5.36L4 20" />
        </svg>
      </button>
    </div>
  );
}

/** Terminal content (renders inside the shared BottomPanel) */
export function TerminalPanel({ projectId, workingDirectory }: TerminalPanelProps) {
  const { terminals, ctrlActive, toggleCtrl } = useTerminalStore();
  const isMobile = useIsMobile();
  const terminalId = terminals[projectId];
  const shouldReattach = useTerminalStore((s) => terminalId ? s.shouldReattach(terminalId) : false);
  const isCtrl = !!(terminalId && ctrlActive[terminalId]);
  const { sendMessage } = useConnection();

  const sendKey = useCallback(
    (data: string) => {
      if (!terminalId) return;
      sendMessage({ type: 'terminal_input', terminalId, data });
    },
    [terminalId, sendMessage],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mobile shell helper buttons */}
      {isMobile && terminalId && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border flex-shrink-0 overflow-x-auto">
          <button
            onClick={() => toggleCtrl(terminalId)}
            className={`px-2 py-0.5 rounded text-[11px] font-mono whitespace-nowrap flex-shrink-0 ${
              isCtrl
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            CTRL
          </button>
          {QUICK_KEYS.map((key) => (
            <button
              key={key.label}
              onClick={() => sendKey(key.data)}
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground whitespace-nowrap flex-shrink-0"
            >
              {key.label}
            </button>
          ))}
        </div>
      )}

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden">
        {terminalId ? (
          <XTerminal
            key={terminalId}
            terminalId={terminalId}
            projectId={projectId}
            workingDirectory={workingDirectory}
            mode={shouldReattach ? 'attach' : 'open'}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No terminal session
          </div>
        )}
      </div>
    </div>
  );
}
