import { useState } from 'react';
import type { ClaudiaTask } from '../../stores/claudiaStore';

interface ActiveTasksPanelProps {
  tasks: ClaudiaTask[];
  interruptedSessionIds: Set<string>;
  permissionSessionIds: Set<string>;
  onViewDetails: (task: ClaudiaTask) => void;
  onCancel: (task: ClaudiaTask) => void;
  onResumeInterrupted: (task: ClaudiaTask) => void;
}

function getStatusInfo(
  task: ClaudiaTask,
  interrupted: boolean,
  permissionRequired: boolean,
): { label: string; dotClass: string } {
  if (interrupted) return { label: 'Interrupted', dotClass: 'bg-red-400 animate-pulse' };
  if (permissionRequired) return { label: 'Permission Required', dotClass: 'bg-orange-500 animate-pulse' };
  if (task.status === 'running') return { label: 'Running', dotClass: 'bg-amber-500 animate-pulse' };
  if (task.status === 'queued') return { label: 'Queued', dotClass: 'bg-muted-foreground' };
  return { label: 'Waiting', dotClass: 'bg-blue-400 animate-pulse' };
}

export function ActiveTasksPanel({
  tasks,
  interruptedSessionIds,
  permissionSessionIds,
  onViewDetails,
  onCancel,
  onResumeInterrupted,
}: ActiveTasksPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (tasks.length === 0) return null;

  const visible = showAll ? tasks : tasks.slice(0, 3);
  const hiddenCount = Math.max(0, tasks.length - visible.length);

  return (
    <div className="border-t border-border/60 bg-card/95 px-3 py-2">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Active Tasks</span>
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-foreground/80">
          {tasks.length}
        </span>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="ml-auto text-primary hover:underline"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
          {visible.map((task) => {
            const interrupted = Boolean(task.sessionId && interruptedSessionIds.has(task.sessionId));
            const permissionRequired = Boolean(task.sessionId && permissionSessionIds.has(task.sessionId));
            const { label, dotClass } = getStatusInfo(task, interrupted, permissionRequired);

            return (
              <div key={`active-${task.id}`} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate text-xs font-medium text-foreground">{task.title}</span>
                      <span className="flex-shrink-0">{label}</span>
                      <span>·</span>
                      <span className="flex-shrink-0">{Math.max(1, Math.round((Date.now() - task.updatedAt) / 60000))}m</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                      {task.input}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-[11px]">
                      {task.sessionId && (
                        <button
                          onClick={() => onViewDetails(task)}
                          className="text-primary hover:underline"
                        >
                          View Details
                        </button>
                      )}
                      {interrupted && (
                        <button
                          onClick={() => void onResumeInterrupted(task)}
                          className="text-primary hover:underline"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        onClick={() => onCancel(task)}
                        className="text-red-400 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-[11px] text-primary hover:bg-muted/20"
            >
              +{hiddenCount} more active task{hiddenCount > 1 ? 's' : ''}
            </button>
          )}
          {showAll && tasks.length > 3 && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full text-[11px] text-muted-foreground hover:text-foreground"
            >
              Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
