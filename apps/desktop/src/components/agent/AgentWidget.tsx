import { useCallback, useRef, useEffect } from 'react';
import { AgentBubble } from './AgentBubble';
import { AgentPanel } from './AgentPanel';
import { useAgentStore } from '../../stores/agentStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import * as api from '../../services/api';

export function AgentWidget() {
  const { isExpanded, isConfigured, configure, setExpanded, setSelectedProviderId } = useAgentStore();
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

        // Load saved provider selection from agent config
        const config = await api.getAgentConfig();
        if (config.providerId) {
          setSelectedProviderId(config.providerId);
        } else {
          // Fallback to default provider
          const providers = await api.getProviders();
          const defaultProvider = providers.find(p => p.isDefault) || providers[0];
          if (defaultProvider) {
            setSelectedProviderId(defaultProvider.id);
          }
        }
      } catch (error) {
        console.error('[AgentWidget] Failed to ensure agent:', error);
      }
    }
  }, [isConnected, configure, setSelectedProviderId]);

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

  // Mobile: App.tsx handles rendering when expanded — don't render anything here
  if (isMobile && isExpanded) {
    return null;
  }

  // Desktop: Expanded loading state
  if (!isConfigured) {
    return (
      <div className="fixed bottom-8 right-6 z-40 w-[400px] h-[600px] bg-card border border-border rounded-xl shadow-2xl flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm">Setting up Agent...</p>
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
