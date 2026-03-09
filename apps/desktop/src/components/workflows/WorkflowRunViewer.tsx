import { useEffect } from 'react';
import { ArrowLeft, XCircle, CheckCircle2, Loader2, SkipForward, Pause, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import type { WorkflowStepRun } from '@my-claudia/shared';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useState } from 'react';

interface WorkflowRunViewerProps {
  runId: string;
  onBack: () => void;
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={16} className="text-green-500 shrink-0" />;
    case 'running':
      return <Loader2 size={16} className="text-primary animate-spin shrink-0" />;
    case 'failed':
      return <XCircle size={16} className="text-destructive shrink-0" />;
    case 'skipped':
      return <SkipForward size={16} className="text-muted-foreground shrink-0" />;
    case 'waiting':
      return <Pause size={16} className="text-yellow-500 shrink-0" />;
    default:
      return <Clock size={16} className="text-muted-foreground/40 shrink-0" />;
  }
}

function formatDuration(startedAt?: number, completedAt?: number): string {
  if (!startedAt) return '';
  const end = completedAt ?? Date.now();
  const ms = end - startedAt;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function StepRunCard({ stepRun }: { stepRun: WorkflowStepRun }) {
  const [expanded, setExpanded] = useState(false);
  const { approveStep, rejectStep } = useWorkflowStore();

  return (
    <div className="border border-border rounded-lg p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <StepStatusIcon status={stepRun.status} />
          <span className="text-sm font-medium truncate">{stepRun.stepId}</span>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
            {stepRun.stepType}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stepRun.startedAt && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(stepRun.startedAt, stepRun.completedAt)}
            </span>
          )}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {stepRun.status === 'waiting' && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => approveStep(stepRun.id)}
            className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => rejectStep(stepRun.id)}
            className="px-3 py-1 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Reject
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-1">
          {stepRun.error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
              {stepRun.error}
            </div>
          )}
          {stepRun.output && Object.keys(stepRun.output).length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Output:</span>
              <pre className="mt-1 p-2 rounded bg-muted text-foreground overflow-x-auto max-h-32">
                {JSON.stringify(stepRun.output, null, 2)}
              </pre>
            </div>
          )}
          {stepRun.sessionId && (
            <div className="text-xs text-muted-foreground">
              Session: <code className="bg-muted px-1 rounded">{stepRun.sessionId}</code>
            </div>
          )}
          {stepRun.attempt > 1 && (
            <div className="text-xs text-muted-foreground">Attempt: {stepRun.attempt}</div>
          )}
        </div>
      )}
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-primary/10 text-primary',
    completed: 'bg-green-500/10 text-green-600',
    failed: 'bg-destructive/10 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
    pending: 'bg-muted text-muted-foreground',
  };

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}

export function WorkflowRunViewer({ runId, onBack }: WorkflowRunViewerProps) {
  const { runs, stepRuns, loadRun, cancelRun } = useWorkflowStore();

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
          <button onClick={onBack} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
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
          <StepRunCard key={stepRun.id} stepRun={stepRun} />
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
