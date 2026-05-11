/**
 * Standalone window that shows the AI review process for a single permission request.
 *
 * Backed by the workflow run that handled the permission escalation
 * (`GET /api/workflow-runs/:runId`). Renders the run summary and a card for each step
 * (input / output / error / duration), with the `ai_risk_analysis` step highlighted.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Bot } from 'lucide-react';
import type { WorkflowRun, WorkflowStepRun } from '@my-claudia/shared';
import { StepStatusIcon, RunStatusBadge, formatDuration } from '../workflows/components/RunComponents';

interface AIReviewLogsWindowProps {
  runId: string;
  serverUrl: string;
  authToken: string;
  serverName?: string;
}

interface RunDetail {
  run: WorkflowRun;
  stepRuns: WorkflowStepRun[];
}

const AI_REVIEW_STEP_TYPE = 'ai_risk_analysis';

function formatTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString();
}

function StepCard({ step, highlight }: { step: WorkflowStepRun; highlight: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/40'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <StepStatusIcon status={step.status} />
          <span className="text-sm font-medium truncate">{step.stepId}</span>
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
            {step.stepType}
          </span>
          {highlight && (
            <span className="text-[10px] text-primary px-1.5 py-0.5 rounded bg-primary/10 flex items-center gap-1">
              <Bot size={10} />
              AI review
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground shrink-0">
          {step.startedAt ? formatDuration(step.startedAt, step.completedAt) : ''}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground mb-2">
        <div>Started: <span className="text-foreground">{formatTime(step.startedAt)}</span></div>
        <div>Completed: <span className="text-foreground">{formatTime(step.completedAt)}</span></div>
        {step.attempt > 1 && <div>Attempt: <span className="text-foreground">{step.attempt}</span></div>}
        {step.sessionId && (
          <div className="truncate">
            Session: <code className="text-foreground bg-muted px-1 rounded">{step.sessionId}</code>
          </div>
        )}
      </div>

      {step.error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded p-2 mb-2 whitespace-pre-wrap break-words">
          {step.error}
        </div>
      )}

      {step.input && Object.keys(step.input).length > 0 && (
        <details className="mb-2" open={highlight}>
          <summary className="text-[11px] font-medium text-muted-foreground cursor-pointer">Input</summary>
          <pre className="mt-1 p-2 rounded bg-muted text-foreground overflow-x-auto max-h-64 text-[11px] leading-relaxed">
            {JSON.stringify(step.input, null, 2)}
          </pre>
        </details>
      )}

      {step.output && Object.keys(step.output).length > 0 && (
        <details open={highlight}>
          <summary className="text-[11px] font-medium text-muted-foreground cursor-pointer">Output</summary>
          <pre className="mt-1 p-2 rounded bg-muted text-foreground overflow-x-auto max-h-64 text-[11px] leading-relaxed">
            {JSON.stringify(step.output, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export function AIReviewLogsWindow({ runId, serverUrl, authToken, serverName }: AIReviewLogsWindowProps) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!serverUrl) {
      setError('Missing server URL');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = authToken;
      const resp = await fetch(`${serverUrl}/api/workflow-runs/${encodeURIComponent(runId)}`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.success || !json.data) {
        throw new Error(json.error?.message || 'Failed to load run');
      }
      setDetail(json.data as RunDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runId, serverUrl, authToken]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // Auto-refresh while the run is still in flight.
  useEffect(() => {
    if (!detail) return;
    if (detail.run.status === 'completed' || detail.run.status === 'failed' || detail.run.status === 'cancelled') return;
    const handle = setInterval(() => { void fetchDetail(); }, 2000);
    return () => clearInterval(handle);
  }, [detail, fetchDetail]);

  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border" data-tauri-drag-region>
        <div className="flex items-center gap-2 min-w-0">
          <Bot size={14} className="text-primary shrink-0" />
          <span className="text-sm font-medium truncate">AI Review Logs</span>
          {serverName && (
            <span className="text-[11px] text-muted-foreground truncate">· {serverName}</span>
          )}
          {detail?.run && <RunStatusBadge status={detail.run.status} />}
        </div>
        <button
          onClick={() => void fetchDetail()}
          className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && !detail && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded p-3">{error}</div>
        )}

        {detail && (
          <>
            <div className="rounded-lg border border-border bg-card/40 p-3 text-xs space-y-1">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <div>Run ID: <code className="text-foreground bg-muted px-1 rounded">{detail.run.id}</code></div>
                <div>Workflow: <code className="text-foreground bg-muted px-1 rounded">{detail.run.workflowId}</code></div>
                <div>Trigger: <span className="text-foreground">{detail.run.triggerSource}</span></div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                <div>Started: <span className="text-foreground">{formatTime(detail.run.startedAt)}</span></div>
                <div>Completed: <span className="text-foreground">{formatTime(detail.run.completedAt)}</span></div>
                {detail.run.startedAt && (
                  <div>Duration: <span className="text-foreground">{formatDuration(detail.run.startedAt, detail.run.completedAt)}</span></div>
                )}
                {detail.run.currentStepId && (
                  <div>Current: <code className="text-foreground bg-muted px-1 rounded">{detail.run.currentStepId}</code></div>
                )}
              </div>
              {detail.run.triggerDetail && (
                <div className="text-muted-foreground">Trigger detail: <span className="text-foreground">{detail.run.triggerDetail}</span></div>
              )}
              {detail.run.error && (
                <div className="text-destructive mt-2 whitespace-pre-wrap break-words">{detail.run.error}</div>
              )}
            </div>

            <div className="space-y-2">
              {detail.stepRuns.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">
                  No steps recorded yet.
                </div>
              ) : (
                detail.stepRuns.map((step) => (
                  <StepCard key={step.id} step={step} highlight={step.stepType === AI_REVIEW_STEP_TYPE} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
