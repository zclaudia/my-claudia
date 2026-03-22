import type { ClaudiaTask } from '../../stores/claudiaStore';
import type { ClaudiaTaskStatus } from '@my-claudia/shared';

interface TaskCardProps {
  task: ClaudiaTask;
  onViewDetails?: (task: ClaudiaTask) => void;
  onContinue?: (task: ClaudiaTask) => void;
  onCancel?: (task: ClaudiaTask) => void;
}

const STATUS_CONFIG: Record<ClaudiaTaskStatus, { dot: string; label: string }> = {
  queued: { dot: 'bg-muted-foreground', label: 'Queued' },
  running: { dot: 'bg-amber-500 animate-pulse', label: 'Running' },
  completed: { dot: 'bg-green-500', label: 'Completed' },
  failed: { dot: 'bg-red-500', label: 'Failed' },
  cancelled: { dot: 'bg-muted-foreground', label: 'Cancelled' },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function TaskCard({ task, onViewDetails, onContinue, onCancel }: TaskCardProps) {
  const config = STATUS_CONFIG[task.status];
  const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
      {/* Header: status dot + title + time */}
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.title}</p>
          <p className="text-[10px] text-muted-foreground">{timeAgo(task.createdAt)}</p>
        </div>
      </div>

      {/* Summary or error */}
      {task.summary && (
        <p className="text-xs text-muted-foreground line-clamp-2 pl-4">{task.summary}</p>
      )}
      {task.error && (
        <p className="text-xs text-red-400 line-clamp-2 pl-4">{task.error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pl-4">
        {task.sessionId && (
          <button
            onClick={() => onViewDetails?.(task)}
            className="text-[11px] text-primary hover:underline"
          >
            View Details
          </button>
        )}
        {isTerminal && (
          <button
            onClick={() => onContinue?.(task)}
            className="text-[11px] text-primary hover:underline"
          >
            Continue
          </button>
        )}
        {task.status === 'running' && (
          <button
            onClick={() => onCancel?.(task)}
            className="text-[11px] text-red-400 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
