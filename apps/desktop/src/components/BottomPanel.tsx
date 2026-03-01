import { useState, useCallback, useRef } from 'react';
import { useTerminalStore } from '../stores/terminalStore';
import { useFileViewerStore } from '../stores/fileViewerStore';
import { useServerStore } from '../stores/serverStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { TerminalPanel, TerminalActions } from './terminal/TerminalPanel';
import { FileViewerPanel, FileViewerActions } from './fileviewer/FileViewerPanel';

const MIN_HEIGHT = 100;
const MAX_HEIGHT_VH = 70;
const DEFAULT_HEIGHT_DESKTOP = 300;
const DEFAULT_HEIGHT_MOBILE = 350;

type PanelTab = 'terminal' | 'file';

interface BottomPanelProps {
  projectId: string | undefined;
  projectRoot: string | undefined;
}

export function BottomPanel({ projectId, projectRoot }: BottomPanelProps) {
  const terminalDrawerOpen = useTerminalStore((s) => projectId ? !!s.drawerOpen[projectId] : false);
  const hasTerminal = useTerminalStore((s) => projectId ? !!s.terminals[projectId] : false);
  const setTerminalDrawerOpen = useTerminalStore((s) => s.setDrawerOpen);
  const fileViewerOpen = useFileViewerStore((s) => s.isOpen);
  const closeFileViewer = useFileViewerStore((s) => s.close);
  const supportsTerminal = useServerStore((s) => s.activeServerSupports('remoteTerminal'));

  const isMobile = useIsMobile();

  // Determine which tabs are available and which is active
  const hasTerminalTab = supportsTerminal && projectId && (terminalDrawerOpen || hasTerminal);
  const hasFileTab = fileViewerOpen;
  const isOpen = !!(hasTerminalTab && terminalDrawerOpen) || !!hasFileTab;

  // Active tab state — auto-switch when a panel opens
  const [activeTab, setActiveTab] = useState<PanelTab>('terminal');

  // If current tab's panel isn't open, switch to the other
  const effectiveTab = (() => {
    if (activeTab === 'terminal' && terminalDrawerOpen && hasTerminalTab) return 'terminal';
    if (activeTab === 'file' && hasFileTab) return 'file';
    // Fallback: show whichever is open
    if (hasFileTab) return 'file';
    if (hasTerminalTab && terminalDrawerOpen) return 'terminal';
    return activeTab;
  })();

  // Height / drag state
  const containerRef = useRef<HTMLDivElement>(null);
  const [heightPx, setHeightPx] = useState(
    isMobile ? DEFAULT_HEIGHT_MOBILE : DEFAULT_HEIGHT_DESKTOP,
  );
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Android back to close
  useAndroidBack(() => {
    if (effectiveTab === 'terminal' && projectId) setTerminalDrawerOpen(projectId, false);
    else if (effectiveTab === 'file') closeFileViewer();
  }, isOpen, 15);

  const onDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
      startHeight.current = heightPx;

      const maxPx = (window.innerHeight * MAX_HEIGHT_VH) / 100;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!dragging.current) return;
        const clientY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
        const deltaPx = startY.current - clientY;
        const newHeight = Math.max(MIN_HEIGHT, Math.min(maxPx, startHeight.current + deltaPx));
        setHeightPx(newHeight);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onUp);
    },
    [heightPx],
  );

  const handleClose = () => {
    if (effectiveTab === 'terminal' && projectId) setTerminalDrawerOpen(projectId, false);
    else if (effectiveTab === 'file') closeFileViewer();
  };

  if (!isOpen) return null;

  // Show tabs only when both panels could be open
  const showTabs = hasTerminalTab && hasFileTab;

  return (
    <div
      ref={containerRef}
      className="flex flex-col flex-shrink-0 bg-card border-t border-border"
      style={{ height: `${heightPx}px`, overflow: 'hidden' }}
    >
      {/* Drag handle + tabs + actions */}
      <div
        className="flex items-center gap-1 px-2 py-1 cursor-ns-resize select-none border-b border-border flex-shrink-0"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
      >
        {/* Drag indicator */}
        <div className="w-8 h-1 rounded-full bg-muted-foreground/40 mx-auto absolute left-1/2 -translate-x-1/2" />

        {/* Tabs */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
          {showTabs ? (
            <>
              <button
                onClick={() => setActiveTab('terminal')}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  effectiveTab === 'terminal'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Terminal
              </button>
              <button
                onClick={() => setActiveTab('file')}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  effectiveTab === 'file'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                File
              </button>
            </>
          ) : (
            <span className="text-xs font-medium text-muted-foreground px-1">
              {effectiveTab === 'terminal' ? 'Terminal' : 'File'}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Tab-specific actions */}
        <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
          {effectiveTab === 'terminal' && projectId && (
            <TerminalActions projectId={projectId} />
          )}
          {effectiveTab === 'file' && projectRoot && (
            <FileViewerActions projectRoot={projectRoot} />
          )}

          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1 rounded text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
            title="Close panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel content — both mounted but only active one visible, to preserve terminal state */}
      <div className="flex-1 overflow-hidden relative">
        {hasTerminalTab && projectId && (
          <div className={`absolute inset-0 ${effectiveTab === 'terminal' ? '' : 'invisible'}`}>
            <TerminalPanel projectId={projectId} />
          </div>
        )}
        {hasFileTab && projectRoot && (
          <div className={`absolute inset-0 ${effectiveTab === 'file' ? '' : 'invisible'}`}>
            <FileViewerPanel projectRoot={projectRoot} />
          </div>
        )}
      </div>
    </div>
  );
}
