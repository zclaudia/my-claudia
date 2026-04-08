import { create } from 'zustand';
import type { ProjectDashboardView } from './projectStore';

interface SelectionState {
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  dashboardViews: Record<string, ProjectDashboardView>;

  setSelectedProjectId: (projectId: string | null) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  setDashboardView: (projectId: string, view: ProjectDashboardView) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedProjectId: null,
  selectedSessionId: null,
  dashboardViews: {},

  setSelectedProjectId: (selectedProjectId) => set((state) => (
    state.selectedProjectId === selectedProjectId ? state : { selectedProjectId }
  )),

  setSelectedSessionId: (selectedSessionId) => set((state) => (
    state.selectedSessionId === selectedSessionId ? state : { selectedSessionId }
  )),

  setDashboardView: (projectId, view) => set((state) => ({
    dashboardViews: {
      ...state.dashboardViews,
      [projectId]: view,
    },
  })),
}));
