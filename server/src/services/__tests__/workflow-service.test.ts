import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWorkflowRepo = {
  findByProject: vi.fn().mockReturnValue([]),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findByProjectAndTemplate: vi.fn(),
  findAllActive: vi.fn().mockReturnValue([]),
};
const mockRunRepo = {
  findByWorkflow: vi.fn().mockReturnValue([]),
  findById: vi.fn(),
};
const mockStepRunRepo = {
  findByRun: vi.fn().mockReturnValue([]),
};
const mockScheduleRepo = {
  findDue: vi.fn().mockReturnValue([]),
  upsert: vi.fn(),
  deleteByWorkflow: vi.fn(),
  updateNextRun: vi.fn(),
  findByWorkflow: vi.fn(),
};
const mockEngine = {
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  approveStep: vi.fn(),
  rejectStep: vi.fn(),
  isRunning: vi.fn().mockReturnValue(false),
};

vi.mock('../../repositories/workflow.js', () => ({
  WorkflowRepository: class { constructor() { Object.assign(this, mockWorkflowRepo); } },
}));
vi.mock('../../repositories/workflow-run.js', () => ({
  WorkflowRunRepository: class { constructor() { Object.assign(this, mockRunRepo); } },
}));
vi.mock('../../repositories/workflow-step-run.js', () => ({
  WorkflowStepRunRepository: class { constructor() { Object.assign(this, mockStepRunRepo); } },
}));
vi.mock('../../repositories/workflow-schedule.js', () => ({
  WorkflowScheduleRepository: class { constructor() { Object.assign(this, mockScheduleRepo); } },
}));
vi.mock('../workflow-engine.js', () => ({
  WorkflowEngine: class { constructor() { Object.assign(this, mockEngine); } },
}));
vi.mock('../../utils/cron.js', () => ({
  computeNextCronRun: vi.fn().mockReturnValue(99999),
}));
vi.mock('../../events/index.js', () => ({
  pluginEvents: { on: vi.fn().mockReturnValue(() => {}), emit: vi.fn() },
}));
vi.mock('../../workflow-templates.js', () => ({
  BUILTIN_WORKFLOW_TEMPLATES: [
    { id: 'tpl1', name: 'Template 1', description: 'desc', definition: { triggers: [], steps: [] } },
  ],
}));

import { WorkflowService } from '../workflow-service.js';
import { pluginEvents } from '../../events/index.js';

