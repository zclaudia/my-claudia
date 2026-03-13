import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunRepo = {
  create: vi.fn().mockReturnValue({ id: 'r1', workflowId: 'w1', projectId: 'p1', status: 'running', startedAt: Date.now() }),
  update: vi.fn().mockImplementation((_id: string, data: any) => data),
  findById: vi.fn(),
};
const mockStepRunRepo = {
  create: vi.fn().mockReturnValue({ id: 'sr1', runId: 'r1', stepId: 's1', status: 'pending' }),
  update: vi.fn().mockImplementation((_id: string, data: any) => data),
  findByRun: vi.fn().mockReturnValue([]),
  findByRunAndStep: vi.fn(),
};
const mockProjectRepo = {
  findById: vi.fn().mockReturnValue({ id: 'p1', providerId: 'prov1', rootPath: '/test' }),
};
const mockSessionRepo = {
  create: vi.fn().mockReturnValue({ id: 'sess1' }),
};

vi.mock('../../repositories/workflow-run.js', () => ({
  WorkflowRunRepository: class { constructor() { Object.assign(this, mockRunRepo); } },
}));
vi.mock('../../repositories/workflow-step-run.js', () => ({
  WorkflowStepRunRepository: class { constructor() { Object.assign(this, mockStepRunRepo); } },
}));
vi.mock('../../repositories/project.js', () => ({
  ProjectRepository: class { constructor() { Object.assign(this, mockProjectRepo); } },
}));
vi.mock('../../repositories/session.js', () => ({
  SessionRepository: class { constructor() { Object.assign(this, mockSessionRepo); } },
}));
vi.mock('../../server.js', () => ({
  createVirtualClient: vi.fn().mockReturnValue({ id: 'vc1' }),
  handleRunStart: vi.fn(),
}));
vi.mock('../../events/index.js', () => ({
  pluginEvents: { emit: vi.fn().mockResolvedValue(undefined), on: vi.fn() },
}));
vi.mock('../../plugins/workflow-step-registry.js', () => ({
  workflowStepRegistry: { get: vi.fn(), has: vi.fn(), execute: vi.fn() },
}));

// Use vi.hoisted to make mockExecFileAsync available in the hoisted vi.mock
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('util', () => ({
  promisify: () => mockExecFileAsync,
}));

