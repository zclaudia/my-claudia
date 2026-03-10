import { useCallback, useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '../stores/terminalStore';
import { useFileViewerStore } from '../stores/fileViewerStore';
import { useServerStore } from '../stores/serverStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { TerminalPanel, TerminalActions } from './terminal/TerminalPanel';
import { FileViewerPanel, FileViewerActions } from './fileviewer/FileViewerPanel';
import { PluginPanelRenderer, usePluginPanelTabs } from './PluginPanelRenderer';

const MIN_HEIGHT = 100;
const MAX_HEIGHT_VH = 70;
const DEFAULT_HEIGHT_DESKTOP = 300;
const DEFAULT_HEIGHT_MOBILE = 350;

interface BottomPanelProps {
  projectId: string | undefined;
  projectRoot: string | undefined;
  workingDirectory?: string;
}

export function BottomPanel({ projectId, projectRoot, workingDirectory }: BottomPanelProps) {
  const terminalDrawerOpen = useTerminalStore((s) => projectId ? !!s.drawerOpen[projectId] : false);
  const hasTerminal = useTerminalStore((s) => projectId ? !!s.terminals[projectId] : false);
  const setTerminalDrawerOpen = useTerminalStore((s) => s.setDrawerOpen);
  const activeTab = useTerminalStore((s) => s.bottomPanelTab);
  const setActiveTab = useTerminalStore((s) => s.setBottomPanelTab);
  const fileViewerOpen = useFileViewerStore((s) => s.isOpen);
  const closeFileViewer = useFileViewerStore((s) => s.close);
  const supportsTerminal = useServerStore((s) => s.activeServerSupports('remoteTerminal'));
  const isMobile = useIsMobile();

  // Plugin panel tabs — disabled on mobile (mobile only supports pure backend plugins)
  const allPluginTabs = usePluginPanelTabs();
  const pluginTabs = isMobile ? [] : allPluginTabs;
  const hasPluginTabs = pluginTabs.length > 0;
  const activePluginPanelId = activeTab.startsWith('plugin:') ? activeTab.slice(7) : null;
  const hasActivePluginPanel = hasPluginTabs && activePluginPanelId !== null;

  // Determine which tabs are available and which is active
  const hasTerminalTab = supportsTerminal && projectId && (terminalDrawerOpen || hasTerminal);
  const hasFileTab = fileViewerOpen;
  const isOpen = !!(hasTerminalTab && terminalDrawerOpen) || !!hasFileTab || hasActivePluginPanel;

  // If current tab's panel isn't open, fall back to the other
  const effectiveTab = (() => {
    if (activeTab === 'terminal' && terminalDrawerOpen && hasTerminalTab) return 'terminal';
    if (activeTab === 'file' && hasFileTab) return 'file';
    if (activeTab.startsWith('plugin:') && hasPluginTabs) return activeTab;
    // Fallback: show whichever is open
    if (hasFileTab) return 'file';
    if (hasTerminalTab && terminalDrawerOpen) return 'terminal';
    if (hasPluginTabs) return pluginTabs[0].id;
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
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Clean up drag listeners if component unmounts mid-drag
  useEffect(() => {
    return () => { dragCleanupRef.current?.(); };
  }, []);

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

      const cleanup = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        dragCleanupRef.current = null;
      };

      const onUp = () => cleanup();
      dragCleanupRef.current = cleanup;

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onUp);
    },
    [heightPx],
  );

  const handleClose = () => {
    // Hide the entire bottom panel in one click
    if (projectId) setTerminalDrawerOpen(projectId, false);
    if (fileViewerOpen) closeFileViewer();
  };

  // Never return null — keep the terminal mounted to preserve its WebGL canvas.
  // When closed, render with height 0 so the terminal stays alive in the DOM.
  if (!isOpen && !hasTerminal) return null;

  // Show tabs when multiple panel types are available
  const totalTabs = (hasTerminalTab ? 1 : 0) + (hasFileTab ? 1 : 0) + pluginTabs.length;
  const showTabs = totalTabs > 1;

  // Get display label for single tab mode
  const getSingleTabLabel = () => {
    if (effectiveTab === 'terminal') return 'Terminal';
    if (effectiveTab === 'file') return 'File';
    const pluginTab = pluginTabs.find(t => t.id === effectiveTab);
    return pluginTab?.label || 'Panel';
  };

  if (isMobile && isOpen) {
    return (
      <div className="fixed inset-0 z-40 bg-background flex flex-col safe-top-pad safe-bottom-pad">
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {showTabs ? (
              <>
                {hasTerminalTab && (
                  <button
                    onClick={() => setActiveTab('terminal')}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      effectiveTab === 'terminal'
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Terminal
                  </button>
                )}
                {hasFileTab && (
                  <button
                    onClick={() => setActiveTab('file')}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      effectiveTab === 'file'
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    File
                  </button>
                )}
              </>
            ) : (
              <span className="text-sm font-medium text-foreground px-1">
                {getSingleTabLabel()}
              </span>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-0.5">
            {effectiveTab === 'terminal' && projectId && (
              <TerminalActions projectId={projectId} />
            )}
            {effectiveTab === 'file' && projectRoot && (
              <FileViewerActions />
            )}
            <button
              onClick={handleClose}
              className="p-1.5 rounded text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
              title="Close panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          {hasTerminalTab && projectId && (
            <div className={`absolute inset-0 ${effectiveTab === 'terminal' ? '' : 'invisible'}`}>
              <TerminalPanel projectId={projectId} workingDirectory={workingDirectory} />
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

  return (
    <div
      ref={containerRef}
      className={`flex flex-col flex-shrink-0 bg-card ${isOpen ? 'border-t border-border' : ''}`}
      style={{ height: isOpen ? `${heightPx}px` : '0px', overflow: 'hidden' }}
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
              {hasTerminalTab && (
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
              )}
              {hasFileTab && (
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
              )}
              {pluginTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    effectiveTab === tab.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </>
          ) : (
            <span className="text-xs font-medium text-muted-foreground px-1">
              {getSingleTabLabel()}
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
            <FileViewerActions />
          )}

          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1 rounded text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
            title="Hide panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel content — all mounted but only active one visible, to preserve terminal state */}
      <div className="flex-1 overflow-hidden relative">
        {hasTerminalTab && projectId && (
          <div className={`absolute inset-0 ${effectiveTab === 'terminal' && isOpen ? '' : 'invisible'}`}>
            <TerminalPanel projectId={projectId} workingDirectory={workingDirectory} />
          </div>
        )}
        {hasFileTab && projectRoot && (
          <div className={`absolute inset-0 ${effectiveTab === 'file' && isOpen ? '' : 'invisible'}`}>
            <FileViewerPanel projectRoot={projectRoot} />
          </div>
        )}
        {hasPluginTabs && pluginTabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${effectiveTab === tab.id && isOpen ? '' : 'invisible'}`}
          >
            <PluginPanelRenderer
              activePluginPanelId={tab.id.slice(7)} // Remove 'plugin:' prefix
              projectRoot={projectRoot}
              projectId={projectId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
