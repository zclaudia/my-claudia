import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workflowStepRegistry, type WorkflowStepMeta } from '../workflow-step-registry.js';

// Mock the pluginLoader
vi.mock('../loader.js', () => ({
  pluginLoader: {
    checkPermissions: vi.fn().mockResolvedValue(true),
  },
}));

import { pluginLoader } from '../loader.js';

function createStepMeta(overrides: Partial<WorkflowStepMeta> = {}): WorkflowStepMeta {
  return {
    type: 'plugin1/step1',
    name: 'Test Step',
    description: 'A test step',
    category: 'testing',
    handler: vi.fn().mockResolvedValue({ status: 'completed' as const, output: { result: 'ok' } }),
    pluginId: 'plugin1',
    ...overrides,
  };
}

describe('WorkflowStepRegistry', () => {
  beforeEach(() => {
    workflowStepRegistry.clear();
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('registers a step', () => {
      const step = createStepMeta();
      workflowStepRegistry.register(step);
      expect(workflowStepRegistry.has('plugin1/step1')).toBe(true);
      expect(workflowStepRegistry.size).toBe(1);
    });

    it('warns and overwrites when registering duplicate type', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const step1 = createStepMeta({ name: 'Step V1' });
      const step2 = createStepMeta({ name: 'Step V2' });

      workflowStepRegistry.register(step1);
      workflowStepRegistry.register(step2);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
      expect(workflowStepRegistry.get('plugin1/step1')?.name).toBe('Step V2');
      expect(workflowStepRegistry.size).toBe(1);
      warnSpy.mockRestore();
    });
  });

  describe('unregister', () => {
    it('removes a step and returns true', () => {
      workflowStepRegistry.register(createStepMeta());
      expect(workflowStepRegistry.unregister('plugin1/step1')).toBe(true);
      expect(workflowStepRegistry.has('plugin1/step1')).toBe(false);
    });

    it('returns false for nonexistent type', () => {
      expect(workflowStepRegistry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('get', () => {
    it('returns step metadata', () => {
      const step = createStepMeta();
      workflowStepRegistry.register(step);
      expect(workflowStepRegistry.get('plugin1/step1')).toBe(step);
    });

    it('returns undefined for unknown type', () => {
      expect(workflowStepRegistry.get('unknown')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered type', () => {
      workflowStepRegistry.register(createStepMeta());
      expect(workflowStepRegistry.has('plugin1/step1')).toBe(true);
    });

    it('returns false for unknown type', () => {
      expect(workflowStepRegistry.has('unknown')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns all registered steps', () => {
      workflowStepRegistry.register(createStepMeta({ type: 'p1/s1', pluginId: 'p1' }));
      workflowStepRegistry.register(createStepMeta({ type: 'p2/s2', pluginId: 'p2' }));
      const all = workflowStepRegistry.getAll();
      expect(all).toHaveLength(2);
    });

    it('returns empty array when no steps registered', () => {
      expect(workflowStepRegistry.getAll()).toEqual([]);
    });
  });

  describe('getAllMeta', () => {
    it('returns serializable metadata without handler', () => {
      workflowStepRegistry.register(createStepMeta({
        type: 'p1/step',
        name: 'My Step',
        description: 'desc',
        category: 'cat',
        icon: 'star',
        configSchema: { type: 'object' },
        pluginId: 'p1',
      }));

      const meta = workflowStepRegistry.getAllMeta();
      expect(meta).toEqual([{
        type: 'p1/step',
        name: 'My Step',
        description: 'desc',
        category: 'cat',
        icon: 'star',
        configSchema: { type: 'object' },
        source: 'p1',
      }]);
    });

    it('returns empty array when no steps', () => {
      expect(workflowStepRegistry.getAllMeta()).toEqual([]);
    });
  });

  describe('getByPlugin', () => {
    it('returns steps for a specific plugin', () => {
      workflowStepRegistry.register(createStepMeta({ type: 'p1/s1', pluginId: 'p1' }));
      workflowStepRegistry.register(createStepMeta({ type: 'p1/s2', pluginId: 'p1' }));
      workflowStepRegistry.register(createStepMeta({ type: 'p2/s1', pluginId: 'p2' }));

      const p1Steps = workflowStepRegistry.getByPlugin('p1');
      expect(p1Steps).toHaveLength(2);
      expect(p1Steps.every(s => s.pluginId === 'p1')).toBe(true);
    });

    it('returns empty array for unknown plugin', () => {
      expect(workflowStepRegistry.getByPlugin('unknown')).toEqual([]);
    });
  });

  describe('clearByPlugin', () => {
    it('removes all steps for a plugin and returns count', () => {
      workflowStepRegistry.register(createStepMeta({ type: 'p1/s1', pluginId: 'p1' }));
      workflowStepRegistry.register(createStepMeta({ type: 'p1/s2', pluginId: 'p1' }));
      workflowStepRegistry.register(createStepMeta({ type: 'p2/s1', pluginId: 'p2' }));

      const count = workflowStepRegistry.clearByPlugin('p1');
      expect(count).toBe(2);
      expect(workflowStepRegistry.size).toBe(1);
      expect(workflowStepRegistry.has('p2/s1')).toBe(true);
    });

    it('returns 0 for unknown plugin', () => {
      expect(workflowStepRegistry.clearByPlugin('unknown')).toBe(0);
    });
  });

  describe('execute', () => {
    it('executes step handler with config and context', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'completed', output: { data: 42 } });
      workflowStepRegistry.register(createStepMeta({ handler }));

      const context = {
        projectId: 'proj1',
        projectRootPath: '/tmp/project',
        providerId: 'claude',
        stepRunId: 'sr1',
        runId: 'r1',
      };
      const config = { key: 'value' };

      const result = await workflowStepRegistry.execute('plugin1/step1', config, context);
      expect(result).toEqual({ status: 'completed', output: { data: 42 } });
      expect(handler).toHaveBeenCalledWith(config, context);
    });

    it('returns failed for unknown step type', async () => {
      const result = await workflowStepRegistry.execute('unknown/step', {}, {
        projectId: 'p', stepRunId: 'sr', runId: 'r',
      });
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Unknown plugin step type');
    });

    it('checks plugin permissions before executing', async () => {
      workflowStepRegistry.register(createStepMeta());
      vi.mocked(pluginLoader.checkPermissions).mockResolvedValue(false);

      const result = await workflowStepRegistry.execute('plugin1/step1', {}, {
        projectId: 'p', stepRunId: 'sr', runId: 'r',
      });
      expect(result.status).toBe('failed');
      expect(result.error).toContain('permissions denied');
    });

    it('handles handler throwing error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler crashed'));
      workflowStepRegistry.register(createStepMeta({ handler }));
      vi.mocked(pluginLoader.checkPermissions).mockResolvedValue(true);

      const result = await workflowStepRegistry.execute('plugin1/step1', {}, {
        projectId: 'p', stepRunId: 'sr', runId: 'r',
      });
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Handler crashed');
    });

    it('handles non-Error thrown values', async () => {
      const handler = vi.fn().mockRejectedValue('string error');
      workflowStepRegistry.register(createStepMeta({ handler }));
      vi.mocked(pluginLoader.checkPermissions).mockResolvedValue(true);

      const result = await workflowStepRegistry.execute('plugin1/step1', {}, {
        projectId: 'p', stepRunId: 'sr', runId: 'r',
      });
      expect(result.status).toBe('failed');
      expect(result.error).toContain('string error');
    });
  });

  describe('size', () => {
    it('returns 0 when empty', () => {
      expect(workflowStepRegistry.size).toBe(0);
    });

    it('returns correct count', () => {
      workflowStepRegistry.register(createStepMeta({ type: 'a/1' }));
      workflowStepRegistry.register(createStepMeta({ type: 'a/2' }));
      expect(workflowStepRegistry.size).toBe(2);
    });
  });

  describe('clear', () => {
    it('removes all steps', () => {
      workflowStepRegistry.register(createStepMeta({ type: 'a/1' }));
      workflowStepRegistry.register(createStepMeta({ type: 'a/2' }));
      workflowStepRegistry.clear();
      expect(workflowStepRegistry.size).toBe(0);
    });
  });
});
