import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { extractThinking } from '../chat/MessageList';
import type { ClaudiaTask } from '../../stores/claudiaStore';
import type { ClaudiaTaskStatus } from '@my-claudia/shared';

interface TaskCardProps {
  task: ClaudiaTask;
  collapsed?: boolean;
  onViewDetails?: (task: ClaudiaTask) => void;
  onContinue?: (task: ClaudiaTask) => void;
  onCancel?: (task: ClaudiaTask) => void;
  onDismiss?: (task: ClaudiaTask) => void;
}

const STATUS_CONFIG: Record<ClaudiaTaskStatus, { dot: string; label: string }> = {
  queued: { dot: 'bg-muted-foreground', label: 'Queued' },
  running: { dot: 'bg-amber-500 animate-pulse', label: 'Running' },
  waiting: { dot: 'bg-blue-400 animate-pulse', label: 'Waiting' },
  completed: { dot: 'bg-green-500', label: 'Completed' },
  failed: { dot: 'bg-red-500', label: 'Failed' },
  cancelled: { dot: 'bg-muted-foreground', label: 'Cancelled' },
};

const COLLAPSE_THRESHOLD = 300;

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function TaskCard({ task, collapsed, onViewDetails, onContinue, onCancel, onDismiss }: TaskCardProps) {
  const config = STATUS_CONFIG[task.status];
  const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
  const streamingText = useClaudiaStore((s) => s.streamingText[task.id]);
  const [manualExpand, setManualExpand] = useState(false);

  // Determine what text to show, strip <think> blocks
  const rawText = task.responseText || streamingText || null;
  const displayText = rawText ? extractThinking(rawText).content.trim() : null;

  // Collapsed mode: one-line summary
  if (collapsed && !manualExpand) {
    const snippet = displayText?.replace(/\n/g, ' ').slice(0, 80) || task.error || '';
    return (
      <div
        className="rounded-lg border border-border bg-card/50 px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-secondary/30 transition-colors"
        onClick={() => setManualExpand(true)}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
        <span className="text-xs text-muted-foreground truncate flex-1">
          {snippet || config.label}
        </span>
        <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{timeAgo(task.createdAt)}</span>
      </div>
    );
  }

  const isLong = displayText ? displayText.length > COLLAPSE_THRESHOLD : false;
  const showText = displayText && (!isLong || manualExpand) ? displayText : displayText?.slice(0, COLLAPSE_THRESHOLD);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
      {/* Header: status dot + title + label + time */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
        {!displayText && <span className="text-foreground text-xs font-medium truncate flex-1">{task.title}</span>}
        <span>{config.label}</span>
        <span>·</span>
        <span>{timeAgo(task.createdAt)}</span>
        {collapsed && (
          <button onClick={() => setManualExpand(false)} className="ml-auto text-[10px] text-primary hover:underline">
            Collapse
          </button>
        )}
        {task.toolCount != null && task.toolCount > 0 && (
          <span className={`${collapsed ? '' : 'ml-auto'} text-[10px] bg-secondary px-1.5 py-0.5 rounded`}>
            {task.toolCount} tool{task.toolCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Response content */}
      {showText && (
        <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1">
          <ReactMarkdown>{showText}</ReactMarkdown>
          {task.status === 'running' && streamingText && (
            <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      )}

      {/* Expand/collapse for long responses */}
      {isLong && (
        <button
          onClick={() => setManualExpand(!manualExpand)}
          className="text-[11px] text-primary hover:underline"
        >
          {manualExpand ? 'Show less' : 'Show more...'}
        </button>
      )}

      {/* Error display */}
      {task.error && (
        <p className="text-xs text-red-400 line-clamp-3">{task.error}</p>
      )}

      {/* Queued state — no content yet */}
      {task.status === 'queued' && !displayText && (
        <p className="text-xs text-muted-foreground/60 italic">Waiting to start...</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
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
        {isTerminal && onDismiss && (
          <button
            onClick={() => onDismiss(task)}
            className="text-[11px] text-muted-foreground hover:text-foreground ml-auto"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
