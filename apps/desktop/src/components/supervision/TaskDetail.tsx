import { CheckCircle, XCircle, AlertTriangle, X, FileText } from 'lucide-react';
import type { SupervisionTask } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';

interface TaskDetailProps {
  task: SupervisionTask;
  onClose: () => void;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  proposed: { label: 'Proposed', color: 'bg-purple-500/10 text-purple-500' },
  pending: { label: 'Pending', color: 'bg-blue-500/10 text-blue-500' },
  queued: { label: 'Queued', color: 'bg-cyan-500/10 text-cyan-500' },
  running: { label: 'Running', color: 'bg-green-500/10 text-green-500' },
  reviewing: { label: 'Reviewing', color: 'bg-yellow-500/10 text-yellow-500' },
  approved: { label: 'Approved', color: 'bg-green-500/10 text-green-600' },
  integrated: { label: 'Integrated', color: 'bg-emerald-600/10 text-emerald-600' },
  rejected: { label: 'Rejected', color: 'bg-red-500/10 text-red-500' },
  merge_conflict: { label: 'Conflict', color: 'bg-orange-500/10 text-orange-500' },
  blocked: { label: 'Blocked', color: 'bg-gray-500/10 text-gray-400' },
  failed: { label: 'Failed', color: 'bg-red-600/10 text-red-600' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-500/10 text-gray-500' },
};

export function TaskDetail({ task, onClose }: TaskDetailProps) {
  const upsertTask = useSupervisionStore((s) => s.upsertTask);
  const status = statusConfig[task.status] ?? { label: task.status, color: 'bg-gray-500/10 text-gray-400' };

  const handleAction = async (action: () => Promise<SupervisionTask>) => {
    try {
      const updated = await action();
      upsertTask(task.projectId, updated);
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-md z-40 bg-card border-l border-border shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full shrink-0 ${status.color}`}>
            {status.label}
          </span>
          <h3 className="text-sm font-semibold truncate">{task.title}</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Description */}
        <section>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Description</h4>
          <p className="text-sm whitespace-pre-wrap">{task.description || 'No description'}</p>
        </section>

        {/* Meta */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-xs text-muted-foreground">Source</span>
            <p className="text-sm">{task.source === 'user' ? 'User' : 'Agent'}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Priority</span>
            <p className="text-sm">{task.priority}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Attempt</span>
            <p className="text-sm">{task.attempt} / {task.maxRetries + 1}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Dependencies</span>
            <p className="text-sm">{task.dependencies.length > 0 ? task.dependencies.join(', ') : 'None'}</p>
          </div>
        </section>

        {/* Acceptance criteria */}
        {task.acceptanceCriteria.length > 0 && (
          <section>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Acceptance Criteria</h4>
            <ul className="space-y-1">
              {task.acceptanceCriteria.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground text-xs mt-0.5">{i + 1}.</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Scope */}
        {task.scope && task.scope.length > 0 && (
          <section>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Scope</h4>
            <div className="flex flex-wrap gap-1">
              {task.scope.map((s, i) => (
                <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-secondary rounded">
                  <FileText size={10} /> {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Result */}
        {task.result && (
          <section>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Result</h4>
            <div className="bg-secondary/50 rounded p-3 space-y-2">
              <p className="text-sm">{task.result.summary}</p>
              {task.result.filesChanged.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">Files changed:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {task.result.filesChanged.map((f, i) => (
                      <span key={i} className="text-xs bg-secondary px-1.5 py-0.5 rounded">{f}</span>
                    ))}
                  </div>
                </div>
              )}
              {task.result.workflowOutputs && task.result.workflowOutputs.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">Workflow outputs:</span>
                  {task.result.workflowOutputs.map((w, i) => (
                    <div key={i} className="mt-1 text-xs">
                      <span className={w.success ? 'text-green-500' : 'text-red-500'}>
                        {w.success ? 'PASS' : 'FAIL'}
                      </span>{' '}
                      <span className="text-muted-foreground">{w.action}</span>
                      {w.output && (
                        <pre className="mt-0.5 bg-secondary p-1.5 rounded overflow-x-auto text-[11px] max-h-20 overflow-y-auto">
                          {w.output}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Review notes */}
        {task.result?.reviewNotes && (
          <section>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Review Notes</h4>
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded p-3">
              <p className="text-sm whitespace-pre-wrap">{task.result.reviewNotes}</p>
            </div>
          </section>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        {task.status === 'proposed' && (
          <>
            <button
              onClick={() => handleAction(() => api.approveSupervisionTask(task.id))}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded"
            >
              <CheckCircle size={14} /> Approve
            </button>
            <button
              onClick={() => handleAction(() => api.rejectSupervisionTask(task.id))}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded"
            >
              <XCircle size={14} /> Reject
            </button>
          </>
        )}
        {task.status === 'reviewing' && task.result?.reviewVerdict && (
          <>
            <button
              onClick={() => handleAction(() => api.approveSupervisionTaskResult(task.id))}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded"
            >
              <CheckCircle size={14} /> Approve Result
            </button>
            <button
              onClick={() => handleAction(() => api.rejectSupervisionTaskResult(task.id, 'Rejected by user'))}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded"
            >
              <XCircle size={14} /> Reject Result
            </button>
          </>
        )}
        {task.status === 'merge_conflict' && (
          <button
            onClick={() => handleAction(() => api.resolveSupervisionConflict(task.id))}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 rounded"
          >
            <AlertTriangle size={14} /> Resolve Conflict
          </button>
        )}
      </div>
    </div>
  );
}
