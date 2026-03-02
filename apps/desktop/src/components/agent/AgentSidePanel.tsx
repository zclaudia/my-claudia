import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentPanel } from './AgentPanel';
import { useAgentStore } from '../../stores/agentStore';
import { getClientAIConfig } from '../../services/clientAI';

const MIN_WIDTH = 300;
const MAX_WIDTH_RATIO = 0.5; // max 50% of viewport
const DEFAULT_WIDTH = 400;
const STORAGE_KEY = 'agent-panel-width';

export function AgentSidePanel() {
  const { setExpanded, requestClear } = useAgentStore();
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Math.max(MIN_WIDTH, parseInt(saved, 10)) : DEFAULT_WIDTH;
  });
  const isDragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const config = getClientAIConfig();
  const modelName = config?.model || 'Agent AI';

  // Persist width
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  // Drag resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX - moveEvent.clientX; // dragging left increases width
      const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [width]);

  return (
    <div
      ref={panelRef}
      className="h-full flex flex-col border-l border-border bg-card relative flex-shrink-0"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{'\u{1F916}'}</span>
          <span className="font-semibold text-sm">Agent</span>
          <span className="text-[10px] text-muted-foreground/50" title={modelName}>{modelName}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Clear conversation */}
          <button
            onClick={requestClear}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Clear conversation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Close panel */}
          <button
            onClick={() => setExpanded(false)}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Close Agent Panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Agent Panel content (no header — we render our own above) */}
      <div className="flex-1 overflow-hidden">
        <AgentPanel isMobile={false} showHeader={false} />
      </div>
    </div>
  );
}
