// apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx
import React from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import {
  sendRunPhase,
  sendRerunPhase,
  sendIgnoreStale,
  sendEvaluateImpact,
  sendCascadeRerun,
} from '../api.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  phaseId?: string;
  socket: { send: (msg: string) => void };
}

export function PhaseDetailScreen({ projectId, run, phaseId, socket }: Props): React.ReactElement {
  const phases = useMetaWorkflowStore((s) => s.phases[run.id] ?? []);
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  const rec = useMetaWorkflowStore((s) =>
    phaseId ? s.recommendations[`${run.id}:${phaseId}`] : undefined,
  );

  const phase = phases.find((p) => p.phaseId === phaseId);

  if (!phase) {
    return (
      <div>
        <button className="text-sm text-primary hover:underline"
                onClick={() => patchView(projectId, { screen: 'phase-board', selectedPhaseId: undefined })}>
          ← Back to Board
        </button>
        <div className="text-muted-foreground mt-2">Phase not found.</div>
      </div>
    );
  }

  const codeClass = 'px-1 py-0.5 rounded bg-muted font-mono text-xs';

  return (
    <div className="space-y-4 max-w-3xl">
      <button className="text-sm text-primary hover:underline"
              onClick={() => patchView(projectId, { screen: 'phase-board', selectedPhaseId: undefined })}>
        ← Back to Board
      </button>

      <div>
        <h3 className="text-xl font-semibold">{phase.phaseId}</h3>
        <div className="text-sm text-muted-foreground">
          {phase.phaseType} · {phase.executeEntity} · status:&nbsp;
          <span className="font-mono text-foreground">{phase.status}</span> · attempt {phase.attempt}/{phase.maxRetries}
        </div>
      </div>

      {rec && (
        <div className="border border-purple-500/30 bg-purple-500/10 rounded-md p-3 text-sm">
          <div className="font-medium mb-1">Impact recommendation</div>
          <div>Kind: <span className="font-mono">{rec.kind}</span></div>
          <div className="text-muted-foreground">{rec.reason}</div>
        </div>
      )}

      <details className="border border-border rounded-md p-3 text-sm bg-muted/30">
        <summary className="cursor-pointer font-medium">Inputs / Outputs / Gates snapshot</summary>
        <pre className="text-xs mt-2 overflow-auto">
          {JSON.stringify({
            inputs: phase.inputsSnapshot,
            outputs: phase.outputsSnapshot,
            gates: phase.gatesSnapshot,
          }, null, 2)}
        </pre>
      </details>

      <div className="space-y-1 text-sm">
        {phase.generatedWorkflowId && <div>Generated workflow: <code className={codeClass}>{phase.generatedWorkflowId}</code></div>}
        {phase.generatedSubagentId && <div>Generated subagent:  <code className={codeClass}>{phase.generatedSubagentId}</code></div>}
        {phase.reusedFromPoolId && <div>Reused from pool item: <code className={codeClass}>{phase.reusedFromPoolId}</code></div>}
        {phase.currentRunId && <div>Current sub-workflow run: <code className={codeClass}>{phase.currentRunId}</code></div>}
        {phase.staleSourcePhaseId && <div>Stale source phase: <code className={codeClass}>{phase.staleSourcePhaseId}</code></div>}
      </div>

      <div className="flex flex-wrap gap-2">
        {phase.status === 'pending' && (
          <button className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => sendRunPhase(socket, { runId: run.id, phaseId: phase.phaseId })}>
            Run
          </button>
        )}
        {(phase.status === 'done' || phase.status === 'failed' || phase.status === 'stale') && (
          <>
            <button className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => sendRerunPhase(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Re-run
            </button>
            <button className="px-3 py-1.5 text-sm rounded-md bg-purple-500/15 text-purple-600 hover:bg-purple-500/25"
                    onClick={() => sendEvaluateImpact(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Evaluate Impact
            </button>
            <button className="px-3 py-1.5 text-sm rounded-md bg-orange-500/15 text-orange-600 hover:bg-orange-500/25"
                    onClick={() => sendCascadeRerun(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Cascade Re-run
            </button>
          </>
        )}
        {phase.status === 'stale' && (
          <button className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80"
                  onClick={() => sendIgnoreStale(socket, { runId: run.id, phaseId: phase.phaseId })}>
            Ignore Stale
          </button>
        )}
      </div>
    </div>
  );
}
