import { useState } from 'react';
import { useBackgroundTaskStore, type BackgroundTask } from '../stores/backgroundTaskStore';
import { CheckCircle2, XCircle, Loader2, X, ChevronDown, ChevronRight } from 'lucide-react';

function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function TaskItem({ task, onRemove }: { task: BackgroundTask; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = task.status === 'started' || task.status === 'in_progress';
  const isFailed = task.status === 'failed' || task.status === 'stopped';

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg hover:bg-muted/50 transition-colors group ${
      expanded ? 'flex-wrap' : ''
    }`}>
      {/* Status icon */}
      {isRunning ? (
        <Loader2 size={13} className="animate-spin text-primary flex-shrink-0" />
      ) : isFailed ? (
        <XCircle size={13} className="text-destructive flex-shrink-0" />
      ) : (
        <CheckCircle2 size={13} className="text-success flex-shrink-0" />
      )}

      {/* Description — clickable to expand summary */}
      <button
        onClick={() => task.summary && setExpanded(!expanded)}
        className="flex-1 min-w-0 text-left flex items-center gap-1.5"
      >
        <span className="text-foreground truncate">
          {task.description || 'Background Task'}
        </span>
        <span className="text-muted-foreground/60 flex-shrink-0">
          {formatTimeAgo(task.startedAt)}
        </span>
        {task.summary && (
          <span className="text-muted-foreground/40 flex-shrink-0">
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </button>

      {/* Dismiss */}
      <button
        onClick={onRemove}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all flex-shrink-0"
        title="Dismiss"
      >
        <X size={11} className="text-muted-foreground" />
      </button>

      {/* Expandable summary */}
      {expanded && task.summary && (
        <div className="w-full pl-5 pt-1 pb-0.5">
          <div className="text-[11px] text-muted-foreground/80 max-h-24 overflow-y-auto leading-relaxed">
            {task.summary}
          </div>
        </div>
      )}
    </div>
  );
}

interface BackgroundTaskPanelProps {
  sessionId: string;
}

export function BackgroundTaskPanel({ sessionId }: BackgroundTaskPanelProps) {
  const tasks = useBackgroundTaskStore((s) => s.getTasksBySession(sessionId));
  const removeTask = useBackgroundTaskStore((s) => s.removeTask);
  const clearTasks = useBackgroundTaskStore((s) => s.clearTasks);

  if (tasks.length === 0) {
    return null;
  }

  const activeTasks = tasks.filter(t => t.status === 'started' || t.status === 'in_progress');
  const completedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'stopped');

  return (
    <div className="border-t border-border bg-card/30">
      {/* Compact header */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium">
          {activeTasks.length > 0
            ? `${activeTasks.length} task${activeTasks.length > 1 ? 's' : ''} running`
            : `${tasks.length} task${tasks.length > 1 ? 's' : ''}`
          }
        </span>
        <button
          onClick={() => clearTasks(sessionId)}
          className="ml-auto p-0.5 rounded hover:bg-muted transition-colors"
          title="Clear all"
        >
          <X size={11} className="text-muted-foreground" />
        </button>
      </div>

      {/* Task list — compact rows */}
      <div className="overflow-y-auto max-h-40 pb-1">
        {activeTasks.map((task) => (
          <TaskItem key={task.id} task={task} onRemove={() => removeTask(task.id)} />
        ))}
        {completedTasks.map((task) => (
          <TaskItem key={task.id} task={task} onRemove={() => removeTask(task.id)} />
        ))}
      </div>
    </div>
  );
}
