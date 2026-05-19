// apps/desktop/src/features/meta-workflow/view-state.ts

/**
 * The 5 screens a user can be on within a Meta Workflow Run.
 * Plus 'list' for the top-level "all runs in this project" view.
 */
export type MetaWorkflowScreen =
  | 'list'             // runs list (default for a project with no active run)
  | 'requirements'     // requirements dialog + approve/reject/challenge
  | 'phase-graph'      // phasesJson visualization + edit
  | 'phase-board'      // phase cards grid
  | 'phase-detail'     // single-phase drilldown
  | 'promotion'        // promotion dialog (modal over board)
  | 'reuse-pool';      // reusable pool browser

export interface MetaWorkflowViewState {
  screen: MetaWorkflowScreen;
  selectedRunId?: string;
  selectedPhaseId?: string;
  /** When the user opens a promotion dialog, this holds the pool item id. */
  promotingPoolItemId?: string;
  /** Filters active on the reuse-pool screen. */
  poolFilters?: { phaseType?: string; search?: string };
}

export const INITIAL_VIEW_STATE: MetaWorkflowViewState = {
  screen: 'list',
};
