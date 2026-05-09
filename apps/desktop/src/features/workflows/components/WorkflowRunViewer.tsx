import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useWorkflowStore } from '../store';
import { StepRunCard, RunStatusBadge, formatDuration } from './RunComponents';

interface WorkflowRunViewerProps {
  runId: string;
  onBack: () => void;
}

export function WorkflowRunViewer({ runId, onBack }: WorkflowRunViewerProps) {
  const { runs, stepRuns, loadRun, cancelRun, approveStep, rejectStep } = useWorkflowStore();

  useEffect(() => {
    loadRun(runId);
  }, [runId, loadRun]);

  // Find the run across all workflow runs
  const run = Object.values(runs).flat().find((r) => r.id === runId);
  const currentStepRuns = stepRuns[runId] ?? [];

  if (!run) {
    return (
      <div className="flex flex-col h-full p-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="text-sm text-muted-foreground">Loading run...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="text-sm font-medium">Run {run.id.slice(0, 8)}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <RunStatusBadge status={run.status} />
              <span>{run.triggerSource}{run.triggerDetail ? ` (${run.triggerDetail})` : ''}</span>
              <span>{formatDuration(run.startedAt, run.completedAt)}</span>
            </div>
          </div>
        </div>
        {(run.status === 'running' || run.status === 'pending') && (
          <button
            onClick={() => cancelRun(runId)}
            className="px-3 py-1 text-xs rounded-md border border-border hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {currentStepRuns.map((stepRun) => (
          <StepRunCard
            key={stepRun.id}
            stepRun={stepRun}
            onApprove={(id) => approveStep(id)}
            onReject={(id) => rejectStep(id)}
          />
        ))}
        {currentStepRuns.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">No steps recorded</div>
        )}
      </div>

      {run.error && (
        <div className="p-3 border-t border-border bg-destructive/5">
          <div className="text-xs text-destructive">{run.error}</div>
        </div>
      )}
    </div>
  );
}
