import { useCallback, useEffect, useRef } from 'react';
import { useRightSidebarStore, RIGHT_SIDEBAR_LIMITS } from '../stores/rightSidebarStore';
import {
  usePluginStore,
  selectPluginPanels,
  type UIExtension,
} from '../stores/pluginStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { PluginPanelRenderer } from './PluginPanelRenderer';

interface RightSidebarProps {
  projectId: string | undefined;
  projectRoot: string | undefined;
  workingDirectory?: string;
}

/** Renders a builtin panel's React component, forwarding common props */
function PanelContent({ panel, projectId, projectRoot, workingDirectory }: {
  panel: UIExtension;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}) {
  if (panel.iframeUrl) {
    return (
      <PluginPanelRenderer
        activePluginPanelId={panel.id}
        projectRoot={projectRoot}
        projectId={projectId}
      />
    );
  }
  if (!panel.component) return null;
  const Component = panel.component as React.ComponentType<Record<string, unknown>>;
  return <Component projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} panelId={panel.id} />;
}

function PanelActions({ panel, projectId }: { panel: UIExtension; projectId?: string }) {
  if (!panel.actions) return null;
  const Actions = panel.actions as React.ComponentType<Record<string, unknown>>;
  return <Actions projectId={projectId} />;
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
  const allPanels = usePluginStore(selectPluginPanels);
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const panelPlacements = usePluginStore((s) => s.panelPlacements);
  const setPanelPlacement = usePluginStore((s) => s.setPanelPlacement);
  const widthPx = useRightSidebarStore((s) => s.widthPx);
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const setActiveTab = useRightSidebarStore((s) => s.setActiveTab);
  const setWidth = useRightSidebarStore((s) => s.setWidth);
  const setBottomPanelTab = useBottomPanelStore((s) => s.setActiveTab);

  // Filter: desktop, enabled, placement === 'right'
  const rightPanels = allPanels.filter((p) => {
    if (!(p.platforms ?? ['desktop']).includes('desktop')) return false;
    if (disabledBuiltinPanels.includes(p.id)) return false;
    const placement = panelPlacements[p.id] ?? p.defaultPlacement ?? 'bottom';
    return placement === 'right';
  });

  // Visible vs mounted (alwaysMount stays in DOM even when hidden)
  const visiblePanels = rightPanels.filter((p) => p.visible !== false);
  const mountedPanels = rightPanels.filter((p) => p.alwaysMount || p.visible !== false);

  const isOpen = visiblePanels.length > 0;
  const hasAlwaysMount = mountedPanels.some((p) => p.alwaysMount);

  // Effective active tab — fallback to first visible if stored value isn't valid
  const effectiveTab = (() => {
    if (activeTab && visiblePanels.some((p) => p.id === activeTab)) return activeTab;
    if (visiblePanels.length > 0) return visiblePanels[0].id;
    return null;
  })();

  const activePanel = visiblePanels.find((p) => p.id === effectiveTab);
  const showTabs = visiblePanels.length > 1;

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
      style={{ width: isOpen ? `${clampedWidth}px` : '0px', overflow: 'hidden' }}
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
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
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
              className="p-1 rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
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
            className="p-1 rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Hide panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content — alwaysMount panels stay in DOM even when hidden */}
      <div className="flex-1 overflow-hidden relative">
        {mountedPanels.map((panel) => (
          <div key={panel.id} className={`absolute inset-0 ${effectiveTab === panel.id && isOpen ? '' : 'invisible'}`}>
            <PanelContent panel={panel} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
          </div>
        ))}
      </div>
    </div>
  );
}

