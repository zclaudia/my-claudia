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
  pending: 'bg-secondary text-muted-foreground',
  searching_reuse: 'bg-blue-500/10 text-blue-500',
  generating: 'bg-blue-500/15 text-blue-600',
  ready_to_run: 'bg-yellow-500/10 text-yellow-600',
  running: 'bg-yellow-500/15 text-yellow-600',
  verifying_gates: 'bg-orange-500/10 text-orange-500',
  done: 'bg-green-500/10 text-green-600',
  failed: 'bg-red-500/10 text-red-500',
  stale: 'bg-purple-500/10 text-purple-500',
};

export function PhaseCard({ runId, phase, socket, onClick }: Props): React.ReactElement {
  const colorClass = STATUS_COLORS[phase.status] ?? 'bg-secondary text-muted-foreground';
  const canRun = phase.status === 'pending';
  const canRerun = phase.status === 'done' || phase.status === 'failed' || phase.status === 'stale';
  const isStale = phase.status === 'stale';

  return (
    <div className="border border-border rounded-lg p-4 hover:shadow-sm hover:bg-secondary/30 cursor-pointer transition-colors" onClick={onClick}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium">{phase.phaseId}</div>
          <div className="text-xs text-muted-foreground">{phase.phaseType} · {phase.executeEntity}</div>
        </div>
        <span className={`px-2 py-1 rounded-md text-xs font-mono ${colorClass}`}>{phase.status}</span>
      </div>
      <div className="text-xs text-muted-foreground mb-3">
        attempt {phase.attempt}/{phase.maxRetries}
      </div>
      <div className="flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {canRun && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => sendRunPhase(socket, { runId, phaseId: phase.phaseId })}>
            Run
          </button>
        )}
        {canRerun && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => sendRerunPhase(socket, { runId, phaseId: phase.phaseId })}>
            Re-run
          </button>
        )}
        {isStale && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
                  onClick={() => sendIgnoreStale(socket, { runId, phaseId: phase.phaseId })}>
            Ignore Stale
          </button>
        )}
        {canRerun && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-purple-500/15 text-purple-600 hover:bg-purple-500/25"
                  onClick={() => sendEvaluateImpact(socket, { runId, phaseId: phase.phaseId })}>
            Evaluate
          </button>
        )}
        {canRerun && (
          <button className="px-2.5 py-1 text-xs rounded-md bg-orange-500/15 text-orange-600 hover:bg-orange-500/25"
                  onClick={() => sendCascadeRerun(socket, { runId, phaseId: phase.phaseId })}>
            Cascade
          </button>
        )}
      </div>
    </div>
  );
}
