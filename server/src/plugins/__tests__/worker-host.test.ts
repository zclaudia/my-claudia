/**
 * Unit tests for WorkerHost
 *
 * Tests worker lifecycle management: start, stop, error handling, and RPC proxying.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track message handlers per worker instance
let workerMessageHandlers: Array<(msg: any) => void> = [];
const mockWorkerTerminate = vi.fn().mockResolvedValue(undefined);
const mockWorkerConstructor = vi.fn();

vi.mock('worker_threads', () => {
  return {
    Worker: class MockWorker {
      constructor(...args: any[]) {
        mockWorkerConstructor(...args);
        workerMessageHandlers = [];
        // Simulate activation after a tick
        setTimeout(() => {
          workerMessageHandlers.forEach(h => h({ type: 'activated' }));
        }, 10);
      }
      on(event: string, handler: Function) {
        if (event === 'message') {
          workerMessageHandlers.push(handler as any);
        }
      }
      off(event: string, handler: Function) {
        if (event === 'message') {
          workerMessageHandlers = workerMessageHandlers.filter(h => h !== handler);
        }
      }
      postMessage(msg: any) {
        if (msg.type === 'deactivate') {
          // Auto-respond with deactivated
          setTimeout(() => {
            workerMessageHandlers.forEach(h => h({ type: 'deactivated' }));
          }, 5);
        }
      }
      terminate = mockWorkerTerminate;
    },
  };
});

// Mock dependencies
vi.mock('../../events/index.js', () => ({
  pluginEvents: {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
    once: vi.fn(),
    clearByPlugin: vi.fn(),
  },
}));

vi.mock('../tool-registry.js', () => ({
  toolRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    clearByPlugin: vi.fn(),
  },
}));

vi.mock('../../commands/registry.js', () => ({
  commandRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    clearByPlugin: vi.fn(),
  },
}));

vi.mock('../permissions.js', () => ({
  permissionManager: {
    hasPermission: vi.fn(() => false),
    hasAllPermissions: vi.fn(() => false),
    getGrantedPermissions: vi.fn(() => []),
  },
}));

vi.mock('../storage.js', () => ({
  pluginStorageManager: {
    getStorage: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      keys: vi.fn(() => []),
      clear: vi.fn(),
    })),
  },
}));

// Mock fs for file existence check
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { WorkerHost } from '../worker-host.js';
import { commandRegistry } from '../../commands/registry.js';
import { toolRegistry } from '../tool-registry.js';
import { pluginEvents } from '../../events/index.js';

describe('WorkerHost', () => {
  let host: WorkerHost;

  beforeEach(() => {
    vi.clearAllMocks();
    workerMessageHandlers = [];
    host = new WorkerHost();
  });

  describe('startPlugin', () => {
    it('should create a worker with resource limits', async () => {
      await host.startPlugin('test.plugin', '/path/to/module.js');

      expect(mockWorkerConstructor).toHaveBeenCalledTimes(1);
      const [_path, options] = mockWorkerConstructor.mock.calls[0];
      expect(options.workerData).toEqual({
        pluginId: 'test.plugin',
        modulePath: '/path/to/module.js',
      });
      expect(options.resourceLimits).toBeDefined();
      expect(options.resourceLimits.maxOldGenerationSizeMb).toBe(128);
      expect(options.resourceLimits.maxYoungGenerationSizeMb).toBe(32);
    });

    it('should report hasWorker after start', async () => {
      expect(host.hasWorker('test.plugin')).toBe(false);
      await host.startPlugin('test.plugin', '/path/to/module.js');
      expect(host.hasWorker('test.plugin')).toBe(true);
    });

    it('should warn if plugin already has a worker', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');
      await host.startPlugin('test.plugin', '/path/to/module.js');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already has a worker'));
      warnSpy.mockRestore();
    });
  });

  describe('stopPlugin', () => {
    it('should terminate the worker', async () => {
      await host.startPlugin('test.plugin', '/path/to/module.js');
      await host.stopPlugin('test.plugin');
      expect(mockWorkerTerminate).toHaveBeenCalled();
      expect(host.hasWorker('test.plugin')).toBe(false);
    });

    it('should clean up registrations', async () => {
      await host.startPlugin('test.plugin', '/path/to/module.js');
      await host.stopPlugin('test.plugin');
      expect(commandRegistry.clearByPlugin).toHaveBeenCalledWith('test.plugin');
      expect(toolRegistry.clearByPlugin).toHaveBeenCalledWith('test.plugin');
      expect(pluginEvents.clearByPlugin).toHaveBeenCalledWith('test.plugin');
    });

    it('should handle missing plugin gracefully', async () => {
      await host.stopPlugin('nonexistent');
    });
  });

  describe('stopAll', () => {
    it('should stop all running workers', async () => {
      await host.startPlugin('plugin.a', '/path/a.js');
      await host.stopAll();
      expect(host.hasWorker('plugin.a')).toBe(false);
    });
  });

  describe('hasWorker', () => {
    it('should return false for unknown plugin', () => {
      expect(host.hasWorker('unknown')).toBe(false);
    });
  });
});
