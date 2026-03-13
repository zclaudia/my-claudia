/**
 * Unit tests for WorkerHost
 *
 * Tests worker lifecycle management: start, stop, error handling, and RPC proxying.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so these are available inside vi.mock factories (which are hoisted)
const {
  workerState,
  mockWorkerTerminate,
  mockWorkerPostMessage,
  mockWorkerConstructor,
  mockPluginEvents,
  mockToolRegistry,
  mockCommandRegistry,
  mockPermissionManager,
  mockStorage,
  mockFsPromises,
} = vi.hoisted(() => {
  const workerState = {
    handlers: {} as Record<string, Array<(data: any) => void>>,
    lastInstance: null as any,
    autoActivate: true,
    activateWithError: null as string | null,
    autoDeactivate: true,
    deactivateWithError: null as string | null,
  };

  return {
    workerState,
    mockWorkerTerminate: vi.fn().mockResolvedValue(undefined),
    mockWorkerPostMessage: vi.fn(),
    mockWorkerConstructor: vi.fn(),
    mockPluginEvents: {
      emit: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      clearByPlugin: vi.fn(),
    },
    mockToolRegistry: {
      register: vi.fn(),
      unregister: vi.fn(),
      clearByPlugin: vi.fn(),
    },
    mockCommandRegistry: {
      register: vi.fn(),
      unregister: vi.fn(),
      clearByPlugin: vi.fn(),
    },
    mockPermissionManager: {
      hasPermission: vi.fn(() => false),
      hasAllPermissions: vi.fn(() => false),
      getGrantedPermissions: vi.fn(() => []),
    },
    mockStorage: {
      get: vi.fn().mockReturnValue('value1'),
      set: vi.fn(),
      delete: vi.fn(),
      keys: vi.fn(() => ['k1', 'k2']),
      clear: vi.fn(),
    },
    mockFsPromises: {
      readFile: vi.fn().mockResolvedValue('file-content'),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue(['a.txt', 'b.txt']),
      mkdir: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('worker_threads', () => {
  return {
    Worker: class MockWorker {
      constructor(...args: any[]) {
        mockWorkerConstructor(...args);
        workerState.handlers = {};
        workerState.lastInstance = this;

        if (workerState.autoActivate && !workerState.activateWithError) {
          setTimeout(() => {
            this.emitToHandlers('message', { type: 'activated' });
          }, 5);
        } else if (workerState.activateWithError) {
          setTimeout(() => {
            this.emitToHandlers('message', {
              type: 'activation_error',
              error: workerState.activateWithError,
            });
          }, 5);
        }
      }

      emitToHandlers(event: string, data: any) {
        const handlers = workerState.handlers[event];
        if (handlers) {
          // Copy array to avoid mutation during iteration
          [...handlers].forEach(h => h(data));
        }
      }

      on(event: string, handler: Function) {
        if (!workerState.handlers[event]) workerState.handlers[event] = [];
        workerState.handlers[event].push(handler as any);
      }

      off(event: string, handler: Function) {
        if (workerState.handlers[event]) {
          workerState.handlers[event] = workerState.handlers[event].filter(h => h !== handler);
        }
      }

      postMessage = vi.fn((msg: any) => {
        mockWorkerPostMessage(msg);
        if (msg.type === 'deactivate') {
          if (workerState.autoDeactivate) {
            setTimeout(() => {
              const responseType = workerState.deactivateWithError
                ? 'deactivate_error'
                : 'deactivated';
              this.emitToHandlers('message', {
                type: responseType,
                ...(workerState.deactivateWithError
                  ? { error: workerState.deactivateWithError }
                  : {}),
              });
            }, 5);
          }
        }
      });

      terminate = mockWorkerTerminate;
    },
  };
});

vi.mock('../../events/index.js', () => ({
  pluginEvents: mockPluginEvents,
}));

vi.mock('../tool-registry.js', () => ({
  toolRegistry: mockToolRegistry,
}));

vi.mock('../../commands/registry.js', () => ({
  commandRegistry: mockCommandRegistry,
}));

vi.mock('../permissions.js', () => ({
  permissionManager: mockPermissionManager,
}));

vi.mock('../storage.js', () => ({
  pluginStorageManager: {
    getStorage: vi.fn(() => mockStorage),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  promises: mockFsPromises,
}));

import { WorkerHost } from '../worker-host.js';
import * as fs from 'fs';
import { pluginStorageManager } from '../storage.js';

describe('WorkerHost', () => {
  let host: WorkerHost;

  beforeEach(() => {
    vi.clearAllMocks();
    workerState.handlers = {};
    workerState.lastInstance = null;
    workerState.autoActivate = true;
    workerState.activateWithError = null;
    workerState.autoDeactivate = true;
    workerState.deactivateWithError = null;
    host = new WorkerHost();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================
  // Lifecycle
  // ============================

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

    it('should throw if worker runner file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);
      await expect(host.startPlugin('test.plugin', '/path/to/module.js')).rejects.toThrow(
        /Worker runner not found/,
      );
    });

    it('should reject on activation error', async () => {
      workerState.activateWithError = 'Plugin failed to load';
      workerState.autoActivate = false;
      await expect(host.startPlugin('test.plugin', '/path/to/module.js')).rejects.toThrow(
        'Plugin failed to load',
      );
      expect(host.hasWorker('test.plugin')).toBe(false);
      expect(mockWorkerTerminate).toHaveBeenCalled();
    });

    it('should reject on activation timeout', async () => {
      vi.useFakeTimers();
      workerState.autoActivate = false;

      const startPromise = host.startPlugin('test.plugin', '/path/to/module.js');

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
      const assertionPromise = expect(startPromise).rejects.toThrow(/activation timed out/);

      await vi.advanceTimersByTimeAsync(30_001);
      await assertionPromise;

      expect(host.hasWorker('test.plugin')).toBe(false);

      vi.useRealTimers();
    });

    it('should handle worker error events', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');

      const errorHandlers = workerState.handlers['error'] || [];
      expect(errorHandlers.length).toBeGreaterThan(0);
      errorHandlers.forEach(h => h(new Error('Worker crash')));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Worker error for test.plugin'),
        'Worker crash',
      );
      expect(mockPluginEvents.emit).toHaveBeenCalledWith(
        'plugin.error',
        { pluginId: 'test.plugin', error: 'Worker crash' },
        'test.plugin',
      );
      errorSpy.mockRestore();
    });

    it('should handle worker exit with non-zero code', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');

      const exitHandlers = workerState.handlers['exit'] || [];
      expect(exitHandlers.length).toBeGreaterThan(0);
      exitHandlers.forEach(h => h(1));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('exited with code 1'),
      );
      expect(host.hasWorker('test.plugin')).toBe(false);
      errorSpy.mockRestore();
    });

    it('should handle worker exit with code 0 (clean exit)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');

      const exitHandlers = workerState.handlers['exit'] || [];
      exitHandlers.forEach(h => h(0));

      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('exited with code'),
      );
      errorSpy.mockRestore();
    });
  });

  describe('stopPlugin', () => {
    it('should terminate the worker', async () => {
      await host.startPlugin('test.plugin', '/path/to/module.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.stopPlugin('test.plugin');
      expect(mockWorkerTerminate).toHaveBeenCalled();
      expect(host.hasWorker('test.plugin')).toBe(false);
      logSpy.mockRestore();
    });

    it('should clean up registrations', async () => {
      await host.startPlugin('test.plugin', '/path/to/module.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.stopPlugin('test.plugin');
      expect(mockCommandRegistry.clearByPlugin).toHaveBeenCalledWith('test.plugin');
      expect(mockToolRegistry.clearByPlugin).toHaveBeenCalledWith('test.plugin');
      expect(mockPluginEvents.clearByPlugin).toHaveBeenCalledWith('test.plugin');
      logSpy.mockRestore();
    });

    it('should handle missing plugin gracefully', async () => {
      await host.stopPlugin('nonexistent');
    });

    it('should handle deactivation error message', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');
      workerState.deactivateWithError = 'cleanup failed';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.stopPlugin('test.plugin');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deactivation error'),
        'cleanup failed',
      );
      expect(mockWorkerTerminate).toHaveBeenCalled();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should handle deactivation timeout', async () => {
      vi.useFakeTimers();
      workerState.autoDeactivate = false;
      workerState.autoActivate = false;

      const startPromise = host.startPlugin('test.plugin', '/path/to/module.js');
      await vi.advanceTimersByTimeAsync(1);
      workerState.lastInstance?.emitToHandlers('message', { type: 'activated' });
      await startPromise;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const stopPromise = host.stopPlugin('test.plugin');

      await vi.advanceTimersByTimeAsync(10_001);
      await stopPromise;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error during deactivation'),
        expect.stringContaining('timed out'),
      );
      expect(mockWorkerTerminate).toHaveBeenCalled();
      warnSpy.mockRestore();
      logSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('stopAll', () => {
    it('should stop all running workers', async () => {
      await host.startPlugin('plugin.a', '/path/a.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.stopAll();
      expect(host.hasWorker('plugin.a')).toBe(false);
      logSpy.mockRestore();
    });
  });

  describe('setDatabase / setBroadcast', () => {
    it('should store database reference', () => {
      const fakeDb = {} as any;
      host.setDatabase(fakeDb);
    });

    it('should store broadcast function', () => {
      const fn = vi.fn();
      host.setBroadcast(fn);
    });
  });

  // ============================
  // RPC Handling
  // ============================

  describe('RPC via setupRPCHandler', () => {
    async function sendRPC(
      _hostInst: WorkerHost,
      method: string,
      args: unknown[],
    ): Promise<any> {
      return new Promise<any>((resolve) => {
        const rpcId = `rpc_${Date.now()}_${Math.random()}`;

        const origPostMessage = workerState.lastInstance.postMessage;
        workerState.lastInstance.postMessage = vi.fn((msg: any) => {
          origPostMessage.call(workerState.lastInstance, msg);
          if (msg.type === 'rpc_response' && msg.id === rpcId) {
            resolve(msg);
          }
        });

        const messageHandlers = workerState.handlers['message'] || [];
        messageHandlers.forEach(h =>
          h({ type: 'rpc_request', id: rpcId, method, args }),
        );
      });
    }

    let logSpy: any;

    beforeEach(async () => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    // --- Storage RPC ---

    it('should handle storage.get', async () => {
      const resp = await sendRPC(host, 'storage.get', ['myKey']);
      expect(resp.result).toBe('value1');
      expect(pluginStorageManager.getStorage).toHaveBeenCalledWith('test.plugin');
      expect(mockStorage.get).toHaveBeenCalledWith('myKey');
    });

    it('should handle storage.set', async () => {
      const resp = await sendRPC(host, 'storage.set', ['myKey', 'myVal']);
      expect(mockStorage.set).toHaveBeenCalledWith('myKey', 'myVal');
      expect(resp.error).toBeUndefined();
    });

    it('should handle storage.delete', async () => {
      const resp = await sendRPC(host, 'storage.delete', ['myKey']);
      expect(mockStorage.delete).toHaveBeenCalledWith('myKey');
      expect(resp.error).toBeUndefined();
    });

    it('should handle storage.keys', async () => {
      const resp = await sendRPC(host, 'storage.keys', []);
      expect(resp.result).toEqual(['k1', 'k2']);
    });

    it('should handle storage.clear', async () => {
      const resp = await sendRPC(host, 'storage.clear', []);
      expect(mockStorage.clear).toHaveBeenCalled();
      expect(resp.error).toBeUndefined();
    });

    // --- Events RPC ---

    it('should handle events.on', async () => {
      const resp = await sendRPC(host, 'events.on', ['run.started']);
      expect(resp.result).toBeUndefined();
      expect(mockPluginEvents.on).toHaveBeenCalledWith(
        'run.started',
        expect.any(Function),
        'test.plugin',
      );
    });

    it('should handle events.off', async () => {
      await sendRPC(host, 'events.on', ['run.started']);
      const registeredListener = mockPluginEvents.on.mock.calls[0][1];

      const resp = await sendRPC(host, 'events.off', ['run.started']);
      expect(resp.result).toBeUndefined();
      expect(mockPluginEvents.off).toHaveBeenCalledWith('run.started', registeredListener);
    });

    it('should handle events.off for non-registered event', async () => {
      const resp = await sendRPC(host, 'events.off', ['unknown.event']);
      expect(resp.result).toBeUndefined();
      expect(mockPluginEvents.off).not.toHaveBeenCalled();
    });

    it('should handle events.once', async () => {
      const resp = await sendRPC(host, 'events.once', ['run.completed']);
      expect(resp.result).toBeUndefined();
      expect(mockPluginEvents.once).toHaveBeenCalledWith(
        'run.completed',
        expect.any(Function),
        'test.plugin',
      );
    });

    it('should handle events.emit', async () => {
      const resp = await sendRPC(host, 'events.emit', ['custom.event', { key: 'val' }]);
      expect(resp.result).toBeUndefined();
      expect(mockPluginEvents.emit).toHaveBeenCalledWith(
        'custom.event',
        { key: 'val' },
        'test.plugin',
      );
    });

    it('should forward events to worker via event_forward message', async () => {
      await sendRPC(host, 'events.on', ['run.started']);
      const registeredListener = mockPluginEvents.on.mock.calls[0][1];

      registeredListener({ sessionId: '123' });

      expect(workerState.lastInstance.postMessage).toHaveBeenCalledWith({
        type: 'event_forward',
        event: 'run.started',
        data: { sessionId: '123' },
      });
    });

    it('should handle event_forward error gracefully when worker is terminated', async () => {
      await sendRPC(host, 'events.on', ['run.started']);
      const registeredListener = mockPluginEvents.on.mock.calls[0][1];

      workerState.lastInstance.postMessage = vi.fn(() => {
        throw new Error('worker terminated');
      });

      expect(() => registeredListener({ data: 'test' })).not.toThrow();
    });

    it('should clean up once listener after firing', async () => {
      await sendRPC(host, 'events.once', ['run.completed']);
      const registeredListener = mockPluginEvents.once.mock.calls[0][1];

      workerState.lastInstance.postMessage = vi.fn();
      registeredListener({ result: 'done' });

      const resp = await sendRPC(host, 'events.off', ['run.completed']);
      expect(resp.result).toBeUndefined();
      expect(mockPluginEvents.off).not.toHaveBeenCalled();
    });

    it('should handle once event_forward error gracefully', async () => {
      await sendRPC(host, 'events.once', ['run.completed']);
      const registeredListener = mockPluginEvents.once.mock.calls[0][1];

      workerState.lastInstance.postMessage = vi.fn(() => {
        throw new Error('worker terminated');
      });

      expect(() => registeredListener({ data: 'test' })).not.toThrow();
    });

    // --- Commands RPC ---

    it('should handle commands.register', async () => {
      const resp = await sendRPC(host, 'commands.register', ['my-command']);
      expect(resp.result).toBeUndefined();
      expect(mockCommandRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'my-command',
          source: 'plugin',
          pluginId: 'test.plugin',
        }),
      );
    });

    it('should handle commands.unregister', async () => {
      const resp = await sendRPC(host, 'commands.unregister', ['my-command']);
      expect(resp.result).toBeUndefined();
      expect(mockCommandRegistry.unregister).toHaveBeenCalledWith('my-command');
    });

    // --- Tools RPC ---

    it('should handle tools.register', async () => {
      const resp = await sendRPC(host, 'tools.register', [
        'my-tool',
        'My Tool',
        'Does stuff',
        { type: 'object' },
      ]);
      expect(resp.result).toBeUndefined();
      expect(mockToolRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'my-tool',
          definition: {
            type: 'function',
            function: {
              name: 'My Tool',
              description: 'Does stuff',
              parameters: { type: 'object' },
            },
          },
          source: 'plugin',
          pluginId: 'test.plugin',
        }),
      );
    });

    it('should handle tools.unregister', async () => {
      const resp = await sendRPC(host, 'tools.unregister', ['my-tool']);
      expect(resp.result).toBeUndefined();
      expect(mockToolRegistry.unregister).toHaveBeenCalledWith('my-tool');
    });

    // --- Permissions RPC ---

    it('should handle permissions.has', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const resp = await sendRPC(host, 'permissions.has', ['fs.read']);
      expect(resp.result).toBe(true);
      expect(mockPermissionManager.hasPermission).toHaveBeenCalledWith('test.plugin', 'fs.read');
    });

    it('should handle permissions.hasAll', async () => {
      mockPermissionManager.hasAllPermissions.mockReturnValueOnce(true);
      const resp = await sendRPC(host, 'permissions.hasAll', [['fs.read', 'fs.write']]);
      expect(resp.result).toBe(true);
    });

    it('should handle permissions.request (returns false)', async () => {
      const resp = await sendRPC(host, 'permissions.request', ['fs.read']);
      expect(resp.result).toBe(false);
    });

    it('should handle permissions.requestAll (returns false)', async () => {
      const resp = await sendRPC(host, 'permissions.requestAll', [['fs.read']]);
      expect(resp.result).toBe(false);
    });

    it('should handle permissions.getGranted', async () => {
      mockPermissionManager.getGrantedPermissions.mockReturnValueOnce(['fs.read']);
      const resp = await sendRPC(host, 'permissions.getGranted', []);
      expect(resp.result).toEqual(['fs.read']);
    });

    // --- File System RPC ---

    it('should handle fs.readFile with permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const resp = await sendRPC(host, 'fs.readFile', ['/tmp/test.txt']);
      expect(resp.result).toBe('file-content');
      expect(mockFsPromises.readFile).toHaveBeenCalledWith('/tmp/test.txt', 'utf-8');
    });

    it('should deny fs.readFile without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'fs.readFile', ['/tmp/test.txt']);
      expect(resp.error).toContain('Permission denied: fs.read');
    });

    it('should handle fs.writeFile with permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const resp = await sendRPC(host, 'fs.writeFile', ['/tmp/test.txt', 'data']);
      expect(resp.result).toBeUndefined();
      expect(mockFsPromises.writeFile).toHaveBeenCalledWith('/tmp/test.txt', 'data', 'utf-8');
    });

    it('should deny fs.writeFile without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'fs.writeFile', ['/tmp/test.txt', 'data']);
      expect(resp.error).toContain('Permission denied: fs.write');
    });

    it('should handle fs.exists', async () => {
      const resp = await sendRPC(host, 'fs.exists', ['/tmp/test.txt']);
      expect(resp.result).toBe(true);
    });

    it('should handle fs.readdir with permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const resp = await sendRPC(host, 'fs.readdir', ['/tmp']);
      expect(resp.result).toEqual(['a.txt', 'b.txt']);
    });

    it('should deny fs.readdir without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'fs.readdir', ['/tmp']);
      expect(resp.error).toContain('Permission denied: fs.read');
    });

    it('should handle fs.mkdir with permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const resp = await sendRPC(host, 'fs.mkdir', ['/tmp/newdir']);
      expect(resp.result).toBeUndefined();
      expect(mockFsPromises.mkdir).toHaveBeenCalledWith('/tmp/newdir', { recursive: true });
    });

    it('should deny fs.mkdir without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'fs.mkdir', ['/tmp/newdir']);
      expect(resp.error).toContain('Permission denied: fs.write');
    });

    it('should handle fs.unlink with permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const resp = await sendRPC(host, 'fs.unlink', ['/tmp/test.txt']);
      expect(resp.result).toBeUndefined();
      expect(mockFsPromises.unlink).toHaveBeenCalledWith('/tmp/test.txt');
    });

    it('should deny fs.unlink without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'fs.unlink', ['/tmp/test.txt']);
      expect(resp.error).toContain('Permission denied: fs.write');
    });

    // --- Network RPC ---

    it('should handle network.fetch with permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('response-body'),
      });
      globalThis.fetch = mockFetch;

      const resp = await sendRPC(host, 'network.fetch', [
        'https://example.com',
        { method: 'GET' },
      ]);
      expect(resp.result).toEqual({ ok: true, status: 200, body: 'response-body' });
      expect(mockFetch).toHaveBeenCalledWith('https://example.com', { method: 'GET' });
    });

    it('should deny network.fetch without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'network.fetch', ['https://example.com']);
      expect(resp.error).toContain('Permission denied: network.fetch');
    });

    // --- Shell RPC ---

    it('should deny shell.execute without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'shell.execute', ['ls', ['-la']]);
      expect(resp.error).toContain('Permission denied: shell.execute');
    });

    // --- Notification RPC ---

    it('should handle notification.show with permission and broadcast', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(true);
      const broadcastFn = vi.fn();
      host.setBroadcast(broadcastFn);

      // Re-start plugin so broadcast is available
      await host.stopPlugin('test.plugin');
      await host.startPlugin('test.plugin', '/path/to/module.js');

      const resp = await sendRPC(host, 'notification.show', ['Title', 'Body']);
      expect(resp.result).toBeUndefined();
      expect(mockPluginEvents.emit).toHaveBeenCalledWith(
        'plugin.notification',
        { pluginId: 'test.plugin', title: 'Title', body: 'Body' },
      );
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'plugin_notification',
        pluginId: 'test.plugin',
        title: 'Title',
        body: 'Body',
      });
    });

    it('should deny notification.show without permission', async () => {
      mockPermissionManager.hasPermission.mockReturnValueOnce(false);
      const resp = await sendRPC(host, 'notification.show', ['Title', 'Body']);
      expect(resp.error).toContain('Permission denied: notification');
    });

    // --- Exports / getPluginAPI ---

    it('should handle exports RPC', async () => {
      const resp = await sendRPC(host, 'exports', []);
      expect(resp.result).toBeUndefined();
    });

    it('should handle getPluginAPI RPC', async () => {
      const resp = await sendRPC(host, 'getPluginAPI', ['other-plugin']);
      expect(resp.result).toBeUndefined();
    });

    // --- Unknown method ---

    it('should return error for unknown RPC method', async () => {
      const resp = await sendRPC(host, 'unknown.method', []);
      expect(resp.error).toContain('Unknown RPC method: unknown.method');
    });

    // --- Non-RPC messages are ignored ---

    it('should ignore non-rpc messages', async () => {
      const messageHandlers = workerState.handlers['message'] || [];
      messageHandlers.forEach(h => h({ type: 'some_other_type', data: 'whatever' }));
    });
  });

  // ============================
  // Forward Tool Call
  // ============================

  describe('forwardToolCall', () => {
    it('should forward tool call to worker and resolve with result', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');

      const messageHandlers = workerState.handlers['message'] || [];
      messageHandlers.forEach(h =>
        h({
          type: 'rpc_request',
          id: 'reg1',
          method: 'tools.register',
          args: ['my-tool', 'My Tool', 'desc', {}],
        }),
      );
      await new Promise(r => setTimeout(r, 10));

      const registerCall = mockToolRegistry.register.mock.calls[0][0];
      const toolHandler = registerCall.handler;

      const origPostMessage = workerState.lastInstance.postMessage;
      workerState.lastInstance.postMessage = vi.fn((msg: any) => {
        origPostMessage.call(workerState.lastInstance, msg);
        if (msg.type === 'tool_call') {
          setTimeout(() => {
            workerState.lastInstance.emitToHandlers('message', {
              type: 'tool_result',
              id: msg.id,
              result: 'tool-output',
            });
          }, 5);
        }
      });

      const result = await toolHandler({ input: 'test' });
      expect(result).toBe('tool-output');
      logSpy.mockRestore();
    });

    it('should resolve with error JSON when tool call returns error', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');

      const messageHandlers = workerState.handlers['message'] || [];
      messageHandlers.forEach(h =>
        h({
          type: 'rpc_request',
          id: 'reg2',
          method: 'tools.register',
          args: ['err-tool', 'Err Tool', 'desc', {}],
        }),
      );
      await new Promise(r => setTimeout(r, 10));

      const registerCall = mockToolRegistry.register.mock.calls[0][0];
      const toolHandler = registerCall.handler;

      const origPostMessage = workerState.lastInstance.postMessage;
      workerState.lastInstance.postMessage = vi.fn((msg: any) => {
        origPostMessage.call(workerState.lastInstance, msg);
        if (msg.type === 'tool_call') {
          setTimeout(() => {
            workerState.lastInstance.emitToHandlers('message', {
              type: 'tool_result',
              id: msg.id,
              error: 'tool failed',
            });
          }, 5);
        }
      });

      const result = await toolHandler({ input: 'test' });
      expect(JSON.parse(result)).toEqual({ error: 'tool failed' });
      logSpy.mockRestore();
    });

    it('should resolve with timeout error when tool call times out', async () => {
      vi.useFakeTimers();
      workerState.autoActivate = false;

      const startPromise = host.startPlugin('test.plugin', '/path/to/module.js');
      await vi.advanceTimersByTimeAsync(1);
      workerState.lastInstance.emitToHandlers('message', { type: 'activated' });
      await startPromise;

      const messageHandlers = workerState.handlers['message'] || [];
      messageHandlers.forEach(h =>
        h({
          type: 'rpc_request',
          id: 'reg3',
          method: 'tools.register',
          args: ['slow-tool', 'Slow Tool', 'desc', {}],
        }),
      );
      await vi.advanceTimersByTimeAsync(1);

      const registerCall = mockToolRegistry.register.mock.calls[0][0];
      const toolHandler = registerCall.handler;

      const resultPromise = toolHandler({ input: 'test' });
      await vi.advanceTimersByTimeAsync(30_001);

      const result = await resultPromise;
      expect(JSON.parse(result)).toEqual({ error: expect.stringContaining('timed out') });

      vi.useRealTimers();
    });
  });

  // ============================
  // Forward Command Call
  // ============================

  describe('forwardCommandCall', () => {
    it('should forward command call and resolve with result', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await host.startPlugin('test.plugin', '/path/to/module.js');

      const messageHandlers = workerState.handlers['message'] || [];
      messageHandlers.forEach(h =>
        h({
          type: 'rpc_request',
          id: 'creg1',
          method: 'commands.register',
          args: ['my-cmd'],
        }),
      );
      await new Promise(r => setTimeout(r, 10));

      const registerCall = mockCommandRegistry.register.mock.calls[0][0];
      const cmdHandler = registerCall.handler;

      const origPostMessage = workerState.lastInstance.postMessage;
      workerState.lastInstance.postMessage = vi.fn((msg: any) => {
        origPostMessage.call(workerState.lastInstance, msg);
        if (msg.type === 'command_call') {
          setTimeout(() => {
            workerState.lastInstance.emitToHandlers('message', {
              type: 'command_result',
              id: msg.id,
              result: { type: 'builtin', command: 'my-cmd', output: 'done' },
            });
          }, 5);
        }
      });

      const result = await cmdHandler(['arg1', 'arg2'], {});
      expect(result).toEqual({ type: 'builtin', command: 'my-cmd', output: 'done' });
      logSpy.mockRestore();
    });

    it('should resolve with timeout error when command call times out', async () => {
      vi.useFakeTimers();
      workerState.autoActivate = false;

      const startPromise = host.startPlugin('test.plugin', '/path/to/module.js');
      await vi.advanceTimersByTimeAsync(1);
      workerState.lastInstance.emitToHandlers('message', { type: 'activated' });
      await startPromise;

      const messageHandlers = workerState.handlers['message'] || [];
      messageHandlers.forEach(h =>
        h({
          type: 'rpc_request',
          id: 'creg2',
          method: 'commands.register',
          args: ['slow-cmd'],
        }),
      );
      await vi.advanceTimersByTimeAsync(1);

      const registerCall = mockCommandRegistry.register.mock.calls[0][0];
      const cmdHandler = registerCall.handler;

      const resultPromise = cmdHandler(['arg1'], {});
      await vi.advanceTimersByTimeAsync(30_001);

      const result = await resultPromise;
      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining('timed out') }),
      );

      vi.useRealTimers();
    });
  });

  describe('hasWorker', () => {
    it('should return false for unknown plugin', () => {
      expect(host.hasWorker('unknown')).toBe(false);
    });
  });
});
