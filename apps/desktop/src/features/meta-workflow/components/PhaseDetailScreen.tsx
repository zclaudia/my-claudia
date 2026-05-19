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
        <button className="text-sm text-blue-600 hover:underline"
                onClick={() => patchView(projectId, { screen: 'phase-board', selectedPhaseId: undefined })}>
          ← Back to Board
        </button>
        <div className="text-gray-500 mt-2">Phase not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <button className="text-sm text-blue-600 hover:underline"
              onClick={() => patchView(projectId, { screen: 'phase-board', selectedPhaseId: undefined })}>
        ← Back to Board
      </button>

      <div>
        <h3 className="text-xl font-semibold">{phase.phaseId}</h3>
        <div className="text-sm text-gray-600">
          {phase.phaseType} · {phase.executeEntity} · status:&nbsp;
          <span className="font-mono">{phase.status}</span> · attempt {phase.attempt}/{phase.maxRetries}
        </div>
      </div>

      {rec && (
        <div className="border border-purple-300 bg-purple-50 rounded p-3 text-sm">
          <div className="font-medium mb-1">Impact recommendation</div>
          <div>Kind: <span className="font-mono">{rec.kind}</span></div>
          <div className="text-gray-700">{rec.reason}</div>
        </div>
      )}

      <details className="border rounded p-3 text-sm">
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
        {phase.generatedWorkflowId && <div>Generated workflow: <code>{phase.generatedWorkflowId}</code></div>}
        {phase.generatedSubagentId && <div>Generated subagent:  <code>{phase.generatedSubagentId}</code></div>}
        {phase.reusedFromPoolId && <div>Reused from pool item: <code>{phase.reusedFromPoolId}</code></div>}
        {phase.currentRunId && <div>Current sub-workflow run: <code>{phase.currentRunId}</code></div>}
        {phase.staleSourcePhaseId && <div>Stale source phase: <code>{phase.staleSourcePhaseId}</code></div>}
      </div>

      <div className="flex flex-wrap gap-2">
        {phase.status === 'pending' && (
          <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                  onClick={() => sendRunPhase(socket, { runId: run.id, phaseId: phase.phaseId })}>
            Run
          </button>
        )}
        {(phase.status === 'done' || phase.status === 'failed' || phase.status === 'stale') && (
          <>
            <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                    onClick={() => sendRerunPhase(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Re-run
            </button>
            <button className="px-3 py-1 text-sm bg-purple-200 text-purple-900 rounded"
                    onClick={() => sendEvaluateImpact(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Evaluate Impact
            </button>
            <button className="px-3 py-1 text-sm bg-orange-200 text-orange-900 rounded"
                    onClick={() => sendCascadeRerun(socket, { runId: run.id, phaseId: phase.phaseId })}>
              Cascade Re-run
            </button>
          </>
        )}
        {phase.status === 'stale' && (
          <button className="px-3 py-1 text-sm bg-gray-200 rounded"
                  onClick={() => sendIgnoreStale(socket, { runId: run.id, phaseId: phase.phaseId })}>
            Ignore Stale
          </button>
        )}
      </div>
    </div>
  );
}
