import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Pencil, Eye, RotateCw, Play, X, Clock } from 'lucide-react';
import type { SupervisionTask, TaskStatus } from '@my-claudia/shared';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { useProjectStore } from '../../stores/projectStore';
import * as api from '../../services/api';

interface TaskCardStripProps {
  projectId: string;
}

const STATUS_BADGE: Record<TaskStatus, { label: string; className: string }> = {
  proposed: { label: 'Proposed', className: 'bg-purple-500/15 text-purple-500' },
  pending: { label: 'Pending', className: 'bg-blue-500/15 text-blue-500' },
  queued: { label: 'Queued', className: 'bg-cyan-500/15 text-cyan-500' },
  planning: { label: 'Planning', className: 'bg-blue-500/15 text-blue-500' },
  running: { label: 'Running', className: 'bg-green-500/15 text-green-500' },
  completed: { label: 'Done', className: 'bg-emerald-600/15 text-emerald-600' },
  reviewing: { label: 'Review', className: 'bg-yellow-500/15 text-yellow-500' },
  approved: { label: 'Approved', className: 'bg-green-600/15 text-green-600' },
  integrated: { label: 'Done', className: 'bg-emerald-600/15 text-emerald-600' },
  rejected: { label: 'Rejected', className: 'bg-red-500/15 text-red-500' },
  merge_conflict: { label: 'Conflict', className: 'bg-orange-500/15 text-orange-500' },
  blocked: { label: 'Blocked', className: 'bg-gray-500/15 text-gray-400' },
  failed: { label: 'Failed', className: 'bg-red-600/15 text-red-600' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-500/15 text-gray-500' },
};

const STORAGE_KEY = 'task-card-strip-collapsed';

export function TaskCardStrip({ projectId }: TaskCardStripProps) {
  const tasks = useSupervisionStore((s) => s.tasks[projectId] || []);
  const setTasks = useSupervisionStore((s) => s.setTasks);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });

  // Fetch tasks on mount
  useEffect(() => {
    api.getSupervisionTasks(projectId)
      .then((t) => setTasks(projectId, t))
      .catch(() => {});
  }, [projectId, setTasks]);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
  };

  if (tasks.length === 0) return null;

  // Sort: active tasks first (running, queued, pending), then completed
  const sortedTasks = [...tasks].sort((a, b) => {
    const priority: Record<string, number> = {
      running: 0, planning: 1, queued: 2, pending: 3, proposed: 4,
      reviewing: 4, approved: 5, merge_conflict: 6, blocked: 7,
      completed: 8, integrated: 8, failed: 9, rejected: 10, cancelled: 11,
    };
    return (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
  });

  return (
    <div className="border-b border-border bg-secondary/30 flex-shrink-0">
      {/* Header */}
      <button
        onClick={toggleCollapse}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="font-medium">Tasks ({tasks.length})</span>
        {/* Quick status summary when collapsed */}
        {collapsed && (() => {
          const running = tasks.filter(t => t.status === 'running').length;
          const pending = tasks.filter(t => ['pending', 'queued', 'planning', 'proposed'].includes(t.status)).length;
          return (
            <span className="text-[10px] text-muted-foreground/70 ml-1">
              {running > 0 && `${running} running`}
              {running > 0 && pending > 0 && ', '}
              {pending > 0 && `${pending} pending`}
            </span>
          );
        })()}
      </button>

      {/* Cards */}
      {!collapsed && (
        <div className="px-3 pb-2 overflow-x-auto">
          <div className="flex gap-2">
            {sortedTasks.map((task) => (
              <TaskMiniCard key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskMiniCard({ task }: { task: SupervisionTask }) {
  const [loading, setLoading] = useState(false);
  const upsertTask = useSupervisionStore((s) => s.upsertTask);
  const badge = STATUS_BADGE[task.status] ?? { label: task.status, className: 'bg-gray-500/15 text-gray-400' };
  const hasSession = !!task.sessionId;
  const isActive = ['running', 'reviewing'].includes(task.status);
  const isEditable = ['pending', 'proposed', 'queued'].includes(task.status);
  const canRetry = task.status === 'failed';
  const canCancel = ['running', 'queued', 'pending', 'planning'].includes(task.status);
  const canRunNow = task.scheduleEnabled && ['completed', 'failed', 'cancelled'].includes(task.status);

  const handleOpen = async () => {
    setLoading(true);
    try {
      if (hasSession) {
        const sessions = await api.getSessions(task.projectId);
        useProjectStore.getState().setSessions(sessions);
        useProjectStore.getState().selectSession(task.sessionId!);
      } else {
        const { sessionId } = await api.openTaskSession(task.id);
        const sessions = await api.getSessions(task.projectId);
        useProjectStore.getState().setSessions(sessions);
        useProjectStore.getState().selectSession(sessionId);
      }
    } catch (err) {
      console.error('Failed to open task session:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (e: React.MouseEvent, action: 'retry' | 'cancel' | 'runNow') => {
    e.stopPropagation();
    setLoading(true);
    try {
      let updated: SupervisionTask;
      if (action === 'retry') updated = await api.retryTask(task.id);
      else if (action === 'cancel') updated = await api.cancelTask(task.id);
      else updated = await api.runTaskNow(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error(`Failed to ${action} task:`, err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-shrink-0 w-[160px] p-2 bg-background border border-border rounded-lg hover:border-border/80 transition-colors">
      {/* Status + indicators */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${badge.className}`}>
          {badge.label}
        </span>
        {task.status === 'running' && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        )}
        {task.status === 'planning' && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        )}
        {task.scheduleCron && (
          <span title={`Cron: ${task.scheduleCron}`}>
            <Clock size={10} className="text-muted-foreground" />
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-xs font-medium truncate mb-1.5" title={task.title}>
        {task.title}
      </p>

      {/* Actions */}
      <div className="flex gap-1">
        {/* Primary action: View/Edit */}
        <button
          onClick={handleOpen}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-secondary hover:bg-secondary/80 text-foreground flex-1 justify-center transition-colors disabled:opacity-50"
        >
          {loading ? (
            <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
          ) : isActive || hasSession ? (
            <>
              <Eye size={10} />
              View
            </>
          ) : isEditable ? (
            <>
              <Pencil size={10} />
              Edit
            </>
          ) : (
            <>
              <Eye size={10} />
              View
            </>
          )}
        </button>

        {/* Retry button */}
        {canRetry && (
          <button
            onClick={(e) => handleAction(e, 'retry')}
            disabled={loading}
            className="flex items-center justify-center w-6 py-0.5 text-[10px] rounded bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 transition-colors disabled:opacity-50"
            title="Retry"
          >
            <RotateCw size={10} />
          </button>
        )}

        {/* Run Now button */}
        {canRunNow && (
          <button
            onClick={(e) => handleAction(e, 'runNow')}
            disabled={loading}
            className="flex items-center justify-center w-6 py-0.5 text-[10px] rounded bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-colors disabled:opacity-50"
            title="Run now"
          >
            <Play size={10} />
          </button>
        )}

        {/* Cancel button */}
        {canCancel && (
          <button
            onClick={(e) => handleAction(e, 'cancel')}
            disabled={loading}
            className="flex items-center justify-center w-6 py-0.5 text-[10px] rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors disabled:opacity-50"
            title="Cancel"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
