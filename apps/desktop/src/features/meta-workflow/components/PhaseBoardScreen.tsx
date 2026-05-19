// apps/desktop/src/features/meta-workflow/components/PhaseBoardScreen.tsx
import React, { useEffect } from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';
import { PhaseCard } from './PhaseCard.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function PhaseBoardScreen({ projectId, run, socket }: Props): React.ReactElement {
  const phases = useMetaWorkflowStore((s) => s.phases[run.id] ?? []);
  const setPhases = useMetaWorkflowStore((s) => s.setPhases);
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  useEffect(() => {
    let cancelled = false;
    api.listPhases(run.id).then((ps) => {
      if (!cancelled) setPhases(run.id, ps);
    }).catch((e) => console.error('[meta-workflow] listPhases failed', e));
    return () => { cancelled = true; };
  }, [run.id, setPhases]);

  if (phases.length === 0) {
    return <div className="text-muted-foreground text-sm">No phases yet. Set the phases.json to instantiate them.</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Phases — {run.title}</h3>
        <button
          className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
          onClick={() => patchView(projectId, { screen: 'phase-graph' })}
        >
          View Graph
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {phases.map((p) => (
          <PhaseCard
            key={p.id}
            runId={run.id}
            phase={p}
            socket={socket}
            onClick={() => patchView(projectId, { screen: 'phase-detail', selectedPhaseId: p.phaseId })}
          />
        ))}
      </div>
    </div>
  );
}
