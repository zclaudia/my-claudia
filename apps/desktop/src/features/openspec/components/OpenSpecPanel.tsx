// apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx
//
// Top-level router for the OpenSpec tab. Reads the per-project view state and
// renders the appropriate screen. Task 5 wires the corpus screen + bootstrap
// dialog.

import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';
import { IssueListScreen } from './IssueListScreen.js';
import { FeatureIssueDetailScreen } from './FeatureIssueDetailScreen.js';
import { SubIssueDetailScreen } from './SubIssueDetailScreen.js';
import { SpecCorpusScreen } from './SpecCorpusScreen.js';
import { InitializeSpecsDialog } from './InitializeSpecsDialog.js';

interface Props {
  projectId: string;
}

export function OpenSpecPanel({ projectId }: Props): React.ReactElement {
  const view = useOpenSpecStore((s) => s.viewByProject[projectId] ?? INITIAL_VIEW_STATE);
  const corpus = useOpenSpecStore((s) => s.corpusByProject[projectId] ?? []);
  const patchView = useOpenSpecStore((s) => s.patchView);

  useEffect(() => {
    // Initial issue load handled inside IssueListScreen (Task 7 wires this).
  }, [projectId]);

  if (view.screen === 'feature-detail' && view.selectedFeatureId) {
    return (
      <FeatureIssueDetailScreen projectId={projectId} featureId={view.selectedFeatureId} />
    );
  }
  if (view.screen === 'sub-issue-detail' && view.selectedSubIssueId) {
    return (
      <SubIssueDetailScreen projectId={projectId} subIssueId={view.selectedSubIssueId} />
    );
  }
  if (view.screen === 'corpus') {
    const mode: 'initial' | 'rescan' = corpus.length === 0 ? 'initial' : 'rescan';
    return (
      <>
        <SpecCorpusScreen projectId={projectId} />
        {view.showInitializeSpecs && (
          <InitializeSpecsDialog
            projectId={projectId}
            mode={mode}
            onClose={() => patchView(projectId, { showInitializeSpecs: false })}
          />
        )}
      </>
    );
  }
  return <IssueListScreen projectId={projectId} />;
}
