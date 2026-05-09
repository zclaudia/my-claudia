/**
 * Shared presentational components for workflow run display.
 * Used by both WorkflowRunViewer (Zustand-based) and AutomationWindow RunsTab (direct API).
 */
import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, SkipForward, Pause, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import type { WorkflowStepRun } from '@my-claudia/shared';

export function StepStatusIcon({ status }: { status: string }) {
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

export function formatDuration(startedAt?: number, completedAt?: number): string {
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

export function RunStatusBadge({ status }: { status: string }) {
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

export function StepRunCard({ stepRun, onApprove, onReject }: {
  stepRun: WorkflowStepRun;
  onApprove?: (stepRunId: string) => void;
  onReject?: (stepRunId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <StepStatusIcon status={stepRun.status} />
          <span className="text-sm font-medium truncate">{stepRun.stepId}</span>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted">
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

      {stepRun.status === 'waiting' && onApprove && onReject && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onApprove(stepRun.id)}
            className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(stepRun.id)}
            className="px-3 py-1 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Reject
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-1">
          {stepRun.error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2">
              {stepRun.error}
            </div>
          )}
          {stepRun.output && Object.keys(stepRun.output).length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Output:</span>
              <pre className="mt-1 p-2 rounded-md bg-muted text-foreground overflow-x-auto max-h-32">
                {JSON.stringify(stepRun.output, null, 2)}
              </pre>
            </div>
          )}
          {stepRun.sessionId && (
            <div className="text-xs text-muted-foreground">
              Session: <code className="bg-muted px-1 rounded-md">{stepRun.sessionId}</code>
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