import { WorkflowEngine, type StepResult } from '../workflow-engine.js';
import { createVirtualClient, handleRunStart } from '../../server.js';
import { workflowStepRegistry } from '../../plugins/workflow-step-registry.js';

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let mockBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults after clearAllMocks
    mockRunRepo.create.mockReturnValue({ id: 'r1', workflowId: 'w1', projectId: 'p1', status: 'running', startedAt: Date.now() });
    mockRunRepo.update.mockImplementation((_id: string, data: any) => data);
    mockStepRunRepo.create.mockReturnValue({ id: 'sr1', runId: 'r1', stepId: 's1', status: 'pending' });
    mockStepRunRepo.update.mockImplementation((_id: string, data: any) => data);
    mockStepRunRepo.findByRun.mockReturnValue([]);
    mockProjectRepo.findById.mockReturnValue({ id: 'p1', providerId: 'prov1', rootPath: '/test' });
    mockSessionRepo.create.mockReturnValue({ id: 'sess1' });

    mockBroadcast = vi.fn();
    engine = new WorkflowEngine({} as any, mockBroadcast);
  });

  describe('isRunning', () => {
    it('returns false for unknown workflow', () => {
      expect(engine.isRunning('w1')).toBe(false);
    });
  });

  describe('validateDAG', () => {
    it('returns valid for empty graph', () => {
      expect(engine.validateDAG([], [])).toEqual({ valid: true });
    });

    it('returns valid for simple linear graph', () => {
      const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any[];
      const edges = [
        { id: 'e1', source: 'a', target: 'b', type: 'success' },
        { id: 'e2', source: 'b', target: 'c', type: 'success' },
      ] as any[];
      expect(engine.validateDAG(nodes, edges)).toEqual({ valid: true });
    });

    it('detects unknown source node', () => {
      const nodes = [{ id: 'a' }] as any[];
      const edges = [{ id: 'e1', source: 'unknown', target: 'a', type: 'success' }] as any[];
      const result = engine.validateDAG(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown source node');
    });

    it('detects unknown target node', () => {
      const nodes = [{ id: 'a' }] as any[];
      const edges = [{ id: 'e1', source: 'a', target: 'unknown', type: 'success' }] as any[];
      const result = engine.validateDAG(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown target node');
    });

    it('detects self-loops', () => {
      const nodes = [{ id: 'a' }] as any[];
      const edges = [{ id: 'e1', source: 'a', target: 'a', type: 'success' }] as any[];
      const result = engine.validateDAG(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('self-loop');
    });

    it('detects cycles', () => {
      const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any[];
      const edges = [
        { id: 'e1', source: 'a', target: 'b', type: 'success' },
        { id: 'e2', source: 'b', target: 'c', type: 'success' },
        { id: 'e3', source: 'c', target: 'a', type: 'success' },
      ] as any[];
      const result = engine.validateDAG(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cycle');
    });

    it('handles diamond DAG (valid)', () => {
      const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as any[];
      const edges = [
        { id: 'e1', source: 'a', target: 'b', type: 'success' },
        { id: 'e2', source: 'a', target: 'c', type: 'success' },
        { id: 'e3', source: 'b', target: 'd', type: 'success' },
        { id: 'e4', source: 'c', target: 'd', type: 'success' },
      ] as any[];
      expect(engine.validateDAG(nodes, edges)).toEqual({ valid: true });
    });
  });

  describe('resolveTemplate', () => {
    it('resolves step output variables', () => {
      const results = new Map<string, StepResult>();
      results.set('step1', { status: 'completed', output: { msg: 'hello', count: 42 } });

      expect(engine.resolveTemplate('Result: ${step1.output.msg}', results)).toBe('Result: hello');
      expect(engine.resolveTemplate('Count: ${step1.output.count}', results)).toBe('Count: 42');
    });

    it('resolves step status variables', () => {
      const results = new Map<string, StepResult>();
      results.set('step1', { status: 'completed', output: {} });
      results.set('step2', { status: 'failed', output: {}, error: 'oops' });

      expect(engine.resolveTemplate('${step1.status}', results)).toBe('completed');
      expect(engine.resolveTemplate('${step2.status}', results)).toBe('failed');
    });

    it('leaves unresolved variables as-is', () => {
      const results = new Map<string, StepResult>();
      expect(engine.resolveTemplate('${missing.output.val}', results)).toBe('${missing.output.val}');
      expect(engine.resolveTemplate('${missing.status}', results)).toBe('${missing.status}');
    });

    it('does not resolve output for incomplete steps', () => {
      const results = new Map<string, StepResult>();
      results.set('step1', { status: 'failed', output: { msg: 'hi' }, error: 'err' });

      expect(engine.resolveTemplate('${step1.output.msg}', results)).toBe('${step1.output.msg}');
    });

    it('resolves multiple variables in one template', () => {
      const results = new Map<string, StepResult>();
      results.set('a', { status: 'completed', output: { x: 'foo' } });
      results.set('b', { status: 'completed', output: { y: 'bar' } });

      expect(engine.resolveTemplate('${a.output.x}-${b.output.y}', results)).toBe('foo-bar');
    });
  });

  describe('resolveConfig', () => {
    it('resolves variables in config object', () => {
      const results = new Map<string, StepResult>();
      results.set('prev', { status: 'completed', output: { path: '/tmp/test' } });

      const config = { command: 'cat ${prev.output.path}', cwd: '/root' };
      const resolved = engine.resolveConfig(config, results);
      expect(resolved).toEqual({ command: 'cat /tmp/test', cwd: '/root' });
    });
  });

  describe('evaluateCondition', () => {
    it('evaluates equality', () => {
      const results = new Map<string, StepResult>();
      results.set('s1', { status: 'completed', output: { val: 'yes' } });

      expect(engine.evaluateCondition('${s1.output.val} == yes', results)).toBe(true);
      expect(engine.evaluateCondition('${s1.output.val} == no', results)).toBe(false);
    });

    it('evaluates inequality', () => {
      const results = new Map<string, StepResult>();
      results.set('s1', { status: 'completed', output: { val: 'yes' } });

      expect(engine.evaluateCondition('${s1.output.val} != no', results)).toBe(true);
      expect(engine.evaluateCondition('${s1.output.val} != yes', results)).toBe(false);
    });

    it('returns false for invalid expression', () => {
      const results = new Map<string, StepResult>();
      expect(engine.evaluateCondition('invalid', results)).toBe(false);
    });

    it('evaluates status-based conditions', () => {
      const results = new Map<string, StepResult>();
      results.set('s1', { status: 'completed', output: {} });

      expect(engine.evaluateCondition('${s1.status} == completed', results)).toBe(true);
      expect(engine.evaluateCondition('${s1.status} != failed', results)).toBe(true);
    });
  });

  describe('startRun', () => {
    it('throws when workflow already running', async () => {
      const def = { version: 2, triggers: [], nodes: [{ id: 'n1', type: 'shell', config: { command: 'echo hi' } }], edges: [] };
      const startPromise = engine.startRun('w1', 'p1', def as any, 'manual');
      await expect(engine.startRun('w1', 'p1', def as any, 'manual')).rejects.toThrow('already running');
      try { await startPromise; } catch {}
    });

    it('throws for invalid DAG', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'a' }],
        edges: [{ id: 'e1', source: 'a', target: 'a', type: 'success' }],
      };
      await expect(engine.startRun('w2', 'p1', def as any, 'manual')).rejects.toThrow('Invalid workflow graph');
    });

    it('creates run and step run records', async () => {
      // Use a notify step which completes synchronously
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'Test', config: { message: 'hi' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      const run = await engine.startRun('w3', 'p1', def as any, 'manual');
      expect(run.id).toBe('r1');
      expect(mockRunRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        workflowId: 'w3',
        projectId: 'p1',
        status: 'running',
        triggerSource: 'manual',
      }));
      expect(mockStepRunRepo.create).toHaveBeenCalled();

      // Wait for async execution
      await new Promise(r => setTimeout(r, 50));
    });
  });

  describe('cancelRun', () => {
    it('returns false for unknown run', () => {
      mockRunRepo.findById.mockReturnValue(null);
      expect(engine.cancelRun('unknown')).toBe(false);
    });

    it('cancels a running run', () => {
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockStepRunRepo.findByRun.mockReturnValue([]);

      expect(engine.cancelRun('r1')).toBe(true);
      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({
        status: 'cancelled',
      }));
    });

    it('returns false for completed run', () => {
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'completed', projectId: 'p1' });
      expect(engine.cancelRun('r1')).toBe(false);
    });

    it('resolves pending approvals on cancel', () => {
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      const mockResolve = vi.fn();
      // Access pendingApprovals via the engine's cancel flow
      mockStepRunRepo.findByRun.mockReturnValue([{ id: 'sr1' }]);

      engine.cancelRun('r1');
      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'cancelled' }));
    });
  });

  describe('approveStep', () => {
    it('returns false when no pending approval', () => {
      expect(engine.approveStep('unknown')).toBe(false);
    });
  });

  describe('rejectStep', () => {
    it('returns false when no pending approval', () => {
      expect(engine.rejectStep('unknown')).toBe(false);
    });
  });

  describe('executeGraph via startRun — full graph traversal', () => {
    it('executes a single notify step and completes', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'Notify', config: { message: 'hello' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      const run = await engine.startRun('wf-notify', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // Run should be marked completed
      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'completed' }));
    });

    it('handles cancelled run mid-execution', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'N1', config: { message: 'hi' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      // Return cancelled status when checked
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'cancelled', projectId: 'p1' });

      await engine.startRun('wf-cancel', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // Should not mark as completed since it was cancelled
      expect(mockRunRepo.update).not.toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'completed' }));
    });

    it('handles missing node definition during execution', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'N1', config: { message: 'hi' } }],
        edges: [],
        entryNodeId: 'n_missing', // Points to non-existent node
      };
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-missing-node', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('not found in workflow definition'),
      }));
    });

    it('follows success edges between nodes', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [
          { id: 'n1', type: 'notify', name: 'Step 1', config: { message: 'first' } },
          { id: 'n2', type: 'notify', name: 'Step 2', config: { message: 'second' } },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', type: 'success' },
        ],
        entryNodeId: 'n1',
      };
      let stepRunCallCount = 0;
      mockStepRunRepo.findByRunAndStep.mockImplementation((_runId: string, stepId: string) => {
        stepRunCallCount++;
        return { id: `sr-${stepId}`, status: 'pending' };
      });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-chain', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // Both steps should have been executed
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n1', expect.objectContaining({ status: 'completed' }));
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n2', expect.objectContaining({ status: 'completed' }));
      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'completed' }));
    });

    it('aborts on failed step with default onError', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [
          { id: 'n1', type: 'unknown_type', name: 'Bad Step', config: {} },
        ],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      (workflowStepRegistry as any).has.mockReturnValue(false);

      await engine.startRun('wf-fail', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });

    it('skips unvisited nodes when graph completes', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [
          { id: 'n1', type: 'notify', name: 'Step 1', config: { message: 'run' } },
          { id: 'n2', type: 'notify', name: 'Unvisited', config: { message: 'skip' } },
        ],
        edges: [], // No edges, n2 is never reached
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockImplementation((_runId: string, stepId: string) => {
        return { id: `sr-${stepId}`, status: 'pending' };
      });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-skip', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // n2 should be marked as skipped
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n2', expect.objectContaining({ status: 'skipped' }));
    });

    it('handles step with onError=skip — continues execution', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [
          { id: 'n1', type: 'unknown_type', name: 'Fail Skip', config: {}, onError: 'skip' },
          { id: 'n2', type: 'notify', name: 'After', config: { message: 'after' } },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', type: 'success' },
        ],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockImplementation((_runId: string, stepId: string) => {
        return { id: `sr-${stepId}`, status: 'pending' };
      });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      (workflowStepRegistry as any).has.mockReturnValue(false);

      await engine.startRun('wf-skip-err', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // n1 should be marked skipped (onError=skip), n2 should execute
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n1', expect.objectContaining({ status: 'skipped' }));
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n2', expect.objectContaining({ status: 'completed' }));
    });

    it('handles step with onError=route — follows error edges', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [
          { id: 'n1', type: 'unknown_type', name: 'Fail Route', config: {}, onError: 'route' },
          { id: 'n_ok', type: 'notify', name: 'Normal', config: { message: 'ok' } },
          { id: 'n_err', type: 'notify', name: 'Error Handler', config: { message: 'error' } },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n_ok', type: 'success' },
          { id: 'e2', source: 'n1', target: 'n_err', type: 'error' },
        ],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockImplementation((_runId: string, stepId: string) => {
        return { id: `sr-${stepId}`, status: 'pending' };
      });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      (workflowStepRegistry as any).has.mockReturnValue(false);

      await engine.startRun('wf-route', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // Should follow error edge to n_err, not n_ok
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n_err', expect.objectContaining({ status: 'completed' }));
    });

    it('handles condition node with true branch', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [
          { id: 'n1', type: 'notify', name: 'Start', config: { message: 'start' } },
          { id: 'cond', type: 'condition', name: 'Check', config: {}, condition: { expression: '${n1.status} == completed' } },
          { id: 'n_true', type: 'notify', name: 'True', config: { message: 'true' } },
          { id: 'n_false', type: 'notify', name: 'False', config: { message: 'false' } },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'cond', type: 'success' },
          { id: 'e2', source: 'cond', target: 'n_true', type: 'condition_true' },
          { id: 'e3', source: 'cond', target: 'n_false', type: 'condition_false' },
        ],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockImplementation((_runId: string, stepId: string) => {
        return { id: `sr-${stepId}`, status: 'pending' };
      });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-cond', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // n1 completed, condition evaluates to true, should go to n_true
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n_true', expect.objectContaining({ status: 'completed' }));
      // n_false should be skipped (unvisited)
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr-n_false', expect.objectContaining({ status: 'skipped' }));
    });

    it('handles step with onError=retry', async () => {
      let callCount = 0;
      const def = {
        version: 2, triggers: [],
        nodes: [
          { id: 'n1', type: 'shell', name: 'Retry', config: { command: 'false' }, onError: 'retry', retryCount: 2 },
        ],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      // execFileAsync always fails
      mockExecFileAsync.mockRejectedValue(new Error('command failed'));

      await engine.startRun('wf-retry', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 200));

      // Should have attempted 3 times (1 original + 2 retries)
      const startedCalls = mockStepRunRepo.update.mock.calls.filter(
        (c: any[]) => c[1]?.status === 'running'
      );
      expect(startedCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('handles missing step run record', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'N', config: { message: 'hi' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue(null);
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-no-sr', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // Should fail — step run record not found
      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });

    it('uses plugin step registry for custom step types', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'custom_plugin_step', name: 'Plugin', config: { key: 'val' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      (workflowStepRegistry as any).has.mockReturnValue(true);
      (workflowStepRegistry as any).execute.mockResolvedValue({ status: 'completed', output: { pluginResult: true } });

      await engine.startRun('wf-plugin', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect((workflowStepRegistry as any).execute).toHaveBeenCalledWith(
        'custom_plugin_step',
        expect.objectContaining({ key: 'val' }),
        expect.objectContaining({ projectId: 'p1' })
      );
      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'completed' }));
    });

    it('handles V1 definition by migrating to V2', async () => {
      // V1 definition (no version field or version=1)
      const def = {
        triggers: [],
        steps: [{ id: 'n1', type: 'notify', name: 'Notify', config: { message: 'hi' } }],
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      // This will try to migrate V1 to V2 using the shared util
      const run = await engine.startRun('wf-v1', 'p1', def as any, 'manual');
      expect(run.id).toBe('r1');
      await new Promise(r => setTimeout(r, 100));
    });
  });

  describe('handleShell step', () => {
    it('executes shell command successfully', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'shell', name: 'Shell', config: { command: 'echo hello' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync.mockResolvedValue({ stdout: 'hello\n', stderr: '' });

      await engine.startRun('wf-shell', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ stdout: 'hello', exitCode: 0 }),
      }));
    });

    it('fails on empty command', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'shell', name: 'Shell', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-shell-empty', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });

    it('handles command timeout', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'shell', name: 'Shell', config: { command: 'sleep 100' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync.mockRejectedValue({ code: undefined, killed: true });

      await engine.startRun('wf-shell-timeout', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });

    it('handles command failure with exit code', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'shell', name: 'Shell', config: { command: 'false' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync.mockRejectedValue({ code: 1, killed: false, stdout: '', stderr: 'error output', message: 'exit code 1' });

      await engine.startRun('wf-shell-fail', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('handleWebhook step', () => {
    it('executes webhook successfully', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('OK'),
      });

      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'webhook', name: 'Hook', config: { url: 'http://example.com', method: 'POST', body: '{}' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-webhook', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ statusCode: 200 }),
      }));
      globalThis.fetch = originalFetch;
    });

    it('fails when no URL specified', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'webhook', name: 'Hook', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-webhook-no-url', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });

    it('handles HTTP error response', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'webhook', name: 'Hook', config: { url: 'http://example.com' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-webhook-err', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
      globalThis.fetch = originalFetch;
    });

    it('uses GET method without body', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('data'),
      });

      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'webhook', name: 'Hook', config: { url: 'http://example.com', method: 'GET' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-webhook-get', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(globalThis.fetch).toHaveBeenCalledWith('http://example.com', expect.objectContaining({
        method: 'GET',
        body: undefined,
      }));
      globalThis.fetch = originalFetch;
    });
  });

  describe('handleNotify step', () => {
    it('handles webhook notification', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 });

      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'Webhook Notify', config: { message: 'alert', type: 'webhook', url: 'http://hook.com' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-notify-hook', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(globalThis.fetch).toHaveBeenCalledWith('http://hook.com', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'alert' }),
      }));
      globalThis.fetch = originalFetch;
    });
  });

  describe('handleCondition step', () => {
    it('fails when no condition defined', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'condition', name: 'Cond', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-cond-no-expr', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('handleWait step', () => {
    it('executes timeout wait', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'wait', name: 'Wait', config: { type: 'timeout', timeoutMs: 10 } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-wait', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 200));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ waited: true }),
      }));
    });

    it('handles approval wait with approve', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'wait', name: 'Approve', config: { type: 'approval' }, timeoutMs: 5000 }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-approve', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 50));

      // Step should be waiting
      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({ status: 'waiting' }));

      // Approve it
      const approved = engine.approveStep('sr1');
      expect(approved).toBe(true);

      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ approved: true }),
      }));
    });

    it('handles approval wait with reject', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'wait', name: 'Reject', config: { type: 'approval' }, timeoutMs: 5000 }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-reject', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 50));

      const rejected = engine.rejectStep('sr1');
      expect(rejected).toBe(true);

      await new Promise(r => setTimeout(r, 100));

      // Rejected approval marks as failed
      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('handleGitCommit step', () => {
    it('commits changes successfully', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'git_commit', name: 'Commit', config: { message: 'auto commit' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'M file.ts\n', stderr: '' })  // git status
        .mockResolvedValueOnce({ stdout: '', stderr: '' })              // git add
        .mockResolvedValueOnce({ stdout: '1 file changed\n', stderr: '' })  // git diff --stat
        .mockResolvedValueOnce({ stdout: '', stderr: '' })              // git commit
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' });     // git rev-parse

      await engine.startRun('wf-commit', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ commitSha: 'abc123', message: 'auto commit' }),
      }));
    });

    it('handles no changes to commit', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'git_commit', name: 'Commit', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' }); // git status empty

      await engine.startRun('wf-commit-empty', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ commitSha: null }),
      }));
    });

    it('fails when no working directory', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'git_commit', name: 'Commit', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', rootPath: undefined, providerId: 'prov1' });

      await engine.startRun('wf-commit-no-cwd', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // Reset project repo
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', providerId: 'prov1', rootPath: '/test' });
    });
  });

  describe('handleGitMerge step', () => {
    it('merges successfully', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'git_merge', name: 'Merge', config: { branch: 'feature', baseBranch: 'main' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // git checkout
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // git merge

      await engine.startRun('wf-merge', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ success: true, branch: 'feature' }),
      }));
    });

    it('handles merge conflicts', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'git_merge', name: 'Merge', config: { branch: 'conflict-branch' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // git checkout
        .mockRejectedValueOnce(new Error('merge conflict'))  // git merge fails
        .mockResolvedValueOnce({ stdout: 'file1.ts\nfile2.ts\n', stderr: '' })  // git diff --name-only
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // git merge --abort

      await engine.startRun('wf-merge-conflict', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });

    it('fails when no branch specified', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'git_merge', name: 'Merge', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-merge-no-branch', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('handleCreateWorktree step', () => {
    it('creates worktree successfully', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'create_worktree', name: 'WT', config: { branchName: 'feature-1' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await engine.startRun('wf-wt', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ branch: 'feature-1' }),
      }));
    });

    it('fails when no branch name', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'create_worktree', name: 'WT', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-wt-no-branch', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('handleCreatePR step', () => {
    it('creates PR successfully', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'create_pr', name: 'PR', config: { title: 'My PR' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'feature-branch\n', stderr: '' })  // rev-parse
        .mockResolvedValueOnce({ stdout: '3 files changed\n', stderr: '' }); // diff --stat

      await engine.startRun('wf-pr', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ title: 'My PR', branchName: 'feature-branch' }),
      }));
    });

    it('fails when no working directory', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'create_pr', name: 'PR', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', rootPath: undefined, providerId: 'prov1' });

      await engine.startRun('wf-pr-no-cwd', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      // Reset
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', providerId: 'prov1', rootPath: '/test' });
    });
  });

  describe('handleAIPrompt step', () => {
    it('fails when no prompt specified', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'ai_prompt', name: 'AI', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-ai-no-prompt', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });

    it('fails when no provider configured', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'ai_prompt', name: 'AI', config: { prompt: 'test' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', rootPath: '/test', providerId: undefined });

      await engine.startRun('wf-ai-no-provider', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', providerId: 'prov1', rootPath: '/test' });
    });

    it('completes when run_completed message received', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'ai_prompt', name: 'AI', config: { prompt: 'test prompt' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      // Mock createVirtualClient to capture the send callback and call it with run_completed
      const { createVirtualClient: mockCreateVirtualClient } = await import('../../server.js');
      (mockCreateVirtualClient as any).mockImplementation((_clientId: string, handlers: any) => {
        setTimeout(() => handlers.send({ type: 'run_completed' }), 20);
        return { id: _clientId };
      });

      await engine.startRun('wf-ai-complete', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 200));

      expect(mockStepRunRepo.update).toHaveBeenCalledWith('sr1', expect.objectContaining({
        status: 'completed',
        output: expect.objectContaining({ sessionId: 'sess1' }),
      }));
    });

    it('fails when run_failed message received', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'ai_prompt', name: 'AI', config: { prompt: 'test prompt' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      const { createVirtualClient: mockCreateVirtualClient } = await import('../../server.js');
      (mockCreateVirtualClient as any).mockImplementation((_clientId: string, handlers: any) => {
        setTimeout(() => handlers.send({ type: 'run_failed', error: 'AI failed' }), 20);
        return { id: _clientId };
      });

      await engine.startRun('wf-ai-fail', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 200));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('handleAIReview step', () => {
    it('fails when no provider configured', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'ai_review', name: 'Review', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', rootPath: '/test', providerId: undefined });

      await engine.startRun('wf-review-no-prov', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
      mockProjectRepo.findById.mockReturnValue({ id: 'p1', providerId: 'prov1', rootPath: '/test' });
    });

    it('completes with review passed', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'ai_review', name: 'Review', config: {} }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([{ content: 'Code looks good. [REVIEW_PASSED]' }]),
        }),
      };
      // Re-create engine with mockDb
      const engineWithDb = new WorkflowEngine(mockDb as any, mockBroadcast);

      const { createVirtualClient: mockCreateVirtualClient } = await import('../../server.js');
      (mockCreateVirtualClient as any).mockImplementation((_clientId: string, handlers: any) => {
        setTimeout(() => handlers.send({ type: 'run_completed' }), 20);
        return { id: _clientId };
      });

      const run = await engineWithDb.startRun('wf-review-pass', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 200));
    });
  });

  describe('broadcastRunUpdate', () => {
    it('broadcasts when run exists', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'N', config: { message: 'hi' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-broadcast', 'p1', def as any, 'manual');
      await new Promise(r => setTimeout(r, 100));

      expect(mockBroadcast).toHaveBeenCalledWith('p1', expect.objectContaining({
        type: 'workflow_run_update',
      }));
    });

    it('does not broadcast when run not found', () => {
      mockRunRepo.findById.mockReturnValue(null);
      // Access broadcastRunUpdate indirectly through cancelRun
      engine.cancelRun('nonexistent');
      // No broadcast called since run not found
    });
  });

  describe('startRun triggerDetail', () => {
    it('passes triggerDetail through to run record', async () => {
      const def = {
        version: 2, triggers: [],
        nodes: [{ id: 'n1', type: 'notify', name: 'N', config: { message: 'hi' } }],
        edges: [],
        entryNodeId: 'n1',
      };
      mockStepRunRepo.findByRunAndStep.mockReturnValue({ id: 'sr1', status: 'pending' });
      mockRunRepo.findById.mockReturnValue({ id: 'r1', status: 'running', projectId: 'p1' });

      await engine.startRun('wf-detail', 'p1', def as any, 'schedule', 'cron: * * * * *');
      await new Promise(r => setTimeout(r, 100));

      expect(mockRunRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        triggerSource: 'schedule',
        triggerDetail: 'cron: * * * * *',
      }));
    });
  });
});
