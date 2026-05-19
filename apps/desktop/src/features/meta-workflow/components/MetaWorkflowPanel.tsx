// apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx
import React, { useEffect } from 'react';
import { useMetaWorkflowStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';
import * as api from '../api.js';
import { RequirementsScreen } from './RequirementsScreen.js';
import { PhaseGraphScreen } from './PhaseGraphScreen.js';
import { PhaseBoardScreen } from './PhaseBoardScreen.js';
import { PhaseDetailScreen } from './PhaseDetailScreen.js';
import { PromotionDialog } from './PromotionDialog.js';
import { ReusePoolScreen } from './ReusePoolScreen.js';

interface MetaWorkflowPanelProps {
  projectId: string;
  socket: { send: (msg: string) => void };
}

export function MetaWorkflowPanel({ projectId, socket }: MetaWorkflowPanelProps): React.ReactElement {
  const runs = useMetaWorkflowStore((s) => s.runs[projectId] ?? []);
  const view = useMetaWorkflowStore((s) => s.viewByProject[projectId] ?? INITIAL_VIEW_STATE);
  const setRuns = useMetaWorkflowStore((s) => s.setRuns);
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  // Load runs on mount + project change.
  useEffect(() => {
    let cancelled = false;
    api.listRuns(projectId).then((rs) => {
      if (!cancelled) setRuns(projectId, rs);
    }).catch((e) => console.error('[meta-workflow] listRuns failed', e));
    return () => { cancelled = true; };
  }, [projectId, setRuns]);

  const selectedRun = view.selectedRunId ? runs.find((r) => r.id === view.selectedRunId) : undefined;

  if (view.screen === 'reuse-pool') {
    return (
      <div className="meta-workflow-panel">
        <ReusePoolScreen projectId={projectId} />
      </div>
    );
  }

  if (view.screen === 'list' || !selectedRun) {
    return (
      <div className="meta-workflow-panel">
        <header className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Meta Workflow Runs</h2>
        </header>
        {runs.length === 0 ? (
          <div className="text-muted-foreground text-sm">No meta workflow runs yet. Click "New ▾ → Meta Workflow Run" above to start.</div>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id}
                  className="border border-border rounded-md p-3 cursor-pointer hover:bg-secondary"
                  onClick={() => patchView(projectId, {
                    selectedRunId: r.id,
                    screen: r.status === 'requirement_draft' || r.status === 'requirement_review'
                      ? 'requirements' : 'phase-board',
                  })}>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">Status: {r.status} · Reject count: {r.rejectCount}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // A run is selected — render the chosen screen.
  return (
    <div className="meta-workflow-panel">
      <BreadcrumbBar projectId={projectId} runTitle={selectedRun.title} screen={view.screen} />
      {view.screen === 'requirements'   && <RequirementsScreen projectId={projectId} run={selectedRun} socket={socket} />}
      {view.screen === 'phase-graph'    && <PhaseGraphScreen   projectId={projectId} run={selectedRun} socket={socket} />}
      {view.screen === 'phase-board'    && <PhaseBoardScreen   projectId={projectId} run={selectedRun} socket={socket} />}
      {view.screen === 'phase-detail'   && <PhaseDetailScreen  projectId={projectId} run={selectedRun} phaseId={view.selectedPhaseId} socket={socket} />}
      {view.screen === 'promotion'      && <PromotionDialog    projectId={projectId} run={selectedRun} poolItemId={view.promotingPoolItemId} socket={socket} />}
    </div>
  );
}

function BreadcrumbBar({ projectId, runTitle, screen }: { projectId: string; runTitle: string; screen: string }): React.ReactElement {
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  return (
    <nav className="text-sm text-muted-foreground mb-3 flex items-center gap-2">
      <button className="text-primary hover:underline"
              onClick={() => patchView(projectId, { screen: 'list', selectedRunId: undefined })}>
        ← All Runs
      </button>
      <span>/</span>
      <span className="font-medium text-foreground">{runTitle}</span>
      <span>/</span>
      <span className="capitalize text-foreground">{screen.replace('-', ' ')}</span>
    </nav>
  );
}
