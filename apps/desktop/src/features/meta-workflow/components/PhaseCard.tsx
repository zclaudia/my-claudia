// apps/desktop/src/features/meta-workflow/components/PhaseCard.tsx
import React from 'react';
import type { MetaWorkflowPhase } from '@my-claudia/shared/features/meta-workflow';
import {
  sendRunPhase,
  sendRerunPhase,
  sendIgnoreStale,
  sendEvaluateImpact,
  sendCascadeRerun,
} from '../api.js';

interface Props {
  runId: string;
  phase: MetaWorkflowPhase;
  socket: { send: (msg: string) => void };
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  searching_reuse: 'bg-blue-100 text-blue-700',
  generating: 'bg-blue-200 text-blue-800',
  ready_to_run: 'bg-yellow-100 text-yellow-700',
  running: 'bg-yellow-300 text-yellow-900',
  verifying_gates: 'bg-orange-200 text-orange-900',
  done: 'bg-green-100 text-green-800',
  failed: 'bg-red-200 text-red-900',
  stale: 'bg-purple-200 text-purple-900',
};

export function PhaseCard({ runId, phase, socket, onClick }: Props): React.ReactElement {
  const colorClass = STATUS_COLORS[phase.status] ?? 'bg-gray-100';
  const canRun = phase.status === 'pending';
  const canRerun = phase.status === 'done' || phase.status === 'failed' || phase.status === 'stale';
  const isStale = phase.status === 'stale';

  return (
    <div className="border rounded p-4 hover:shadow cursor-pointer" onClick={onClick}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium">{phase.phaseId}</div>
          <div className="text-xs text-gray-500">{phase.phaseType} · {phase.executeEntity}</div>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-mono ${colorClass}`}>{phase.status}</span>
      </div>
      <div className="text-xs text-gray-500 mb-3">
        attempt {phase.attempt}/{phase.maxRetries}
      </div>
      <div className="flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {canRun && (
          <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
                  onClick={() => sendRunPhase(socket, { runId, phaseId: phase.phaseId })}>
            Run
          </button>
        )}
        {canRerun && (
          <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
                  onClick={() => sendRerunPhase(socket, { runId, phaseId: phase.phaseId })}>
            Re-run
          </button>
        )}
        {isStale && (
          <button className="px-2 py-1 text-xs bg-gray-200 rounded"
                  onClick={() => sendIgnoreStale(socket, { runId, phaseId: phase.phaseId })}>
            Ignore Stale
          </button>
        )}
        {canRerun && (
          <button className="px-2 py-1 text-xs bg-purple-200 text-purple-900 rounded"
                  onClick={() => sendEvaluateImpact(socket, { runId, phaseId: phase.phaseId })}>
            Evaluate
          </button>
        )}
        {canRerun && (
          <button className="px-2 py-1 text-xs bg-orange-200 text-orange-900 rounded"
                  onClick={() => sendCascadeRerun(socket, { runId, phaseId: phase.phaseId })}>
            Cascade
          </button>
        )}
      </div>
    </div>
  );
}
