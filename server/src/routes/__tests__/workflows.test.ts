import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkflowRoutes } from '../workflows.js';

// Mock cron
vi.mock('../../utils/cron.js', () => ({
  isValidCron: vi.fn().mockReturnValue(true),
}));

// Mock workflow step registry
vi.mock('../../plugins/workflow-step-registry.js', () => ({
  workflowStepRegistry: {
    getAllMeta: vi.fn().mockReturnValue([
      { type: 'plugin_step', name: 'Plugin Step', description: 'From plugin', category: 'Plugin', source: 'plugin' },
    ]),
  },
}));

import { isValidCron } from '../../utils/cron.js';

const mockWorkflow = {
  id: 'wf-1',
  projectId: 'proj-1',
  name: 'Test Workflow',
  description: 'A test workflow',
  status: 'active',
  definition: {
    steps: [{ id: 's1', type: 'shell', config: {} }],
    triggers: [{ type: 'manual' }],
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockRun = {
  id: 'run-1',
  workflowId: 'wf-1',
  status: 'running',
  startedAt: '2026-01-01T00:00:00Z',
};

const mockStepRun = {
  id: 'sr-1',
  runId: 'run-1',
  stepId: 's1',
  status: 'pending',
};

function createMockService() {
  return {
    listWorkflows: vi.fn().mockReturnValue([mockWorkflow]),
    getWorkflow: vi.fn().mockReturnValue(mockWorkflow),
    createWorkflow: vi.fn().mockReturnValue(mockWorkflow),
    updateWorkflow: vi.fn().mockReturnValue(mockWorkflow),
    deleteWorkflow: vi.fn().mockReturnValue(true),
    getTemplates: vi.fn().mockReturnValue([{ id: 'tmpl-1', name: 'Template' }]),
    createFromTemplate: vi.fn().mockReturnValue(mockWorkflow),
    triggerWorkflow: vi.fn().mockResolvedValue(mockRun),
    getRuns: vi.fn().mockReturnValue([mockRun]),
    getRun: vi.fn().mockReturnValue({ run: mockRun, stepRuns: [mockStepRun] }),
    cancelRun: vi.fn().mockReturnValue(true),
    approveStep: vi.fn().mockReturnValue(true),
    rejectStep: vi.fn().mockReturnValue(true),
  };
}

describe('workflow routes', () => {
  let app: express.Express;
  let service: ReturnType<typeof createMockService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createMockService();
    app = express();
    app.use(express.json());
    app.use('/api', createWorkflowRoutes(service as any));
  });

  // ── GET /api/projects/:projectId/workflows ──

  describe('GET /api/projects/:projectId/workflows', () => {
    it('lists workflows for a project', async () => {
      const res = await request(app).get('/api/projects/proj-1/workflows');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([mockWorkflow]);
      expect(service.listWorkflows).toHaveBeenCalledWith('proj-1');
    });

    it('returns 500 on error', async () => {
      service.listWorkflows.mockImplementation(() => { throw new Error('DB fail'); });
      const res = await request(app).get('/api/projects/proj-1/workflows');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── POST /api/projects/:projectId/workflows ──

  describe('POST /api/projects/:projectId/workflows', () => {
    const validV1Body = {
      name: 'New WF',
      description: 'desc',
      definition: {
        steps: [{ id: 's1', type: 'shell', config: {} }],
        triggers: [{ type: 'manual' }],
      },
    };

    const validV2Body = {
      name: 'V2 WF',
      definition: {
        version: 2,
        nodes: [{ id: 'n1', type: 'shell' }, { id: 'n2', type: 'notify' }],
        edges: [{ from: 'n1', to: 'n2' }],
        entryNodeId: 'n1',
        triggers: [{ type: 'manual' }],
      },
    };

    it('creates a V1 workflow', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows').send(validV1Body);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(service.createWorkflow).toHaveBeenCalledWith({
        projectId: 'proj-1',
        name: 'New WF',
        description: 'desc',
        definition: validV1Body.definition,
        status: undefined,
      });
    });

    it('creates a V2 workflow', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows').send(validV2Body);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows').send({
        definition: validV1Body.definition,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Name is required');
    });

    it('returns 400 when definition is invalid (no steps or nodes)', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows').send({
        name: 'Bad',
        definition: { triggers: [{ type: 'manual' }] },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when definition has no triggers', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows').send({
        name: 'No triggers',
        definition: { steps: [{ id: 's1' }] },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when V2 entryNodeId is missing', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows').send({
        name: 'V2 bad',
        definition: {
          version: 2,
          nodes: [{ id: 'n1' }],
          edges: [],
          triggers: [{ type: 'manual' }],
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('entryNodeId');
    });

    it('returns 400 when V2 entryNodeId references non-existent node', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows').send({
        name: 'V2 bad ref',
        definition: {
          version: 2,
          nodes: [{ id: 'n1' }],
          edges: [],
          entryNodeId: 'n999',
          triggers: [{ type: 'manual' }],
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('entryNodeId');
    });

    it('returns 400 when cron expression is invalid', async () => {
      (isValidCron as any).mockReturnValue(false);
      const res = await request(app).post('/api/projects/proj-1/workflows').send({
        name: 'Cron WF',
        definition: {
          steps: [{ id: 's1', type: 'shell', config: {} }],
          triggers: [{ type: 'cron', cron: 'bad-cron' }],
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Invalid cron');
    });

    it('returns 500 on service error', async () => {
      service.createWorkflow.mockImplementation(() => { throw new Error('create fail'); });
      const res = await request(app).post('/api/projects/proj-1/workflows').send(validV1Body);
      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/workflows/:workflowId ──

  describe('GET /api/workflows/:workflowId', () => {
    it('returns a workflow', async () => {
      const res = await request(app).get('/api/workflows/wf-1');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockWorkflow);
    });

    it('returns 404 when workflow not found', async () => {
      service.getWorkflow.mockReturnValue(null);
      const res = await request(app).get('/api/workflows/wf-999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 on error', async () => {
      service.getWorkflow.mockImplementation(() => { throw new Error('DB'); });
      const res = await request(app).get('/api/workflows/wf-1');
      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /api/workflows/:workflowId ──

  describe('PATCH /api/workflows/:workflowId', () => {
    it('updates a workflow', async () => {
      const res = await request(app).patch('/api/workflows/wf-1').send({ name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(service.updateWorkflow).toHaveBeenCalledWith('wf-1', { name: 'Updated' });
    });

    it('returns 404 when workflow not found', async () => {
      service.getWorkflow.mockReturnValue(null);
      const res = await request(app).patch('/api/workflows/wf-999').send({ name: 'X' });
      expect(res.status).toBe(404);
    });

    it('validates cron in updated triggers', async () => {
      (isValidCron as any).mockReturnValue(false);
      const res = await request(app).patch('/api/workflows/wf-1').send({
        definition: { triggers: [{ type: 'cron', cron: 'bad' }] },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Invalid cron');
    });

    it('skips cron validation when no triggers in body', async () => {
      const res = await request(app).patch('/api/workflows/wf-1').send({ name: 'No triggers update' });
      expect(res.status).toBe(200);
    });

    it('returns 500 on error', async () => {
      service.updateWorkflow.mockImplementation(() => { throw new Error('update fail'); });
      const res = await request(app).patch('/api/workflows/wf-1').send({ name: 'X' });
      expect(res.status).toBe(500);
    });
  });

  // ── DELETE /api/workflows/:workflowId ──

  describe('DELETE /api/workflows/:workflowId', () => {
    it('deletes a workflow', async () => {
      const res = await request(app).delete('/api/workflows/wf-1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
      expect(service.deleteWorkflow).toHaveBeenCalledWith('wf-1', 'proj-1');
    });

    it('returns 404 when workflow not found', async () => {
      service.getWorkflow.mockReturnValue(null);
      const res = await request(app).delete('/api/workflows/wf-999');
      expect(res.status).toBe(404);
    });

    it('returns 500 on error', async () => {
      service.deleteWorkflow.mockImplementation(() => { throw new Error('del fail'); });
      const res = await request(app).delete('/api/workflows/wf-1');
      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/workflow-templates ──

  describe('GET /api/workflow-templates', () => {
    it('returns templates', async () => {
      const res = await request(app).get('/api/workflow-templates');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 'tmpl-1', name: 'Template' }]);
    });
  });

  // ── POST /api/projects/:projectId/workflows/from-template/:templateId ──

  describe('POST /api/projects/:projectId/workflows/from-template/:templateId', () => {
    it('creates workflow from template', async () => {
      const res = await request(app).post('/api/projects/proj-1/workflows/from-template/tmpl-1');
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(service.createFromTemplate).toHaveBeenCalledWith('proj-1', 'tmpl-1');
    });

    it('returns 500 on error', async () => {
      service.createFromTemplate.mockImplementation(() => { throw new Error('tmpl fail'); });
      const res = await request(app).post('/api/projects/proj-1/workflows/from-template/tmpl-1');
      expect(res.status).toBe(500);
    });
  });

  // ── POST /api/workflows/:workflowId/trigger ──

  describe('POST /api/workflows/:workflowId/trigger', () => {
    it('triggers a workflow', async () => {
      const res = await request(app).post('/api/workflows/wf-1/trigger');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockRun);
      expect(service.triggerWorkflow).toHaveBeenCalledWith('wf-1');
    });

    it('returns 500 on error', async () => {
      service.triggerWorkflow.mockRejectedValue(new Error('trigger fail'));
      const res = await request(app).post('/api/workflows/wf-1/trigger');
      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/workflows/:workflowId/runs ──

  describe('GET /api/workflows/:workflowId/runs', () => {
    it('returns runs with default limit', async () => {
      const res = await request(app).get('/api/workflows/wf-1/runs');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([mockRun]);
      expect(service.getRuns).toHaveBeenCalledWith('wf-1', 20);
    });

    it('accepts custom limit', async () => {
      const res = await request(app).get('/api/workflows/wf-1/runs?limit=5');
      expect(res.status).toBe(200);
      expect(service.getRuns).toHaveBeenCalledWith('wf-1', 5);
    });

    it('returns 500 on error', async () => {
      service.getRuns.mockImplementation(() => { throw new Error('runs fail'); });
      const res = await request(app).get('/api/workflows/wf-1/runs');
      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/workflow-runs/:runId ──

  describe('GET /api/workflow-runs/:runId', () => {
    it('returns a run with step runs', async () => {
      const res = await request(app).get('/api/workflow-runs/run-1');
      expect(res.status).toBe(200);
      expect(res.body.data.run).toEqual(mockRun);
      expect(res.body.data.stepRuns).toEqual([mockStepRun]);
    });

    it('returns 404 when run not found', async () => {
      service.getRun.mockReturnValue(null);
      const res = await request(app).get('/api/workflow-runs/run-999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 on error', async () => {
      service.getRun.mockImplementation(() => { throw new Error('run fail'); });
      const res = await request(app).get('/api/workflow-runs/run-1');
      expect(res.status).toBe(500);
    });
  });

  // ── POST /api/workflow-runs/:runId/cancel ──

  describe('POST /api/workflow-runs/:runId/cancel', () => {
    it('cancels a run', async () => {
      const res = await request(app).post('/api/workflow-runs/run-1/cancel');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('returns 400 when run cannot be cancelled', async () => {
      service.cancelRun.mockReturnValue(false);
      const res = await request(app).post('/api/workflow-runs/run-1/cancel');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('returns 500 on error', async () => {
      service.cancelRun.mockImplementation(() => { throw new Error('cancel fail'); });
      const res = await request(app).post('/api/workflow-runs/run-1/cancel');
      expect(res.status).toBe(500);
    });
  });

  // ── POST /api/workflow-step-runs/:stepRunId/approve ──

  describe('POST /api/workflow-step-runs/:stepRunId/approve', () => {
    it('approves a step', async () => {
      const res = await request(app).post('/api/workflow-step-runs/sr-1/approve');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('returns 400 when step is not waiting for approval', async () => {
      service.approveStep.mockReturnValue(false);
      const res = await request(app).post('/api/workflow-step-runs/sr-1/approve');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('returns 500 on error', async () => {
      service.approveStep.mockImplementation(() => { throw new Error('approve fail'); });
      const res = await request(app).post('/api/workflow-step-runs/sr-1/approve');
      expect(res.status).toBe(500);
    });
  });

  // ── POST /api/workflow-step-runs/:stepRunId/reject ──

  describe('POST /api/workflow-step-runs/:stepRunId/reject', () => {
    it('rejects a step', async () => {
      const res = await request(app).post('/api/workflow-step-runs/sr-1/reject');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('returns 400 when step is not waiting for approval', async () => {
      service.rejectStep.mockReturnValue(false);
      const res = await request(app).post('/api/workflow-step-runs/sr-1/reject');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('returns 500 on error', async () => {
      service.rejectStep.mockImplementation(() => { throw new Error('reject fail'); });
      const res = await request(app).post('/api/workflow-step-runs/sr-1/reject');
      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/workflow-step-types ──

  describe('GET /api/workflow-step-types', () => {
    it('returns builtin and plugin step types', async () => {
      const res = await request(app).get('/api/workflow-step-types');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const types = res.body.data;
      // 11 builtin + 1 plugin
      expect(types).toHaveLength(12);
      // Check a few builtins
      expect(types.find((t: any) => t.type === 'git_commit')).toBeDefined();
      expect(types.find((t: any) => t.type === 'ai_prompt')).toBeDefined();
      expect(types.find((t: any) => t.type === 'condition')).toBeDefined();
      // Check plugin step
      expect(types.find((t: any) => t.type === 'plugin_step')).toEqual({
        type: 'plugin_step',
        name: 'Plugin Step',
        description: 'From plugin',
        category: 'Plugin',
        source: 'plugin',
      });
    });
  });
});
