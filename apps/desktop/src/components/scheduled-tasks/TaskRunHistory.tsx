import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import type { TaskRun } from '@my-claudia/shared';
import { useScheduledTaskStore } from '../../stores/scheduledTaskStore';
import { useSystemTaskStore } from '../../stores/systemTaskStore';

interface TaskRunHistoryProps {
  taskId: string;
  taskSource: 'user' | 'system';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function RunRow({ run }: { run: TaskRun }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = run.result || run.error;

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={`flex items-center gap-2 w-full px-2 py-1.5 text-left text-[10px] ${
          hasDetail ? 'hover:bg-secondary/50 cursor-pointer' : 'cursor-default'
        }`}
      >
        {/* Expand indicator */}
        <div className="w-3 shrink-0">
          {hasDetail && (expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
        </div>

        {/* Status */}
        <div className="shrink-0">
          {run.status === 'running' ? (
            <Loader2 size={10} className="text-primary animate-spin" />
          ) : run.status === 'failed' ? (
            <XCircle size={10} className="text-destructive" />
          ) : (
            <CheckCircle2 size={10} className="text-success" />
          )}
        </div>

        {/* Time */}
        <span className="text-muted-foreground w-16 shrink-0">{formatTime(run.startedAt)}</span>

        {/* Duration */}
        <span className="text-muted-foreground w-12 shrink-0">{formatDuration(run.durationMs)}</span>

        {/* Status text */}
        <span className={`flex-1 truncate ${run.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {run.status === 'failed' ? (run.error?.slice(0, 60) ?? 'Failed') : (run.result?.slice(0, 60) ?? run.status)}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div className="px-7 pb-2">
          {run.error && (
            <pre className="text-[10px] text-destructive bg-destructive/5 rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {run.error}
            </pre>
          )}
          {run.result && !run.error && (
            <pre className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {run.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskRunHistory({ taskId, taskSource }: TaskRunHistoryProps) {
  const userRuns = useScheduledTaskStore((s) => s.taskRuns[taskId]);
  const systemRuns = useSystemTaskStore((s) => s.taskRuns[taskId]);
  const loadUserRuns = useScheduledTaskStore((s) => s.loadTaskRuns);
  const loadSystemRuns = useSystemTaskStore((s) => s.loadTaskRuns);

  const runs = taskSource === 'system' ? systemRuns : userRuns;
  const loadRuns = taskSource === 'system' ? loadSystemRuns : loadUserRuns;

  useEffect(() => {
    loadRuns(taskId).catch(() => {});
  }, [taskId, loadRuns]);

  if (!runs) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={14} className="text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center py-4 text-muted-foreground">
        <Clock size={16} className="mb-1 opacity-40" />
        <span className="text-[10px]">No run history yet</span>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card/50">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1 bg-muted/30 border-b border-border text-[10px] text-muted-foreground font-medium">
        <span className="w-3" />
        <span className="w-4" />
        <span className="w-16">Time</span>
        <span className="w-12">Duration</span>
        <span className="flex-1">Result</span>
      </div>
      {/* Rows */}
      <div className="max-h-48 overflow-y-auto">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}
