import { create } from 'zustand';
import type {
  Workflow,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowTemplate,
  WorkflowDefinition,
  WorkflowStepTypeMeta,
} from '@my-claudia/shared';
import {
  listWorkflows,
  createWorkflow as apiCreateWorkflow,
  updateWorkflow as apiUpdateWorkflow,
  deleteWorkflow as apiDeleteWorkflow,
  listWorkflowTemplates,
  createWorkflowFromTemplate,
  triggerWorkflow as apiTriggerWorkflow,
  listWorkflowRuns,
  getWorkflowRun,
  cancelWorkflowRun,
  approveWorkflowStep,
  rejectWorkflowStep,
  listWorkflowStepTypes,
} from '../services/api';

interface WorkflowState {
  /** projectId → workflows */
  workflows: Record<string, Workflow[]>;
  /** workflowId → runs */
  runs: Record<string, WorkflowRun[]>;
  /** runId → step runs */
  stepRuns: Record<string, WorkflowStepRun[]>;
  templates: WorkflowTemplate[];
  /** Available step types (builtin + plugin) */
  stepTypes: WorkflowStepTypeMeta[];

  // CRUD
  loadWorkflows: (projectId: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadStepTypes: () => Promise<void>;
  createWorkflow: (projectId: string, data: { name: string; description?: string; definition: WorkflowDefinition }) => Promise<Workflow>;
  updateWorkflow: (workflowId: string, projectId: string, data: Partial<Workflow>) => Promise<void>;
  deleteWorkflow: (workflowId: string, projectId: string) => Promise<void>;
  createFromTemplate: (projectId: string, templateId: string) => Promise<Workflow>;

  // Run operations
  triggerWorkflow: (workflowId: string) => Promise<WorkflowRun>;
  loadRuns: (workflowId: string) => Promise<void>;
  loadRun: (runId: string) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  approveStep: (stepRunId: string) => Promise<void>;
  rejectStep: (stepRunId: string) => Promise<void>;

  // WebSocket handlers
  upsertWorkflow: (projectId: string, workflow: Workflow) => void;
  removeWorkflow: (projectId: string, workflowId: string) => void;
  upsertRun: (projectId: string, run: WorkflowRun, stepRuns?: WorkflowStepRun[]) => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: {},
  runs: {},
  stepRuns: {},
  templates: [],
  stepTypes: [],

  loadWorkflows: async (projectId) => {
    const workflows = await listWorkflows(projectId);
    set((state) => ({ workflows: { ...state.workflows, [projectId]: workflows } }));
  },

  loadTemplates: async () => {
    const templates = await listWorkflowTemplates();
    set({ templates });
  },

  loadStepTypes: async () => {
    const stepTypes = await listWorkflowStepTypes();
    set({ stepTypes });
  },

  createWorkflow: async (projectId, data) => {
    const workflow = await apiCreateWorkflow(projectId, data);
    get().upsertWorkflow(projectId, workflow);
    return workflow;
  },

  updateWorkflow: async (workflowId, projectId, data) => {
    const workflow = await apiUpdateWorkflow(workflowId, data);
    get().upsertWorkflow(projectId, workflow);
  },

  deleteWorkflow: async (workflowId, projectId) => {
    await apiDeleteWorkflow(workflowId);
    get().removeWorkflow(projectId, workflowId);
  },

  createFromTemplate: async (projectId, templateId) => {
    const workflow = await createWorkflowFromTemplate(projectId, templateId);
    get().upsertWorkflow(projectId, workflow);
    return workflow;
  },

  triggerWorkflow: async (workflowId) => {
    const run = await apiTriggerWorkflow(workflowId);
    get().upsertRun(run.projectId, run);
    return run;
  },

  loadRuns: async (workflowId) => {
    const runs = await listWorkflowRuns(workflowId);
    set((state) => ({ runs: { ...state.runs, [workflowId]: runs } }));
  },

  loadRun: async (runId) => {
    const { run, stepRuns } = await getWorkflowRun(runId);
    set((state) => ({
      runs: {
        ...state.runs,
        [run.workflowId]: [
          run,
          ...(state.runs[run.workflowId] ?? []).filter((r) => r.id !== run.id),
        ],
      },
      stepRuns: { ...state.stepRuns, [runId]: stepRuns },
    }));
  },

  cancelRun: async (runId) => {
    await cancelWorkflowRun(runId);
  },

  approveStep: async (stepRunId) => {
    await approveWorkflowStep(stepRunId);
  },

  rejectStep: async (stepRunId) => {
    await rejectWorkflowStep(stepRunId);
  },

  // ── WebSocket handlers ──────────────────────────────────────

  upsertWorkflow: (projectId, workflow) =>
    set((state) => {
      const existing = state.workflows[projectId] ?? [];
      const idx = existing.findIndex((w) => w.id === workflow.id);
      const updated = idx >= 0
        ? existing.map((w, i) => (i === idx ? workflow : w))
        : [workflow, ...existing];
      return { workflows: { ...state.workflows, [projectId]: updated } };
    }),

  removeWorkflow: (projectId, workflowId) =>
    set((state) => {
      const existing = state.workflows[projectId] ?? [];
      return { workflows: { ...state.workflows, [projectId]: existing.filter((w) => w.id !== workflowId) } };
    }),

  upsertRun: (_projectId, run, stepRuns) =>
    set((state) => {
      // Update runs
      const existingRuns = state.runs[run.workflowId] ?? [];
      const runIdx = existingRuns.findIndex((r) => r.id === run.id);
      const updatedRuns = runIdx >= 0
        ? existingRuns.map((r, i) => (i === runIdx ? run : r))
        : [run, ...existingRuns];

      const newState: Partial<WorkflowState> = {
        runs: { ...state.runs, [run.workflowId]: updatedRuns },
      };

      // Update step runs if provided
      if (stepRuns) {
        newState.stepRuns = { ...state.stepRuns, [run.id]: stepRuns };
      }

      return newState as WorkflowState;
    }),
}));
