import { useEffect, useState } from 'react';
import {
  Clock, Play, Pause, Trash2, Calendar,
  CheckCircle2, XCircle, Loader2, Zap, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { ScheduledTask } from '@my-claudia/shared';
import { useScheduledTaskStore } from '../store';
import { TaskRunHistory } from './TaskRunHistory';

interface ScheduledTasksPanelProps {
  projectId: string;
  onOpenAutomations?: () => void;
}

type FilterType = 'all' | 'user' | 'system' | 'error';

// ── Helpers ──────────────────────────────────────────────────────

function formatNextRun(nextRun?: number): string {
  if (!nextRun) return 'Not scheduled';
  const d = new Date(nextRun);
  const now = Date.now();
  const diff = nextRun - now;
  if (diff < 0) return 'Overdue';
  if (diff < 60000) return 'Less than 1m';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function scheduleLabel(task: ScheduledTask): string {
  if (task.scheduleType === 'cron') return `cron: ${task.scheduleCron}`;
  if (task.scheduleType === 'interval') return `every ${task.scheduleIntervalMinutes}m`;
  if (task.scheduleType === 'once') return 'once';
  return task.scheduleType;
}


// ── Template Card ────────────────────────────────────────────────

// ── User Task Card ───────────────────────────────────────────────

function TaskCard({
  task,
  onToggle,
  onTrigger,
  onDelete,
  expanded,
  onToggleExpand,
}: {
  task: ScheduledTask;
  onToggle?: () => void;
  onTrigger?: () => void;
  onDelete?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  return (
    <div className={`rounded-lg border transition-colors ${
      task.enabled ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60'
    }`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Expand toggle */}
        <button onClick={onToggleExpand} className="shrink-0 text-muted-foreground hover:text-foreground p-0.5">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Status indicator */}
        <div className="shrink-0">
          {task.status === 'running' ? (
            <Loader2 size={14} className="text-primary animate-spin" />
          ) : task.status === 'error' ? (
            <XCircle size={14} className="text-destructive" />
          ) : (
            <CheckCircle2 size={14} className="text-success" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground truncate">{task.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{scheduleLabel(task)}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock size={10} />
              {formatNextRun(task.nextRun)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Runs: {task.runCount}
            </span>
            {task.lastError && (
              <span className="text-[10px] text-destructive truncate max-w-[120px]" title={task.lastError}>
                {task.lastError.slice(0, 40)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {(onTrigger || onToggle || onDelete) && (
          <div className="flex items-center gap-1 shrink-0">
            {onTrigger && (
              <button
                onClick={onTrigger}
                disabled={task.status === 'running'}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-30"
                title="Run now"
              >
                <Play size={12} />
              </button>
            )}
            {onToggle && (
              <button
                onClick={onToggle}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                title={task.enabled ? 'Disable' : 'Enable'}
              >
                {task.enabled ? <Pause size={12} /> : <Zap size={12} />}
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Run history (expandable) */}
      {expanded && (
        <div className="px-3 pb-3">
          <TaskRunHistory taskId={task.id} taskSource="user" />
        </div>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────

export function ScheduledTasksPanel({ projectId, onOpenAutomations }: ScheduledTasksPanelProps) {
  const tasks = useScheduledTaskStore((s) => s.tasks[projectId] ?? []);
  const loadTasks = useScheduledTaskStore((s) => s.loadTasks);
  const trigger = useScheduledTaskStore((s) => s.trigger);

  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadTasks(projectId).catch(() => {});
  }, [projectId, loadTasks]);

  const enabledTasks = tasks.filter((t) => t.enabled);
  const disabledTasks = tasks.filter((t) => !t.enabled);
  const errorCount = tasks.filter((t) => t.status === 'error').length;

  // Filter logic
  const showUserTasks = filter === 'all' || filter === 'user' || filter === 'error';
  const filteredEnabledTasks = showUserTasks
    ? (filter === 'error' ? enabledTasks.filter((t) => t.status === 'error') : enabledTasks)
    : [];
  const filteredDisabledTasks = showUserTasks && filter !== 'error' ? disabledTasks : [];

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Task Manager</span>
          {enabledTasks.length > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full leading-none">
              {enabledTasks.length} active
            </span>
          )}
        </div>
        {onOpenAutomations && (
          <button
            onClick={onOpenAutomations}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
          >
            Manage in Automations →
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        {(['all', 'user', 'error'] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors capitalize ${
              filter === f
                ? 'bg-primary/15 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            {f}
            {f === 'error' && errorCount > 0 && (
              <span className="ml-1 text-destructive">{errorCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Active user tasks (read-only — management in Automations window) */}
        {filteredEnabledTasks.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Active ({filteredEnabledTasks.length})
            </div>
            <div className="space-y-1.5">
              {filteredEnabledTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onTrigger={() => trigger(task.id, projectId).catch(() => {})}
                  expanded={expandedId === task.id}
                  onToggleExpand={() => toggleExpand(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Disabled user tasks (read-only) */}
        {filteredDisabledTasks.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Disabled ({filteredDisabledTasks.length})
            </div>
            <div className="space-y-1.5">
              {filteredDisabledTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onTrigger={() => trigger(task.id, projectId).catch(() => {})}
                  expanded={expandedId === task.id}
                  onToggleExpand={() => toggleExpand(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {filteredEnabledTasks.length === 0 && filteredDisabledTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Clock size={24} className="mb-2 opacity-40" />
            <span className="text-xs">
              {filter === 'error' ? 'No tasks with errors' : 'No scheduled tasks'}
            </span>
            {filter === 'all' && onOpenAutomations && (
              <button onClick={onOpenAutomations} className="text-[10px] mt-1 text-primary hover:underline">
                Create in Automations →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
