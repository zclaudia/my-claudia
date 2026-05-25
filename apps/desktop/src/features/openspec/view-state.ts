// apps/desktop/src/features/openspec/view-state.ts
//
// Per-project view state for the OpenSpec tab. Lives in the Zustand store so
// users can switch projects without losing their current screen / filter /
// dialog selections.

export type OpenSpecScreen =
  | 'issues'
  | 'epic-detail'
  | 'sub-issue-detail'
  | 'corpus'
  | 'anonymous-management';

export type OpenSpecTypeFilter =
  | 'implement'
  | 'bug'
  | 'enhancement'
  | 'chore'
  | null;

export type OpenSpecArtifactTab = 'proposal' | 'design' | 'tasks' | 'delta';

export interface OpenSpecViewState {
  screen: OpenSpecScreen;
  /** Currently selected Epic (container). */
  selectedEpicId?: string;
  /** Currently selected sub-issue. */
  selectedSubIssueId?: string;
  /** Whether the anonymous sub-issues are expanded in the list (default false). */
  anonymousExpanded: boolean;
  /** Filter on issue type chip (null = all). */
  typeFilter?: OpenSpecTypeFilter;
  /** Active artifact tab on SubIssueDetailScreen. */
  activeArtifactTab: OpenSpecArtifactTab;
  /** When opened, the delta tab focuses this capability. */
  selectedDeltaCapability?: string;
  /** Show bootstrap dialog. */
  showInitializeSpecs: boolean;
  /** Show new-issue dialog. */
  showNewIssue: boolean;
  /** Show archive confirm dialog (for current sub-issue). */
  showArchiveConfirm: boolean;
  /** Editor/preview mode for artifact tabs. */
  previewMode: 'edit' | 'preview' | 'split';
}

export const INITIAL_VIEW_STATE: OpenSpecViewState = {
  screen: 'issues',
  anonymousExpanded: false,
  activeArtifactTab: 'proposal',
  showInitializeSpecs: false,
  showNewIssue: false,
  showArchiveConfirm: false,
  previewMode: 'edit',
};