describe('WorkflowService', () => {
  let service: WorkflowService;
  let mockBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set defaults after clearAllMocks
    mockWorkflowRepo.findByProject.mockReturnValue([]);
    mockWorkflowRepo.findAllActive.mockReturnValue([]);
    mockRunRepo.findByWorkflow.mockReturnValue([]);
    mockStepRunRepo.findByRun.mockReturnValue([]);
    mockScheduleRepo.findDue.mockReturnValue([]);
    mockEngine.isRunning.mockReturnValue(false);

    mockBroadcast = vi.fn();
    service = new WorkflowService({} as any, mockBroadcast);
  });

  describe('listWorkflows', () => {
    it('delegates to workflowRepo.findByProject', () => {
      const result = service.listWorkflows('p1');
      expect(result).toEqual([]);
      expect(mockWorkflowRepo.findByProject).toHaveBeenCalledWith('p1');
    });
  });

  describe('getWorkflow', () => {
    it('returns null when not found', () => {
      mockWorkflowRepo.findById.mockReturnValue(undefined);
      expect(service.getWorkflow('w1')).toBeUndefined();
    });

    it('returns workflow when found', () => {
      const wf = { id: 'w1', name: 'flow' };
      mockWorkflowRepo.findById.mockReturnValue(wf);
      expect(service.getWorkflow('w1')).toEqual(wf);
    });
  });

  describe('createWorkflow', () => {
    it('creates workflow and broadcasts update', () => {
      const mockWorkflow = { id: 'w1', projectId: 'p1', status: 'active', definition: { triggers: [] } };
      mockWorkflowRepo.create.mockReturnValue(mockWorkflow);

      const result = service.createWorkflow({
        projectId: 'p1', name: 'flow', definition: { triggers: [], steps: [] } as any,
      });

      expect(result).toEqual(mockWorkflow);
      expect(mockBroadcast).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'workflow_update' }));
    });

    it('does not sync schedule when status is not active', () => {
      const mockWorkflow = { id: 'w1', projectId: 'p1', status: 'disabled', definition: { triggers: [] } };
      mockWorkflowRepo.create.mockReturnValue(mockWorkflow);

      service.createWorkflow({
        projectId: 'p1', name: 'flow', definition: { triggers: [], steps: [] } as any, status: 'disabled',
      });

      // Schedule sync not called for inactive
      expect(mockScheduleRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updateWorkflow', () => {
    it('updates and broadcasts', () => {
      const updated = { id: 'w1', projectId: 'p1', status: 'active', definition: { triggers: [] } };
      mockWorkflowRepo.update.mockReturnValue(updated);

      const result = service.updateWorkflow('w1', { name: 'new name' });
      expect(result).toEqual(updated);
      expect(mockBroadcast).toHaveBeenCalled();
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes and broadcasts when successful', () => {
      mockWorkflowRepo.delete.mockReturnValue(true);
      const result = service.deleteWorkflow('w1', 'p1');
      expect(result).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'workflow_deleted' }));
      expect(mockScheduleRepo.deleteByWorkflow).toHaveBeenCalledWith('w1');
    });

    it('returns false when not found', () => {
      mockWorkflowRepo.delete.mockReturnValue(false);
      expect(service.deleteWorkflow('w1', 'p1')).toBe(false);
    });
  });

  describe('getTemplates', () => {
    it('returns builtin templates', () => {
      const templates = service.getTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe('tpl1');
    });
  });

  describe('createFromTemplate', () => {
    it('throws when template not found', () => {
      expect(() => service.createFromTemplate('p1', 'nonexistent')).toThrow('Template not found');
    });

    it('toggles existing workflow from active to disabled', () => {
      const existing = { id: 'w1', status: 'active', projectId: 'p1', definition: { triggers: [] } };
      mockWorkflowRepo.findByProjectAndTemplate.mockReturnValue(existing);
      mockWorkflowRepo.update.mockReturnValue({ ...existing, status: 'disabled' });

      service.createFromTemplate('p1', 'tpl1');
      expect(mockWorkflowRepo.update).toHaveBeenCalledWith('w1', expect.objectContaining({ status: 'disabled' }));
    });

    it('toggles existing workflow from disabled to active', () => {
      const existing = { id: 'w1', status: 'disabled', projectId: 'p1', definition: { triggers: [] } };
      mockWorkflowRepo.findByProjectAndTemplate.mockReturnValue(existing);
      mockWorkflowRepo.update.mockReturnValue({ ...existing, status: 'active' });

      service.createFromTemplate('p1', 'tpl1');
      expect(mockWorkflowRepo.update).toHaveBeenCalledWith('w1', expect.objectContaining({ status: 'active' }));
    });

    it('creates new workflow from template when not existing', () => {
      mockWorkflowRepo.findByProjectAndTemplate.mockReturnValue(null);
      const created = { id: 'w2', projectId: 'p1', status: 'active', definition: { triggers: [] } };
      mockWorkflowRepo.create.mockReturnValue(created);

      service.createFromTemplate('p1', 'tpl1');
      expect(mockWorkflowRepo.create).toHaveBeenCalled();
    });
  });

  describe('triggerWorkflow', () => {
    it('throws when workflow not found', async () => {
      mockWorkflowRepo.findById.mockReturnValue(null);
      await expect(service.triggerWorkflow('w1')).rejects.toThrow('Workflow not found');
    });

    it('throws when workflow not active', async () => {
      mockWorkflowRepo.findById.mockReturnValue({ id: 'w1', status: 'disabled' });
      await expect(service.triggerWorkflow('w1')).rejects.toThrow('not active');
    });

    it('delegates to engine.startRun', async () => {
      const wf = { id: 'w1', projectId: 'p1', status: 'active', definition: { steps: [] } };
      mockWorkflowRepo.findById.mockReturnValue(wf);
      mockEngine.startRun.mockResolvedValue({ id: 'r1' });

      await service.triggerWorkflow('w1', 'manual', 'detail');
      expect(mockEngine.startRun).toHaveBeenCalledWith('w1', 'p1', wf.definition, 'manual', 'detail');
    });
  });

  describe('getRuns', () => {
    it('delegates to runRepo', () => {
      service.getRuns('w1', 10);
      expect(mockRunRepo.findByWorkflow).toHaveBeenCalledWith('w1', 10);
    });
  });

  describe('getRun', () => {
    it('returns null when run not found', () => {
      mockRunRepo.findById.mockReturnValue(null);
      expect(service.getRun('r1')).toBeNull();
    });

    it('returns run with step runs', () => {
      const run = { id: 'r1' };
      const steps = [{ id: 'sr1' }];
      mockRunRepo.findById.mockReturnValue(run);
      mockStepRunRepo.findByRun.mockReturnValue(steps);

      const result = service.getRun('r1');
      expect(result).toEqual({ run, stepRuns: steps });
    });
  });

  describe('cancelRun', () => {
    it('delegates to engine', () => {
      service.cancelRun('r1');
      expect(mockEngine.cancelRun).toHaveBeenCalledWith('r1');
    });
  });

  describe('tick', () => {
    it('handles empty due schedules', async () => {
      mockScheduleRepo.findDue.mockReturnValue([]);
      await service.tick();
      expect(mockScheduleRepo.findDue).toHaveBeenCalled();
    });

    it('catches tick errors', async () => {
      mockScheduleRepo.findDue.mockImplementation(() => { throw new Error('db'); });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await service.tick();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('tick error'), expect.any(Error));
      spy.mockRestore();
    });

    it('skips inactive workflows during tick', async () => {
      mockScheduleRepo.findDue.mockReturnValue([{ workflowId: 'w1', triggerIndex: 0 }]);
      mockWorkflowRepo.findById.mockReturnValue({ id: 'w1', status: 'disabled' });

      await service.tick();
      expect(mockEngine.startRun).not.toHaveBeenCalled();
    });

    it('skips already running workflows', async () => {
      mockScheduleRepo.findDue.mockReturnValue([{ workflowId: 'w1', triggerIndex: 0 }]);
      mockWorkflowRepo.findById.mockReturnValue({ id: 'w1', status: 'active', definition: { triggers: [{ type: 'cron', cron: '* * * * *' }] } });
      mockEngine.isRunning.mockReturnValue(true);

      await service.tick();
      expect(mockEngine.startRun).not.toHaveBeenCalled();
    });

    it('triggers active workflow and updates next run', async () => {
      const trigger = { type: 'cron', cron: '* * * * *' };
      mockScheduleRepo.findDue.mockReturnValue([{ workflowId: 'w1', triggerIndex: 0 }]);
      mockWorkflowRepo.findById.mockReturnValue({
        id: 'w1', projectId: 'p1', status: 'active',
        definition: { triggers: [trigger], steps: [] },
      });
      mockEngine.isRunning.mockReturnValue(false);
      mockEngine.startRun.mockResolvedValue({ id: 'r1' });

      await service.tick();

      expect(mockEngine.startRun).toHaveBeenCalledWith('w1', 'p1', expect.any(Object), 'schedule', expect.stringContaining('cron'));
      expect(mockScheduleRepo.updateNextRun).toHaveBeenCalledWith('w1', 99999);
    });

    it('handles trigger failure gracefully', async () => {
      const trigger = { type: 'interval', intervalMinutes: 10 };
      mockScheduleRepo.findDue.mockReturnValue([{ workflowId: 'w1', triggerIndex: 0 }]);
      mockWorkflowRepo.findById.mockReturnValue({
        id: 'w1', projectId: 'p1', status: 'active',
        definition: { triggers: [trigger], steps: [] },
      });
      mockEngine.isRunning.mockReturnValue(false);
      mockEngine.startRun.mockRejectedValue(new Error('engine error'));

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await service.tick();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Schedule trigger failed'), expect.any(Error));
      spy.mockRestore();
    });

    it('skips schedules with invalid trigger index', async () => {
      mockScheduleRepo.findDue.mockReturnValue([{ workflowId: 'w1', triggerIndex: 5 }]);
      mockWorkflowRepo.findById.mockReturnValue({
        id: 'w1', projectId: 'p1', status: 'active',
        definition: { triggers: [] },
      });

      await service.tick();
      expect(mockEngine.startRun).not.toHaveBeenCalled();
    });
  });

  describe('approveStep', () => {
    it('delegates to engine', () => {
      mockEngine.approveStep.mockReturnValue(true);
      expect(service.approveStep('sr1')).toBe(true);
      expect(mockEngine.approveStep).toHaveBeenCalledWith('sr1');
    });
  });

  describe('rejectStep', () => {
    it('delegates to engine', () => {
      mockEngine.rejectStep.mockReturnValue(true);
      expect(service.rejectStep('sr1')).toBe(true);
      expect(mockEngine.rejectStep).toHaveBeenCalledWith('sr1');
    });
  });

  describe('initialize', () => {
    it('rebuilds event subscriptions', () => {
      mockWorkflowRepo.findAllActive.mockReturnValue([]);
      service.initialize();
      expect(mockWorkflowRepo.findAllActive).toHaveBeenCalled();
    });

    it('sets up event subscriptions for active workflows with event triggers', () => {

      mockWorkflowRepo.findAllActive.mockReturnValue([
        {
          id: 'w1', projectId: 'p1', status: 'active',
          definition: { triggers: [{ type: 'event', event: 'run.completed' }] },
        },
      ]);

      service.initialize();

      expect(pluginEvents.on).toHaveBeenCalledWith('run.completed', expect.any(Function), 'workflow-engine');
    });

    it('unsubscribes old event subscriptions before rebuilding', () => {
      const unsub = vi.fn();

      pluginEvents.on.mockReturnValue(unsub);

      mockWorkflowRepo.findAllActive.mockReturnValue([
        {
          id: 'w1', projectId: 'p1', status: 'active',
          definition: { triggers: [{ type: 'event', event: 'test.event' }] },
        },
      ]);

      // First initialize
      service.initialize();
      expect(pluginEvents.on).toHaveBeenCalled();

      // Second initialize should call unsub on previous subscriptions
      service.initialize();
      expect(unsub).toHaveBeenCalled();
    });
  });

  describe('matchesFilter (via event trigger)', () => {
    it('triggers workflow when event data matches filter', async () => {

      let eventHandler: (data: any) => Promise<void>;

      pluginEvents.on.mockImplementation((event: string, handler: any) => {
        eventHandler = handler;
        return () => {};
      });

      mockWorkflowRepo.findAllActive.mockReturnValue([
        {
          id: 'w1', projectId: 'p1', status: 'active',
          definition: {
            triggers: [{ type: 'event', event: 'run.completed', eventFilter: { status: 'success' } }],
            steps: [],
          },
        },
      ]);
      mockWorkflowRepo.findById.mockReturnValue({
        id: 'w1', projectId: 'p1', status: 'active',
        definition: {
          triggers: [{ type: 'event', event: 'run.completed', eventFilter: { status: 'success' } }],
          steps: [],
        },
      });
      mockEngine.isRunning.mockReturnValue(false);
      mockEngine.startRun.mockResolvedValue({ id: 'r1' });

      service.initialize();

      // Trigger the event with matching data
      await eventHandler!({ status: 'success' });

      expect(mockEngine.startRun).toHaveBeenCalledWith('w1', 'p1', expect.any(Object), 'event', 'event: run.completed');
    });

    it('does not trigger workflow when filter does not match', async () => {

      let eventHandler: (data: any) => Promise<void>;

      pluginEvents.on.mockImplementation((event: string, handler: any) => {
        eventHandler = handler;
        return () => {};
      });

      mockWorkflowRepo.findAllActive.mockReturnValue([
        {
          id: 'w1', projectId: 'p1', status: 'active',
          definition: {
            triggers: [{ type: 'event', event: 'run.completed', eventFilter: { status: 'success' } }],
            steps: [],
          },
        },
      ]);

      service.initialize();

      // Trigger the event with non-matching data
      await eventHandler!({ status: 'failed' });

      expect(mockEngine.startRun).not.toHaveBeenCalled();
    });

    it('skips already running workflows on event', async () => {

      let eventHandler: (data: any) => Promise<void>;

      pluginEvents.on.mockImplementation((event: string, handler: any) => {
        eventHandler = handler;
        return () => {};
      });

      mockWorkflowRepo.findAllActive.mockReturnValue([
        {
          id: 'w1', projectId: 'p1', status: 'active',
          definition: {
            triggers: [{ type: 'event', event: 'run.completed' }],
            steps: [],
          },
        },
      ]);
      mockEngine.isRunning.mockReturnValue(true);

      service.initialize();
      await eventHandler!({});

      expect(mockEngine.startRun).not.toHaveBeenCalled();
    });

    it('handles trigger error gracefully on event', async () => {

      let eventHandler: (data: any) => Promise<void>;

      pluginEvents.on.mockImplementation((event: string, handler: any) => {
        eventHandler = handler;
        return () => {};
      });

      mockWorkflowRepo.findAllActive.mockReturnValue([
        {
          id: 'w1', projectId: 'p1', status: 'active',
          definition: {
            triggers: [{ type: 'event', event: 'run.completed' }],
            steps: [],
          },
        },
      ]);
      mockWorkflowRepo.findById.mockReturnValue({
        id: 'w1', projectId: 'p1', status: 'active',
        definition: { triggers: [{ type: 'event', event: 'run.completed' }], steps: [] },
      });
      mockEngine.isRunning.mockReturnValue(false);
      mockEngine.startRun.mockRejectedValue(new Error('Engine error'));

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      service.initialize();
      await eventHandler!({});
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Event trigger failed'), expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('createWorkflow with cron trigger', () => {
    it('syncs schedule for active workflow with cron trigger', () => {
      const mockWorkflow = {
        id: 'w1', projectId: 'p1', status: 'active',
        definition: { triggers: [{ type: 'cron', cron: '0 9 * * *' }] },
      };
      mockWorkflowRepo.create.mockReturnValue(mockWorkflow);

      service.createWorkflow({
        projectId: 'p1', name: 'flow',
        definition: { triggers: [{ type: 'cron', cron: '0 9 * * *' }], steps: [] } as any,
      });

      expect(mockScheduleRepo.upsert).toHaveBeenCalledWith('w1', 0, 99999, true);
    });

    it('syncs schedule for active workflow with interval trigger', () => {
      const mockWorkflow = {
        id: 'w1', projectId: 'p1', status: 'active',
        definition: { triggers: [{ type: 'interval', intervalMinutes: 30 }] },
      };
      mockWorkflowRepo.create.mockReturnValue(mockWorkflow);

      service.createWorkflow({
        projectId: 'p1', name: 'flow',
        definition: { triggers: [{ type: 'interval', intervalMinutes: 30 }], steps: [] } as any,
      });

      expect(mockScheduleRepo.upsert).toHaveBeenCalled();
    });

    it('deletes schedule when updating workflow to disabled', () => {
      const updated = {
        id: 'w1', projectId: 'p1', status: 'disabled',
        definition: { triggers: [{ type: 'cron', cron: '0 9 * * *' }] },
      };
      mockWorkflowRepo.update.mockReturnValue(updated);

      service.updateWorkflow('w1', { status: 'disabled' });

      expect(mockScheduleRepo.deleteByWorkflow).toHaveBeenCalledWith('w1');
    });

    it('deletes schedule when no cron/interval trigger', () => {
      const updated = {
        id: 'w1', projectId: 'p1', status: 'active',
        definition: { triggers: [{ type: 'event', event: 'test' }] },
      };
      mockWorkflowRepo.update.mockReturnValue(updated);

      service.updateWorkflow('w1', { name: 'updated' });

      expect(mockScheduleRepo.deleteByWorkflow).toHaveBeenCalledWith('w1');
    });
  });
});
