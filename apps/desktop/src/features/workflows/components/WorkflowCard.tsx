import { Play, Pencil, Pause, Zap, Trash2, Loader2, CheckCircle2, XCircle, Clock, Timer, Activity, ExternalLink } from 'lucide-react';
import type { Workflow, WorkflowRun } from '@my-claudia/shared';
import { isV2Definition } from '@my-claudia/shared';

interface WorkflowCardProps {
  workflow: Workflow;
  latestRun?: WorkflowRun;
  onTrigger?: () => void;
  onEdit?: () => void;
  onToggle?: () => void;
  onDelete?: () => void;
  onViewRuns: () => void;
  onPopOut?: () => void;
}

function getTriggerLabel(workflow: Workflow): { icon: React.ReactNode; label: string } {
  const trigger = workflow.definition.triggers[0];
  if (!trigger) return { icon: <Play size={12} />, label: 'manual' };

  switch (trigger.type) {
    case 'cron':
      return { icon: <Clock size={12} />, label: `cron: ${trigger.cron}` };
    case 'interval':
      return { icon: <Timer size={12} />, label: `every ${trigger.intervalMinutes}min` };
    case 'event':
      return { icon: <Zap size={12} />, label: `event: ${trigger.event}` };
    default:
      return { icon: <Play size={12} />, label: 'manual' };
  }
}

function getStatusIndicator(workflow: Workflow, latestRun?: WorkflowRun) {
  if (workflow.status !== 'active') return null;
  if (!latestRun) return <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />;

  switch (latestRun.status) {
    case 'running':
      return <Loader2 size={14} className="text-primary animate-spin" />;
    case 'completed':
      return <CheckCircle2 size={14} className="text-green-500" />;
    case 'failed':
      return <XCircle size={14} className="text-destructive" />;
    default:
      return <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />;
  }
}

function timeAgo(timestamp?: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function WorkflowCard({ workflow, latestRun, onTrigger, onEdit, onToggle, onDelete, onViewRuns, onPopOut }: WorkflowCardProps) {
  const isActive = workflow.status === 'active';
  const { icon: triggerIcon, label: triggerLabel } = getTriggerLabel(workflow);
  const def = workflow.definition;
  const stepCount = isV2Definition(def) ? def.nodes.length : def.steps.length;

  return (
    <div
      className={`border border-border rounded-lg p-3 transition-colors ${
        isActive ? 'bg-card hover:border-primary/30' : 'bg-card/50 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getStatusIndicator(workflow, latestRun)}
          <div className="min-w-0 flex-1">
            <button
              onClick={onViewRuns}
              className="text-sm font-medium text-foreground truncate block hover:text-primary transition-colors text-left"
            >
              {workflow.name}
            </button>
            {workflow.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{workflow.description}</p>
            )}
          </div>
        </div>

        {(onTrigger || onEdit || onToggle || onDelete || onPopOut) && (
          <div className="flex items-center gap-1 shrink-0">
            {onTrigger && (
              <button
                onClick={onTrigger}
                disabled={!isActive}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                title="Run now"
              >
                <Play size={14} />
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Edit"
              >
                <Pencil size={14} />
              </button>
            )}
            {onPopOut && (
              <button
                onClick={onPopOut}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Open in new window"
              >
                <ExternalLink size={14} />
              </button>
            )}
            {onToggle && (
              <button
                onClick={onToggle}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title={isActive ? 'Disable' : 'Enable'}
              >
                {isActive ? <Pause size={14} /> : <Zap size={14} />}
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {triggerIcon}
          {triggerLabel}
        </span>
        <span className="flex items-center gap-1">
          <Activity size={12} />
          {stepCount} step{stepCount !== 1 ? 's' : ''}
        </span>
        {latestRun && (
          <span className="flex items-center gap-1">
            Last: {timeAgo(latestRun.startedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
