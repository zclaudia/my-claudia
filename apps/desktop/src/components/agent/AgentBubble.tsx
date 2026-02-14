import { useAgentStore } from '../../stores/agentStore';

interface AgentBubbleProps {
  onClick: () => void;
}

export function AgentBubble({ onClick }: AgentBubbleProps) {
  const { hasUnread } = useAgentStore();

  return (
    <button
      onClick={onClick}
      className="flex items-center px-1 py-2 rounded-l-md
                 bg-zinc-400/60 text-zinc-600 shadow-sm border border-r-0 border-zinc-300
                 hover:bg-zinc-400/80 hover:px-1.5 transition-all duration-200
                 relative dark:bg-zinc-600/60 dark:text-zinc-400
                 dark:border-zinc-600 dark:hover:bg-zinc-600/80"
      title="Agent Assistant"
    >
      {/* Left arrow */}
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
      </svg>

      {/* Unread badge */}
      {hasUnread && (
        <span className="absolute -top-1 -left-1 w-3 h-3 bg-destructive rounded-full
                        border-2 border-background animate-pulse" />
      )}
    </button>
  );
}
