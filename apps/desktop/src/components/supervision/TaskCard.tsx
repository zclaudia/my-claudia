import type { SupervisionTask, TaskStatus } from '@my-claudia/shared';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';

interface TaskCardProps {
  task: SupervisionTask;
  onSelect: (task: SupervisionTask) => void;
}

const statusConfig: Record<TaskStatus, { label: string; color: string }> = {
  proposed: { label: 'Proposed', color: 'bg-purple-500/10 text-purple-500' },
  pending: { label: 'Pending', color: 'bg-blue-500/10 text-blue-500' },
  queued: { label: 'Queued', color: 'bg-cyan-500/10 text-cyan-500' },
  planning: { label: 'Planning', color: 'bg-blue-500/10 text-blue-500' },
  running: { label: 'Running', color: 'bg-green-500/10 text-green-500' },
  completed: { label: 'Completed', color: 'bg-emerald-600/10 text-emerald-600' },
  reviewing: { label: 'Reviewing', color: 'bg-yellow-500/10 text-yellow-500' },
  approved: { label: 'Approved', color: 'bg-green-500/10 text-green-600' },
  integrated: { label: 'Integrated', color: 'bg-emerald-600/10 text-emerald-600' },
  rejected: { label: 'Rejected', color: 'bg-red-500/10 text-red-500' },
  merge_conflict: { label: 'Conflict', color: 'bg-orange-500/10 text-orange-500' },
  blocked: { label: 'Blocked', color: 'bg-gray-500/10 text-gray-400' },
  failed: { label: 'Failed', color: 'bg-red-600/10 text-red-600' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-500/10 text-gray-500' },
};

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const upsertTask = useSupervisionStore((s) => s.upsertTask);
  const status = statusConfig[task.status] ?? { label: task.status, color: 'bg-gray-500/10 text-gray-400' };

  const handleApproveProposed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.approveSupervisionTask(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to approve task:', err);
    }
  };

  const handleRejectProposed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.rejectSupervisionTask(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to reject task:', err);
    }
  };

  const handleApproveResult = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.approveSupervisionTaskResult(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to approve result:', err);
    }
  };

  const handleRejectResult = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.rejectSupervisionTaskResult(task.id, 'Rejected by user');
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to reject result:', err);
    }
  };

  const handleResolveConflict = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.resolveSupervisionConflict(task.id);
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Failed to resolve conflict:', err);
    }
  };

  return (
    <div
      onClick={() => onSelect(task)}
      className="group px-3 py-2 bg-secondary/50 hover:bg-secondary rounded cursor-pointer border border-border/50 hover:border-border transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full shrink-0 ${status.color}`}>
              {status.label}
            </span>
            {task.status === 'running' && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
            )}
            {task.priority > 0 && (
              <span className="text-[10px] text-muted-foreground">P{task.priority}</span>
            )}
          </div>
          <p className="text-sm font-medium truncate">{task.title}</p>
          {task.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {task.attempt > 1 && (
              <span className="text-[10px] text-muted-foreground">Attempt {task.attempt}</span>
            )}
            {task.dependencies.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{task.dependencies.length} deps</span>
            )}
          </div>
        </div>
      </div>

      {/* Inline actions */}
      {task.status === 'proposed' && (
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={handleApproveProposed}
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded"
          >
            <CheckCircle size={12} /> Approve
          </button>
          <button
            onClick={handleRejectProposed}
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded"
          >
            <XCircle size={12} /> Reject
          </button>
        </div>
      )}

      {task.status === 'reviewing' && task.result?.reviewVerdict && (
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={handleApproveResult}
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded"
          >
            <CheckCircle size={12} /> Approve Result
          </button>
          <button
            onClick={handleRejectResult}
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded"
          >
            <XCircle size={12} /> Reject Result
          </button>
        </div>
      )}

      {task.status === 'merge_conflict' && (
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={handleResolveConflict}
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 rounded"
          >
            <AlertTriangle size={12} /> Resolve Conflict
          </button>
        </div>
      )}
    </div>
  );
}
