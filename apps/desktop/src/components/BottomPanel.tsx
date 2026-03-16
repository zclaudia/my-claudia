import { useCallback, useEffect, useRef, useState } from 'react';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { usePluginStore, selectPluginPanels, type UIExtension } from '../stores/pluginStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { PluginPanelRenderer } from './PluginPanelRenderer';

const MIN_HEIGHT = 100;
const MAX_HEIGHT_VH = 70;
const DEFAULT_HEIGHT_DESKTOP = 300;
const DEFAULT_HEIGHT_MOBILE = 350;

interface BottomPanelProps {
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

/** Renders a panel's action buttons */
function PanelActions({ panel, projectId }: { panel: UIExtension; projectId?: string }) {
  if (!panel.actions) return null;
  const Actions = panel.actions as React.ComponentType<Record<string, unknown>>;
  return <Actions projectId={projectId} />;
}

export function BottomPanel({ projectId, projectRoot, workingDirectory }: BottomPanelProps) {
  const isMobile = useIsMobile();
  const platform = isMobile ? 'mobile' : 'desktop';
  const allPanels = usePluginStore(selectPluginPanels);
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const activeTab = useBottomPanelStore((s) => s.activeTab);
  const setActiveTab = useBottomPanelStore((s) => s.setActiveTab);

  // Filter panels by current platform, excluding disabled built-in panels
  const platformPanels = allPanels.filter((p) =>
    (p.platforms ?? ['desktop']).includes(platform) &&
    !disabledBuiltinPanels.includes(p.id)
  );

  // Panels whose tab should appear
  const visiblePanels = platformPanels.filter((p) => p.visible !== false);

  // Panels that should be in the DOM (visible ones + alwaysMount ones even if hidden)
  const mountedPanels = platformPanels.filter((p) => p.alwaysMount || p.visible !== false);

  const isOpen = visiblePanels.length > 0;

  // Pick effective tab: validate activeTab against visible panels, with fallback
  const effectiveTab = (() => {
    if (visiblePanels.some((p) => p.id === activeTab)) return activeTab;
    // Fallback to first visible panel
    if (visiblePanels.length > 0) return visiblePanels[0].id;
    return activeTab;
  })();

  const activePanel = visiblePanels.find((p) => p.id === effectiveTab);
  const showTabs = visiblePanels.length > 1;

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

  // Android back to close current panel
  useAndroidBack(() => {
    activePanel?.onClose?.();
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
    const { updatePanelVisibility } = usePluginStore.getState();
    // Close all visible panels
    visiblePanels.forEach((p) => {
      if (p.onClose) {
        p.onClose();
      } else {
        // Generic fallback: hide the panel
        updatePanelVisibility(p.id, false);
      }
    });
  };

  // Keep mounted if any alwaysMount panel exists (e.g. terminal preserving xterm state)
  const hasAlwaysMount = mountedPanels.some((p) => p.alwaysMount);
  if (!isOpen && !hasAlwaysMount) return null;

  // ── Mobile: full-screen overlay ────────────────────────────────────────────
  if (isMobile && isOpen) {
    return (
      <div className="fixed inset-0 z-40 bg-background flex flex-col safe-top-pad safe-bottom-pad">
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {showTabs ? (
              <>
                {visiblePanels.map((panel) => (
                  <button
                    key={panel.id}
                    onClick={() => setActiveTab(panel.id)}
                    className={`px-2 py-1 rounded text-xs font-medium ${
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
              <span className="text-sm font-medium text-foreground px-1">
                {activePanel?.label || 'Panel'}
              </span>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-0.5">
            {activePanel && <PanelActions panel={activePanel} projectId={projectId} />}
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
          {mountedPanels.map((panel) => (
            <div key={panel.id} className={`absolute inset-0 ${effectiveTab === panel.id ? '' : 'invisible'}`}>
              <PanelContent panel={panel} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Desktop: resizable bottom panel ──────────────────────────��─────────────
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
            <span className="text-xs font-medium text-muted-foreground px-1">
              {activePanel?.label || 'Panel'}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Tab-specific actions */}
        <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
          {activePanel && <PanelActions panel={activePanel} projectId={projectId} />}

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

      {/* Panel content — alwaysMount panels stay in DOM even when hidden */}
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
