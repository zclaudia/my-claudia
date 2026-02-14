import { useCallback, useRef, useEffect } from 'react';
import { AgentBubble } from './AgentBubble';
import { AgentPanel } from './AgentPanel';
import { useAgentStore } from '../../stores/agentStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import * as api from '../../services/api';

export function AgentWidget() {
  const { isExpanded, isConfigured, configure, setExpanded } = useAgentStore();
  const { isConnected } = useConnection();
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-provision agent on first expand
  const handleExpand = useCallback(async () => {
    const store = useAgentStore.getState();

    // Toggle expand
    store.toggleExpanded();

    // If becoming expanded and not yet configured, ensure agent project/session
    if (!store.isExpanded && !store.isConfigured && isConnected) {
      try {
        const response = await api.ensureAgent();
        if (response.projectId && response.sessionId) {
          configure(response.projectId, response.sessionId);
        }
      } catch (error) {
        console.error('[AgentWidget] Failed to ensure agent:', error);
      }
    }
  }, [isConnected, configure]);

  const handleCollapse = useCallback(() => {
    setExpanded(false);
  }, [setExpanded]);

  // Desktop: click outside to close
  useEffect(() => {
    if (!isExpanded || isMobile) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };

    // Delay to avoid the expand click itself triggering close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded, isMobile, setExpanded]);

  if (!isConnected) return null;

  // Collapsed: side tab on right edge, vertically centered
  if (!isExpanded) {
    return (
      <div className="fixed right-0 top-1/2 -translate-y-1/2 z-40">
        <AgentBubble onClick={handleExpand} />
      </div>
    );
  }

  // Expanded: loading state
  if (!isConfigured) {
    return (
      <div className={
        isMobile
          ? "fixed inset-0 z-50 bg-card flex items-center justify-center"
          : "fixed bottom-8 right-6 z-40 w-[400px] h-[600px] bg-card border border-border rounded-xl shadow-2xl flex items-center justify-center"
      }>
        <div className="text-center text-muted-foreground">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm">Setting up Agent...</p>
        </div>
      </div>
    );
  }

  // Expanded: panel
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex">
        {/* Left-side collapse arrow */}
        <button
          onClick={handleCollapse}
          className="flex-shrink-0 flex items-center px-1 py-2 self-center
                     bg-zinc-400/60 text-zinc-600 rounded-r-md shadow-sm
                     border border-l-0 border-zinc-300
                     active:bg-zinc-400/80
                     dark:bg-zinc-600/60 dark:text-zinc-400
                     dark:border-zinc-600 dark:active:bg-zinc-600/80"
          title="Close Agent"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Panel fills remaining space */}
        <div className="flex-1 min-w-0">
          <AgentPanel isMobile={true} />
        </div>
      </div>
    );
  }

  // Desktop
  return (
    <div ref={panelRef} className="fixed bottom-8 right-6 z-40">
      <AgentPanel isMobile={false} />
    </div>
  );
}
