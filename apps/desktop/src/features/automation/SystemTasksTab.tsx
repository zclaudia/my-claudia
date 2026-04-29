import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import type { SystemTaskInfo } from '@my-claudia/shared';
import type { AutomationApiType } from './useAutomationApi';
import { formatInterval, CATEGORY_COLORS } from './automation-types';
import { LoadingState, EmptyState } from './AutomationSharedComponents';

interface SystemTasksTabProps {
  api: AutomationApiType;
}

export function SystemTasksTab({ api }: SystemTasksTabProps) {
  const [tasks, setTasks] = useState<SystemTaskInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    await api.get('/api/system-tasks').then(setTasks).catch(() => setTasks([]));
    setLoading(false);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{tasks.length} system task{tasks.length !== 1 ? 's' : ''}</h2>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <EmptyState message="No system tasks running" />
      ) : (
        <div className="space-y-1.5">
          {tasks.map(t => (
            <SystemTaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemTaskCard({ task }: { task: SystemTaskInfo }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="shrink-0">
          {task.status === 'running' ? (
            <Loader2 size={14} className="text-primary animate-spin" />
          ) : task.status === 'error' ? (
            <XCircle size={14} className="text-destructive" />
          ) : (
            <CheckCircle2 size={14} className="text-success" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground truncate">{task.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${CATEGORY_COLORS[task.category] ?? 'bg-muted text-muted-foreground'}`}>
              {task.category}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-muted-foreground">every {formatInterval(task.intervalMs)}</span>
            <span className="text-[10px] text-muted-foreground">Runs: {task.runCount}</span>
            {task.lastRunDurationMs !== undefined && (
              <span className="text-[10px] text-muted-foreground">Last: {task.lastRunDurationMs}ms</span>
            )}
            {task.lastError && (
              <span className="text-[10px] text-destructive truncate max-w-[120px]" title={task.lastError}>
                {task.lastError.slice(0, 40)}
              </span>
            )}
          </div>
        </div>
        <span className="text-[9px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded shrink-0">System</span>
      </div>
    </div>
  );
}
