// apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx
//
// Top-level router for the OpenSpec tab. Reads the per-project view state and
// renders the appropriate screen. For Task 2 only IssueListScreen is fully
// implemented; FeatureDetail / SubIssueDetail (Task 3) and Corpus (Task 5)
// are stubbed.

import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';
import { IssueListScreen } from './IssueListScreen.js';

interface Props {
  projectId: string;
}

export function OpenSpecPanel({ projectId }: Props): React.ReactElement {
  const view = useOpenSpecStore((s) => s.viewByProject[projectId] ?? INITIAL_VIEW_STATE);

  useEffect(() => {
    // Initial issue load handled inside IssueListScreen (Task 7 wires this).
  }, [projectId]);

  // Detail screens come in Task 3; for now route only the list + corpus.
  // We add stubs for routes that don't have components yet so we don't blow up.
  if (view.screen === 'feature-detail' || view.screen === 'sub-issue-detail') {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Detail screen (Task 3 stub). selectedFeatureId={String(view.selectedFeatureId)}{' '}
        selectedSubIssueId={String(view.selectedSubIssueId)}
      </div>
    );
  }
  if (view.screen === 'corpus') {
    return (
      <div className="p-4 text-sm text-muted-foreground">Spec Corpus (Task 5 stub).</div>
    );
  }
  return <IssueListScreen projectId={projectId} />;
}
