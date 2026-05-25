// apps/desktop/src/features/openspec/components/OpenSpecPanel.tsx
//
// Top-level router for the OpenSpec tab. Reads the per-project view state and
// renders the appropriate screen. Task 5 wires the corpus screen + bootstrap
// dialog. Task 6 wires the NewIssue and Archive confirm dialogs as overlays.

import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import { INITIAL_VIEW_STATE } from '../view-state.js';
import { IssueListScreen } from './IssueListScreen.js';
import { EpicDetailScreen } from './EpicDetailScreen.js';
import { SubIssueDetailScreen } from './SubIssueDetailScreen.js';
import { SpecCorpusScreen } from './SpecCorpusScreen.js';
import { InitializeSpecsDialog } from './InitializeSpecsDialog.js';
import { NewIssueDialog } from './NewIssueDialog.js';
import { ArchiveConfirmDialog } from './ArchiveConfirmDialog.js';
import { AnonymousManagementPanel } from './AnonymousManagementPanel.js';

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

  const dialogs = (
    <>
      {view.showNewIssue && (
        <NewIssueDialog
          projectId={projectId}
          parentEpicId={view.selectedEpicId}
          onClose={() =>
            patchView(projectId, { showNewIssue: false, selectedEpicId: undefined })
          }
        />
      )}
      {view.showArchiveConfirm && view.selectedSubIssueId && (
        <ArchiveConfirmDialog
          projectId={projectId}
          subIssueId={view.selectedSubIssueId}
          onClose={() => patchView(projectId, { showArchiveConfirm: false })}
        />
      )}
    </>
  );

  if (view.screen === 'epic-detail' && view.selectedEpicId) {
    return (
      <>
        <EpicDetailScreen projectId={projectId} epicId={view.selectedEpicId} />
        {dialogs}
      </>
    );
  }
  if (view.screen === 'sub-issue-detail' && view.selectedSubIssueId) {
    return (
      <>
        <SubIssueDetailScreen projectId={projectId} subIssueId={view.selectedSubIssueId} />
        {dialogs}
      </>
    );
  }
  if (view.screen === 'anonymous-management') {
    return (
      <>
        <AnonymousManagementPanel projectId={projectId} />
        {dialogs}
      </>
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
        {dialogs}
      </>
    );
  }
  return (
    <>
      <IssueListScreen projectId={projectId} />
      {dialogs}
    </>
  );
}
