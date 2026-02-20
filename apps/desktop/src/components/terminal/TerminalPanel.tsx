import { useState, useCallback, useRef } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { XTerminal } from './XTerminal';

const MIN_HEIGHT = 100;
const MAX_HEIGHT_VH = 70; // max 70% of viewport height
const DEFAULT_HEIGHT_DESKTOP = 250;
const DEFAULT_HEIGHT_MOBILE = 300;

interface TerminalPanelProps {
  projectId: string;
}

export function TerminalPanel({ projectId }: TerminalPanelProps) {
  const { isDrawerOpen, setDrawerOpen, terminals } = useTerminalStore();
  const isMobile = useIsMobile();
  const terminalId = terminals[projectId];

  const containerRef = useRef<HTMLDivElement>(null);
  const [heightPx, setHeightPx] = useState(
    isMobile ? DEFAULT_HEIGHT_MOBILE : DEFAULT_HEIGHT_DESKTOP,
  );
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Android back gesture to close drawer (priority 15: between sidebar=10 and agent=20)
  useAndroidBack(() => setDrawerOpen(false), isDrawerOpen, 15);

  // Drag handle for resizing
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
        const deltaPx = startY.current - clientY; // dragging up = positive = taller
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

  // Nothing to render at all
  if (!projectId || (!terminalId && !isDrawerOpen)) return null;

  return (
    <div
      ref={containerRef}
      className={`flex flex-col flex-shrink-0 ${isDrawerOpen ? 'bg-card border-t border-border' : ''}`}
      style={{ height: isDrawerOpen ? `${heightPx}px` : 0, overflow: 'hidden' }}
    >
      {/* Drag handle + header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-ns-resize select-none border-b border-border flex-shrink-0"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
      >
        {/* Drag indicator */}
        <div className="flex-1 flex justify-center">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/40" />
        </div>

        {/* Close button */}
        <button
          onClick={() => setDrawerOpen(false)}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Close terminal"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden">
        {terminalId ? (
          <XTerminal
            key={terminalId}
            terminalId={terminalId}
            projectId={projectId}
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
