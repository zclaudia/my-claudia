// apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx
//
// Top-level router for the OpenSpec tab. Reads the per-project view state and
// renders the appropriate screen. Task 3 wires the feature-detail and
// sub-issue-detail routes to the real screens. Corpus (Task 5) is still
// stubbed.

import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';
import { IssueListScreen } from './IssueListScreen.js';
import { FeatureIssueDetailScreen } from './FeatureIssueDetailScreen.js';
import { SubIssueDetailScreen } from './SubIssueDetailScreen.js';

interface Props {
  projectId: string;
}

export function OpenSpecPanel({ projectId }: Props): React.ReactElement {
  const view = useOpenSpecStore((s) => s.viewByProject[projectId] ?? INITIAL_VIEW_STATE);

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
    return (
      <div className="p-4 text-sm text-muted-foreground">Spec Corpus (Task 5 stub).</div>
    );
  }
  return <IssueListScreen projectId={projectId} />;
}
