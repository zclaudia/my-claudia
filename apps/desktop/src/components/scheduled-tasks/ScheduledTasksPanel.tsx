import { useEffect, useState, useCallback } from 'react';
import {
  Clock, Play, Pause, Trash2, Plus, Calendar, Timer,
  CheckCircle2, XCircle, Loader2, Zap,
} from 'lucide-react';
import type { ScheduledTask, ScheduledTaskTemplate } from '@my-claudia/shared';
import { useScheduledTaskStore } from '../../stores/scheduledTaskStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { CreateScheduledTaskDialog } from './CreateScheduledTaskDialog';

interface ScheduledTasksPanelProps {
  projectId: string;
}

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

const CATEGORY_COLORS: Record<string, string> = {
  ai: 'bg-primary/15 text-primary',
  git: 'bg-success/15 text-success',
  maintenance: 'bg-warning/15 text-warning',
  quality: 'bg-thinking/15 text-thinking',
};

// ── Template Card ────────────────────────────────────────────────

function TemplateCard({
  template,
  existingTask,
  onToggle,
}: {
  template: ScheduledTaskTemplate;
  existingTask?: ScheduledTask;
  onToggle: () => void;
}) {
  const isEnabled = existingTask?.enabled ?? false;

  return (
    <button
      onClick={onToggle}
      className={`flex flex-col gap-1 p-2.5 rounded-lg border text-left transition-all text-xs ${
        isEnabled
          ? 'border-primary/40 bg-primary/5'
          : 'border-border hover:border-muted-foreground/30 bg-card'
      }`}
    >
      <div className="flex items-center justify-between w-full">
        <span className="font-medium text-foreground truncate">{template.name}</span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${isEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
      </div>
      <span className="text-muted-foreground line-clamp-1">{template.description}</span>
      <span className={`self-start px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[template.category] ?? 'bg-muted text-muted-foreground'}`}>
        {template.category}
      </span>
    </button>
  );
}

// ── Task Card ────────────────────────────────────────────────────

function TaskCard({
  task,
  onToggle,
  onTrigger,
  onDelete,
  readOnly,
}: {
  task: ScheduledTask;
  onToggle?: () => void;
  onTrigger?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
      task.enabled ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60'
    }`}>
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
          {task.lastRunResult && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={task.lastRunResult}>
              {task.lastRunResult.slice(0, 40)}
            </span>
          )}
          {task.lastError && (
            <span className="text-[10px] text-destructive truncate max-w-[120px]" title={task.lastError}>
              {task.lastError.slice(0, 40)}
            </span>
          )}
        </div>
      </div>

      {/* Actions (hidden in read-only / mobile mode) */}
      {!readOnly && (
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
  );
}

// ── Main Panel ───────────────────────────────────────────────────

export function ScheduledTasksPanel({ projectId }: ScheduledTasksPanelProps) {
  const isMobile = useIsMobile();
  const tasks = useScheduledTaskStore((s) => s.tasks[projectId] ?? []);
  const templates = useScheduledTaskStore((s) => s.templates);
  const loadTasks = useScheduledTaskStore((s) => s.loadTasks);
  const loadTemplates = useScheduledTaskStore((s) => s.loadTemplates);
  const enableTemplate = useScheduledTaskStore((s) => s.enableTemplate);
  const update = useScheduledTaskStore((s) => s.update);
  const trigger = useScheduledTaskStore((s) => s.trigger);
  const remove = useScheduledTaskStore((s) => s.remove);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    loadTasks(projectId).catch(() => {});
    loadTemplates().catch(() => {});
  }, [projectId, loadTasks, loadTemplates]);

  const handleToggleTemplate = useCallback(
    (templateId: string) => {
      enableTemplate(projectId, templateId).catch(() => {});
    },
    [projectId, enableTemplate],
  );

  const enabledTasks = tasks.filter((t) => t.enabled);
  const disabledTasks = tasks.filter((t) => !t.enabled);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Scheduled Tasks</span>
          {enabledTasks.length > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full leading-none">
              {enabledTasks.length} active
            </span>
          )}
        </div>
        {!isMobile && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={12} />
            New
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Templates (hidden on mobile) */}
        {!isMobile && templates.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <Timer size={10} />
              Quick Start
            </div>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  existingTask={tasks.find((t) => t.templateId === tpl.id)}
                  onToggle={() => handleToggleTemplate(tpl.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Active tasks */}
        {enabledTasks.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Active ({enabledTasks.length})
            </div>
            <div className="space-y-1.5">
              {enabledTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  readOnly={isMobile}
                  onToggle={() => update(task.id, projectId, { enabled: false }).catch(() => {})}
                  onTrigger={() => trigger(task.id, projectId).catch(() => {})}
                  onDelete={() => remove(task.id, projectId).catch(() => {})}
                />
              ))}
            </div>
          </div>
        )}

        {/* Disabled tasks */}
        {disabledTasks.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Disabled ({disabledTasks.length})
            </div>
            <div className="space-y-1.5">
              {disabledTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  readOnly={isMobile}
                  onToggle={() => update(task.id, projectId, { enabled: true }).catch(() => {})}
                  onTrigger={() => trigger(task.id, projectId).catch(() => {})}
                  onDelete={() => remove(task.id, projectId).catch(() => {})}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {tasks.length === 0 && templates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Clock size={24} className="mb-2 opacity-40" />
            <span className="text-xs">No scheduled tasks</span>
            <span className="text-[10px] mt-1">Click "New" to create one</span>
          </div>
        )}
      </div>

      {!isMobile && showCreate && (
        <CreateScheduledTaskDialog
          projectId={projectId}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
