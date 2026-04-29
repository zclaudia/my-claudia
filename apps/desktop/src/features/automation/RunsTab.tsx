import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw, ArrowLeft } from 'lucide-react';
import type { Workflow, WorkflowRun, WorkflowStepRun } from '@my-claudia/shared';
import { StepRunCard, RunStatusBadge, formatDuration } from '../workflows/components/RunComponents';
import type { AutomationApiType } from './useAutomationApi';
import type { ProjectInfo } from './automation-types';
import { renderProjectOptions } from './automation-types';

interface RunsTabProps {
  api: AutomationApiType;
  projects: ProjectInfo[];
}

export function RunsTab({ api, projects }: RunsTabProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const effectiveProjectId = selectedProjectId || projects[0]?.id || '';

  const workflowNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workflows) map.set(w.id, w.name);
    return map;
  }, [workflows]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = effectiveProjectId ? `?projectId=${encodeURIComponent(effectiveProjectId)}` : '';
      const [runsData, workflowsData] = await Promise.all([
        api.get(`/api/workflow-runs${query}`).catch(() => []),
        api.get(`/api/workflows${query}`).catch(() => []),
      ]);
      setRuns(runsData);
      setWorkflows(workflowsData);
    } catch { /* ignore */ }
    setLoading(false);
  }, [api, effectiveProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (selectedRunId) {
    return (
      <RunDetail
        api={api}
        runId={selectedRunId}
        workflowName={(() => {
          const run = runs.find(r => r.id === selectedRunId);
          return run ? (workflowNameMap.get(run.workflowId) || run.workflowId.slice(0, 12)) : '';
        })()}
        onBack={() => setSelectedRunId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Run History</h2>
        <div className="flex items-center gap-2">
          {projects.length > 0 && (
            <select
              value={effectiveProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              {renderProjectOptions(projects)}
            </select>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && runs.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No workflow runs found for this project.
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <button
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              className="w-full text-left border border-border rounded-lg p-3 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <RunStatusBadge status={run.status} />
                  <span className="text-sm font-medium truncate">
                    {workflowNameMap.get(run.workflowId) || run.workflowId.slice(0, 12)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  <span className="px-1.5 py-0.5 rounded bg-muted">{run.triggerSource}</span>
                  <span>{formatDuration(run.startedAt, run.completedAt)}</span>
                  <span>{new Date(run.startedAt).toLocaleString()}</span>
                </div>
              </div>
              {run.error && (
                <div className="mt-1 text-xs text-destructive truncate">{run.error}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RunDetail({
  api,
  runId,
  workflowName,
  onBack,
}: {
  api: AutomationApiType;
  runId: string;
  workflowName: string;
  onBack: () => void;
}) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [stepRuns, setStepRuns] = useState<WorkflowStepRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/workflow-runs/${runId}`).then((data: { run: WorkflowRun; stepRuns: WorkflowStepRun[] }) => {
      setRun(data.run);
      setStepRuns(data.stepRuns);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [api, runId]);

  if (loading || !run) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="text-sm font-medium">{workflowName}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <RunStatusBadge status={run.status} />
              <span>{run.triggerSource}{run.triggerDetail ? ` · ${run.triggerDetail}` : ''}</span>
              <span>{formatDuration(run.startedAt, run.completedAt)}</span>
              <span>{new Date(run.startedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        {(run.status === 'running' || run.status === 'pending') && (
          <button
            onClick={() => { api.post(`/api/workflow-runs/${runId}/cancel`).catch(() => {}); }}
            className="px-3 py-1 text-xs rounded-md border border-border hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {stepRuns.map((stepRun) => (
          <StepRunCard
            key={stepRun.id}
            stepRun={stepRun}
            onApprove={(id) => { api.post(`/api/workflow-step-runs/${id}/approve`).catch(() => {}); }}
            onReject={(id) => { api.post(`/api/workflow-step-runs/${id}/reject`).catch(() => {}); }}
          />
        ))}
        {stepRuns.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">No steps recorded</div>
        )}
      </div>

      {run.error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded p-3">{run.error}</div>
      )}
    </div>
  );
}
