import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkflowStore } from '../workflowStore';

vi.mock('../../services/api', () => ({
  listWorkflows: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  listWorkflowTemplates: vi.fn(),
  createWorkflowFromTemplate: vi.fn(),
  triggerWorkflow: vi.fn(),
  listWorkflowRuns: vi.fn(),
  getWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  approveWorkflowStep: vi.fn(),
  rejectWorkflowStep: vi.fn(),
  listWorkflowStepTypes: vi.fn(),
}));

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
} from '../../services/api';

const mockWorkflow = (id: string, projectId = 'proj-1') => ({
  id,
  projectId,
  name: `Workflow ${id}`,
  description: '',
  definition: { steps: [] },
  createdAt: 1000,
  updatedAt: 2000,
});

const mockRun = (id: string, workflowId: string, projectId = 'proj-1') => ({
  id,
  workflowId,
  projectId,
  status: 'running' as const,
  createdAt: 1000,
  updatedAt: 2000,
});

describe('workflowStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkflowStore.setState({
      workflows: {},
      runs: {},
      stepRuns: {},
      templates: [],
      stepTypes: [],
    });
  });

  describe('loadWorkflows', () => {
    it('loads workflows for project', async () => {
      const wfs = [mockWorkflow('w1')];
      vi.mocked(listWorkflows).mockResolvedValue(wfs as any);

      await useWorkflowStore.getState().loadWorkflows('proj-1');

      expect(useWorkflowStore.getState().workflows['proj-1']).toEqual(wfs);
    });
  });

  describe('loadTemplates', () => {
    it('loads templates', async () => {
      const templates = [{ id: 't1', name: 'Template 1' }];
      vi.mocked(listWorkflowTemplates).mockResolvedValue(templates as any);

      await useWorkflowStore.getState().loadTemplates();

      expect(useWorkflowStore.getState().templates).toEqual(templates);
    });
  });

  describe('loadStepTypes', () => {
    it('loads step types', async () => {
      const stepTypes = [{ type: 'prompt', label: 'Prompt' }];
      vi.mocked(listWorkflowStepTypes).mockResolvedValue(stepTypes as any);

      await useWorkflowStore.getState().loadStepTypes();

      expect(useWorkflowStore.getState().stepTypes).toEqual(stepTypes);
    });
  });

  describe('createWorkflow', () => {
    it('creates workflow and adds to state', async () => {
      const wf = mockWorkflow('w1');
      vi.mocked(apiCreateWorkflow).mockResolvedValue(wf as any);

      const result = await useWorkflowStore.getState().createWorkflow('proj-1', {
        name: 'New', definition: { steps: [] },
      });

      expect(result).toEqual(wf);
      expect(useWorkflowStore.getState().workflows['proj-1']).toContainEqual(wf);
    });
  });

  describe('updateWorkflow', () => {
    it('updates workflow in state', async () => {
      const wf = mockWorkflow('w1');
      useWorkflowStore.setState({ workflows: { 'proj-1': [mockWorkflow('w1')] as any[] } });
      vi.mocked(apiUpdateWorkflow).mockResolvedValue({ ...wf, name: 'Updated' } as any);

      await useWorkflowStore.getState().updateWorkflow('w1', 'proj-1', { name: 'Updated' } as any);

      expect(useWorkflowStore.getState().workflows['proj-1'][0].name).toBe('Updated');
    });
  });

  describe('deleteWorkflow', () => {
    it('removes workflow from state', async () => {
      useWorkflowStore.setState({ workflows: { 'proj-1': [mockWorkflow('w1'), mockWorkflow('w2')] as any[] } });
      vi.mocked(apiDeleteWorkflow).mockResolvedValue(undefined as any);

      await useWorkflowStore.getState().deleteWorkflow('w1', 'proj-1');

      expect(useWorkflowStore.getState().workflows['proj-1']).toHaveLength(1);
      expect(useWorkflowStore.getState().workflows['proj-1'][0].id).toBe('w2');
    });
  });

  describe('createFromTemplate', () => {
    it('creates from template and adds to state', async () => {
      const wf = mockWorkflow('w1');
      vi.mocked(createWorkflowFromTemplate).mockResolvedValue(wf as any);

      const result = await useWorkflowStore.getState().createFromTemplate('proj-1', 't1');

      expect(result).toEqual(wf);
      expect(useWorkflowStore.getState().workflows['proj-1']).toContainEqual(wf);
    });
  });

  describe('triggerWorkflow', () => {
    it('triggers workflow and adds run to state', async () => {
      const run = mockRun('r1', 'w1');
      vi.mocked(apiTriggerWorkflow).mockResolvedValue(run as any);

      const result = await useWorkflowStore.getState().triggerWorkflow('w1');

      expect(result).toEqual(run);
      expect(useWorkflowStore.getState().runs['w1']).toContainEqual(run);
    });
  });

  describe('loadRuns', () => {
    it('loads runs for workflow', async () => {
      const runs = [mockRun('r1', 'w1')];
      vi.mocked(listWorkflowRuns).mockResolvedValue(runs as any);

      await useWorkflowStore.getState().loadRuns('w1');

      expect(useWorkflowStore.getState().runs['w1']).toEqual(runs);
    });
  });

  describe('loadRun', () => {
    it('loads individual run with step runs', async () => {
      const run = mockRun('r1', 'w1');
      const stepRuns = [{ id: 'sr1', runId: 'r1' }];
      vi.mocked(getWorkflowRun).mockResolvedValue({ run, stepRuns } as any);

      await useWorkflowStore.getState().loadRun('r1');

      expect(useWorkflowStore.getState().runs['w1']).toContainEqual(run);
      expect(useWorkflowStore.getState().stepRuns['r1']).toEqual(stepRuns);
    });
  });

  describe('cancelRun', () => {
    it('calls cancel API', async () => {
      vi.mocked(cancelWorkflowRun).mockResolvedValue(undefined as any);
      await useWorkflowStore.getState().cancelRun('r1');
      expect(cancelWorkflowRun).toHaveBeenCalledWith('r1');
    });
  });

  describe('approveStep / rejectStep', () => {
    it('calls approve API', async () => {
      vi.mocked(approveWorkflowStep).mockResolvedValue(undefined as any);
      await useWorkflowStore.getState().approveStep('sr1');
      expect(approveWorkflowStep).toHaveBeenCalledWith('sr1');
    });

    it('calls reject API', async () => {
      vi.mocked(rejectWorkflowStep).mockResolvedValue(undefined as any);
      await useWorkflowStore.getState().rejectStep('sr1');
      expect(rejectWorkflowStep).toHaveBeenCalledWith('sr1');
    });
  });

  describe('upsertWorkflow', () => {
    it('adds new workflow', () => {
      const wf = mockWorkflow('w1');
      useWorkflowStore.getState().upsertWorkflow('proj-1', wf as any);

      expect(useWorkflowStore.getState().workflows['proj-1']).toContainEqual(wf);
    });

    it('updates existing workflow', () => {
      useWorkflowStore.setState({ workflows: { 'proj-1': [mockWorkflow('w1')] as any[] } });
      const updated = { ...mockWorkflow('w1'), name: 'Updated' };

      useWorkflowStore.getState().upsertWorkflow('proj-1', updated as any);

      const wfs = useWorkflowStore.getState().workflows['proj-1'];
      expect(wfs).toHaveLength(1);
      expect(wfs[0].name).toBe('Updated');
    });
  });

  describe('removeWorkflow', () => {
    it('removes workflow from project', () => {
      useWorkflowStore.setState({ workflows: { 'proj-1': [mockWorkflow('w1'), mockWorkflow('w2')] as any[] } });

      useWorkflowStore.getState().removeWorkflow('proj-1', 'w1');

      expect(useWorkflowStore.getState().workflows['proj-1']).toHaveLength(1);
    });

    it('handles missing project gracefully', () => {
      useWorkflowStore.getState().removeWorkflow('proj-1', 'w1');
      expect(useWorkflowStore.getState().workflows['proj-1']).toEqual([]);
    });
  });

  describe('upsertRun', () => {
    it('adds new run', () => {
      const run = mockRun('r1', 'w1');
      useWorkflowStore.getState().upsertRun('proj-1', run as any);

      expect(useWorkflowStore.getState().runs['w1']).toContainEqual(run);
    });

    it('updates existing run', () => {
      const run = mockRun('r1', 'w1');
      useWorkflowStore.setState({ runs: { w1: [run] as any[] } });

      const updated = { ...run, status: 'completed' };
      useWorkflowStore.getState().upsertRun('proj-1', updated as any);

      expect(useWorkflowStore.getState().runs['w1']).toHaveLength(1);
      expect(useWorkflowStore.getState().runs['w1'][0].status).toBe('completed');
    });

    it('includes step runs when provided', () => {
      const run = mockRun('r1', 'w1');
      const stepRuns = [{ id: 'sr1' }];
      useWorkflowStore.getState().upsertRun('proj-1', run as any, stepRuns as any);

      expect(useWorkflowStore.getState().stepRuns['r1']).toEqual(stepRuns);
    });
  });

  describe('loadRuns', () => {
    it('loads runs for workflow', async () => {
      const runs = [mockRun('r1', 'w1'), mockRun('r2', 'w1')];
      vi.mocked(listWorkflowRuns).mockResolvedValue(runs as any);

      await useWorkflowStore.getState().loadRuns('w1');

      expect(useWorkflowStore.getState().runs['w1']).toEqual(runs);
    });
  });

  describe('loadRun', () => {
    it('loads single run with step runs', async () => {
      const run = mockRun('r1', 'w1');
      const stepRuns = [{ id: 'sr1', runId: 'r1' }];
      vi.mocked(getWorkflowRun).mockResolvedValue({ run, stepRuns } as any);

      await useWorkflowStore.getState().loadRun('r1');

      expect(useWorkflowStore.getState().runs['w1']).toContainEqual(run);
      expect(useWorkflowStore.getState().stepRuns['r1']).toEqual(stepRuns);
    });
  });

  describe('triggerWorkflow', () => {
    it('triggers workflow and returns run', async () => {
      const run = mockRun('r1', 'w1');
      vi.mocked(apiTriggerWorkflow).mockResolvedValue(run as any);

      const result = await useWorkflowStore.getState().triggerWorkflow('w1');

      expect(result).toEqual(run);
    });
  });

  describe('cancelRun', () => {
    it('cancels run', async () => {
      vi.mocked(cancelWorkflowRun).mockResolvedValue(undefined);

      await useWorkflowStore.getState().cancelRun('r1');

      expect(cancelWorkflowRun).toHaveBeenCalledWith('r1');
    });
  });

  describe('approveStep', () => {
    it('approves step', async () => {
      vi.mocked(approveWorkflowStep).mockResolvedValue(undefined);

      await useWorkflowStore.getState().approveStep('sr1');

      expect(approveWorkflowStep).toHaveBeenCalledWith('sr1');
    });
  });

  describe('rejectStep', () => {
    it('rejects step', async () => {
      vi.mocked(rejectWorkflowStep).mockResolvedValue(undefined);

      await useWorkflowStore.getState().rejectStep('sr1');

      expect(rejectWorkflowStep).toHaveBeenCalledWith('sr1');
    });
  });

  describe('loadStepTypes', () => {
    it('loads step types', async () => {
      const stepTypes = [{ type: 'builtin', name: 'bash', schema: {} }];
      vi.mocked(listWorkflowStepTypes).mockResolvedValue(stepTypes as any);

      await useWorkflowStore.getState().loadStepTypes();

      expect(useWorkflowStore.getState().stepTypes).toEqual(stepTypes);
    });
  });

  describe('createFromTemplate', () => {
    it('creates workflow from template', async () => {
      const workflow = mockWorkflow('w1');
      vi.mocked(createWorkflowFromTemplate).mockResolvedValue(workflow as any);

      const result = await useWorkflowStore.getState().createFromTemplate('proj-1', 'template-1');

      expect(result).toEqual(workflow);
      expect(useWorkflowStore.getState().workflows['proj-1']).toContainEqual(workflow);
    });
  });
});
