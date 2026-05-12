import { useCallback, useEffect, useRef } from 'react';
import { useRightSidebarStore, RIGHT_SIDEBAR_LIMITS } from '../stores/rightSidebarStore';
import { usePluginStore } from '../stores/pluginStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { PanelActions, PanelContent } from './panels/PanelRenderer';
import { usePanelRegion } from './panels/usePanelRegion';

interface RightSidebarProps {
  projectId: string | undefined;
  projectRoot: string | undefined;
  workingDirectory?: string;
}

/**
 * Right sidebar — sibling of BottomPanel for desktop.
 * Renders panels whose effective placement is 'right'.
 * Hidden on mobile (mobile uses BottomPanel overlay regardless of placement).
 *
 * Layout state (width, activeTab) is global and persisted in rightSidebarStore.
 * Panel visibility is per-session via pluginStore.panels[*].visible —
 * sidebar collapses when no right-placed panel is visible in the current session.
 */
export function RightSidebar({ projectId, projectRoot, workingDirectory }: RightSidebarProps) {
  const isMobile = useIsMobile();
  const setPanelPlacement = usePluginStore((s) => s.setPanelPlacement);
  const widthPx = useRightSidebarStore((s) => s.widthPx);
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const setActiveTab = useRightSidebarStore((s) => s.setActiveTab);
  const setWidth = useRightSidebarStore((s) => s.setWidth);
  const setBottomPanelTab = useBottomPanelStore((s) => s.setActiveTab);
  const {
    visiblePanels,
    mountedPanels,
    isOpen,
    hasAlwaysMount,
    effectiveTab,
    activePanel,
    showTabs,
  } = usePanelRegion({
    region: 'right',
    activeTab,
    isMobile,
  });

  // Width drag state
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { dragCleanupRef.current?.(); };
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
      startWidth.current = widthPx;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!dragging.current) return;
        const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
        // Drag handle is on left edge — moving left increases width
        const deltaPx = startX.current - clientX;
        setWidth(startWidth.current + deltaPx);
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
    [widthPx, setWidth],
  );

  const handleClose = () => {
    const { updatePanelVisibility } = usePluginStore.getState();
    visiblePanels.forEach((p) => {
      if (p.onClose) {
        p.onClose();
      } else {
        updatePanelVisibility(p.id, false);
      }
    });
  };

  const handleMoveToBottom = () => {
    if (!activePanel) return;
    setPanelPlacement(activePanel.id, 'bottom');
    // Make the panel visible on the bottom side too — preserve continuity
    setBottomPanelTab(activePanel.id);
  };

  if (isMobile) return null;
  if (!isOpen && !hasAlwaysMount) return null;

  const clampedWidth = Math.max(
    RIGHT_SIDEBAR_LIMITS.MIN_WIDTH_PX,
    Math.min(window.innerWidth * (RIGHT_SIDEBAR_LIMITS.MAX_WIDTH_VW / 100), widthPx),
  );

  return (
    <div
      className={`flex flex-col flex-shrink-0 bg-card ${isOpen ? 'border-l border-border' : ''} relative`}
      style={{
        width: isOpen ? `${clampedWidth}px` : '0px',
        overflow: 'hidden',
        contain: 'layout paint style',
      }}
    >
      {/* Drag handle on left edge */}
      {isOpen && (
        <div
          className="absolute top-0 left-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 z-10"
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
        />
      )}

      {/* Header: tabs + actions */}
      <div className="flex items-center gap-1 px-2 py-1 select-none border-b border-border flex-shrink-0">
        <div className="flex items-center gap-0.5 flex-shrink-0 min-w-0 overflow-hidden">
          {showTabs ? (
            <>
              {visiblePanels.map((panel) => (
                <button
                  key={panel.id}
                  onClick={() => setActiveTab(panel.id)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                    effectiveTab === panel.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {panel.label}
                </button>
              ))}
            </>
          ) : (
            <span className="text-xs font-medium text-muted-foreground px-1 truncate">
              {activePanel?.label || 'Panel'}
            </span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {activePanel && <PanelActions panel={activePanel} projectId={projectId} />}

          {/* Move to bottom */}
          {activePanel && (
            <button
              onClick={handleMoveToBottom}
              className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Move to bottom panel"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 4v16m0 0l-4-4m4 4l4-4M4 20h16" />
              </svg>
            </button>
          )}

          <button
            onClick={handleClose}
            className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Hide panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content — alwaysMount panels stay in DOM even when hidden */}
      <div className="flex-1 overflow-hidden relative [contain:layout_paint]">
        {mountedPanels.map((panel) => (
          <div key={panel.id} className={`absolute inset-0 ${effectiveTab === panel.id && isOpen ? '' : 'invisible'}`}>
            <PanelContent panel={panel} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
          </div>
        ))}
      </div>
    </div>
  );
}
