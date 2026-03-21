import type { AgentFeedItem } from '@my-claudia/shared';
import { useProjectStore } from '../../stores/projectStore';

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  running: { dot: 'bg-amber-500 animate-pulse', label: 'Running' },
  completed: { dot: 'bg-green-500', label: 'Completed' },
  failed: { dot: 'bg-red-500', label: 'Failed' },
};

const SOURCE_LABELS: Record<string, string> = {
  trigger: 'Event',
  scheduled: 'Scheduled',
  manual: 'Manual',
  delegation: 'Delegation',
};

export function FeedItem({ item }: { item: AgentFeedItem }) {
  const selectSession = useProjectStore((s) => s.selectSession);
  const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.running;

  const handleClick = () => {
    if (item.sessionId) {
      selectSession(item.sessionId);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors ${
        !item.readAt ? 'bg-primary/5' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusStyle.dot}`} />

        <div className="flex-1 min-w-0">
          {/* Title + time */}
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm truncate ${!item.readAt ? 'font-medium' : ''}`}>
              {item.title}
            </span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {timeAgo(item.createdAt)}
            </span>
          </div>

          {/* Summary */}
          {item.summary && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {item.summary}
            </p>
          )}

          {/* Error */}
          {item.error && (
            <p className="text-xs text-destructive mt-0.5 line-clamp-1">
              {item.error}
            </p>
          )}

          {/* Source badge */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-muted-foreground/60 px-1 py-0.5 bg-secondary rounded">
              {SOURCE_LABELS[item.source] || item.source}
            </span>
            {item.delegationContext && (
              <span className="text-[10px] text-muted-foreground/60">
                {item.delegationContext.decision} (conf: {(item.delegationContext.confidence * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
