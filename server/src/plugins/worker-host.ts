/**
 * Worker Host - Manages Worker threads for plugin isolation.
 *
 * Each plugin with executionMode: 'worker' runs in its own Worker thread
 * with resource limits. The host proxies PluginContext API calls from
 * workers back to the main thread services.
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { pluginEvents } from '../events/index.js';
import { commandRegistry } from '../commands/registry.js';
import { toolRegistry } from './tool-registry.js';
import { permissionManager } from './permissions.js';
import { pluginStorageManager } from './storage.js';
import type { Permission } from '@my-claudia/shared';

// ============================================
// Types
// ============================================

interface WorkerEntry {
  worker: Worker;
  pluginId: string;
  activatedPromise: Promise<void>;
  toolHandlers: Map<string, string>; // toolId → tool_call forwarding
  commandHandlers: Map<string, string>; // command → command_call forwarding
  eventListeners: Map<string, (data: any) => void>; // event → listener (for cleanup)
}

interface RPCRequest {
  type: 'rpc_request';
  id: string;
  method: string;
  args: unknown[];
}

const ACTIVATION_TIMEOUT_MS = 30_000;

const WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
};

// ============================================
// Worker Host
// ============================================

export class WorkerHost {
  private workers = new Map<string, WorkerEntry>();
  private db: import('better-sqlite3').Database | null = null;
  private broadcastFn: ((msg: any) => void) | null = null;

  setDatabase(db: import('better-sqlite3').Database): void {
    this.db = db;
  }

  setBroadcast(fn: (msg: any) => void): void {
    this.broadcastFn = fn;
  }

  /**
   * Start a plugin in a Worker thread.
   */
  async startPlugin(pluginId: string, modulePath: string): Promise<void> {
    if (this.workers.has(pluginId)) {
      console.warn(`[WorkerHost] Plugin ${pluginId} already has a worker running`);
      return;
    }

    const runnerPath = path.join(__dirname, 'worker-runner.js');
    if (!fs.existsSync(runnerPath)) {
      throw new Error(`Worker runner not found: ${runnerPath}. Ensure the server is built.`);
    }

    const worker = new Worker(runnerPath, {
      workerData: { pluginId, modulePath },
      resourceLimits: WORKER_RESOURCE_LIMITS,
    });

    const entry: WorkerEntry = {
      worker,
      pluginId,
      activatedPromise: Promise.resolve(),
      toolHandlers: new Map(),
      commandHandlers: new Map(),
      eventListeners: new Map(),
    };

    // Set up the activation promise with timeout
    entry.activatedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.off('message', onMessage);
        // Clean up on timeout — terminate worker and remove entry
        worker.terminate().catch(() => {});
        this.workers.delete(pluginId);
        reject(new Error(`Plugin ${pluginId} activation timed out after ${ACTIVATION_TIMEOUT_MS}ms`));
      }, ACTIVATION_TIMEOUT_MS);

      const onMessage = (msg: any) => {
        if (msg.type === 'activated') {
          clearTimeout(timeout);
          worker.off('message', onMessage);
          resolve();
        } else if (msg.type === 'activation_error') {
          clearTimeout(timeout);
          worker.off('message', onMessage);
          // Clean up on activation error
          worker.terminate().catch(() => {});
          this.workers.delete(pluginId);
          reject(new Error(msg.error));
        }
      };

      worker.on('message', onMessage);
    });

    // Set up RPC handler for API proxy
    this.setupRPCHandler(entry);

    // Handle worker errors and exit
    worker.on('error', (error) => {
      console.error(`[WorkerHost] Worker error for ${pluginId}:`, error.message);
      pluginEvents.emit('plugin.error', { pluginId, error: error.message }, pluginId).catch(() => {});
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[WorkerHost] Worker for ${pluginId} exited with code ${code}`);
      }
      this.workers.delete(pluginId);
    });

    this.workers.set(pluginId, entry);

    // Wait for activation
    await entry.activatedPromise;
    console.log(`[WorkerHost] Plugin ${pluginId} activated in worker`);
  }

  /**
   * Stop a plugin's Worker thread.
   */
  async stopPlugin(pluginId: string): Promise<void> {
    const entry = this.workers.get(pluginId);
    if (!entry) return;

    try {
      // Send deactivate message and wait
      const deactivatePromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Deactivation timed out'));
        }, 10_000);

        const onMessage = (msg: any) => {
          if (msg.type === 'deactivated' || msg.type === 'deactivate_error') {
            clearTimeout(timeout);
            entry.worker.off('message', onMessage);
            if (msg.type === 'deactivate_error') {
              console.warn(`[WorkerHost] Deactivation error for ${pluginId}:`, msg.error);
            }
            resolve();
          }
        };

        entry.worker.on('message', onMessage);
        entry.worker.postMessage({ type: 'deactivate' });
      });

      await deactivatePromise;
    } catch (error) {
      console.warn(`[WorkerHost] Error during deactivation of ${pluginId}:`,
        error instanceof Error ? error.message : String(error));
    }

    // Terminate worker
    await entry.worker.terminate();
    this.workers.delete(pluginId);

    // Clean up host-side registrations
    commandRegistry.clearByPlugin(pluginId);
    toolRegistry.clearByPlugin(pluginId);
    pluginEvents.clearByPlugin(pluginId);

    console.log(`[WorkerHost] Plugin ${pluginId} worker stopped`);
  }

  /**
   * Check if a plugin has an active worker.
   */
  hasWorker(pluginId: string): boolean {
    return this.workers.has(pluginId);
  }

  /**
   * Stop all workers.
   */
  async stopAll(): Promise<void> {
    const pluginIds = Array.from(this.workers.keys());
    for (const pluginId of pluginIds) {
      await this.stopPlugin(pluginId);
    }
  }

  /**
   * Set up the RPC message handler for a worker.
   * Proxies API calls from the worker back to main-thread services.
   */
  private setupRPCHandler(entry: WorkerEntry): void {
    const { worker, pluginId } = entry;

    worker.on('message', async (msg: any) => {
      if (msg.type !== 'rpc_request') return;

      const req = msg as RPCRequest;
      try {
        const result = await this.handleRPC(pluginId, entry, req.method, req.args);
        worker.postMessage({
          type: 'rpc_response',
          id: req.id,
          result,
        });
      } catch (error) {
        worker.postMessage({
          type: 'rpc_response',
          id: req.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Handle an RPC call from a worker.
   */
  private async handleRPC(
    pluginId: string,
    entry: WorkerEntry,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    switch (method) {
      // Storage
      case 'storage.get': {
        const storage = pluginStorageManager.getStorage(pluginId);
        return storage.get(args[0] as string);
      }
      case 'storage.set': {
        const storage = pluginStorageManager.getStorage(pluginId);
        return storage.set(args[0] as string, args[1]);
      }
      case 'storage.delete': {
        const storage = pluginStorageManager.getStorage(pluginId);
        return storage.delete(args[0] as string);
      }
      case 'storage.keys': {
        const storage = pluginStorageManager.getStorage(pluginId);
        return storage.keys();
      }
      case 'storage.clear': {
        const storage = pluginStorageManager.getStorage(pluginId);
        return storage.clear();
      }

      // Events — forward from main thread to worker thread
      case 'events.on': {
        const eventName = args[0] as string;
        const listener = (data: any) => {
          try {
            entry.worker.postMessage({ type: 'event_forward', event: eventName, data });
          } catch {
            // Worker may have been terminated
          }
        };
        entry.eventListeners.set(eventName, listener);
        pluginEvents.on(eventName, listener, pluginId);
        return undefined;
      }
      case 'events.off': {
        const eventName = args[0] as string;
        const listener = entry.eventListeners.get(eventName);
        if (listener) {
          pluginEvents.off(eventName, listener);
          entry.eventListeners.delete(eventName);
        }
        return undefined;
      }
      case 'events.once': {
        const eventName = args[0] as string;
        const listener = (data: any) => {
          try {
            entry.worker.postMessage({ type: 'event_forward', event: eventName, data });
          } catch {
            // Worker may have been terminated
          }
          entry.eventListeners.delete(eventName);
        };
        entry.eventListeners.set(eventName, listener);
        pluginEvents.once(eventName, listener, pluginId);
        return undefined;
      }
      case 'events.emit': {
        await pluginEvents.emit(args[0] as string, args[1] as Record<string, unknown> | undefined, pluginId);
        return undefined;
      }

      // Commands — forward execution to worker thread
      case 'commands.register': {
        const command = args[0] as string;
        entry.commandHandlers.set(command, command);
        commandRegistry.register({
          command,
          description: `Worker command from ${pluginId}`,
          handler: async (cmdArgs, context) => {
            return this.forwardCommandCall(entry, command, cmdArgs);
          },
          source: 'plugin',
          pluginId,
        });
        return undefined;
      }
      case 'commands.unregister': {
        const command = args[0] as string;
        entry.commandHandlers.delete(command);
        commandRegistry.unregister(command);
        return undefined;
      }

      // Tools
      case 'tools.register': {
        const [toolId, name, description, parameters] = args as [string, string, string, unknown];
        entry.toolHandlers.set(toolId, toolId);
        toolRegistry.register({
          id: toolId,
          definition: {
            type: 'function',
            function: { name, description, parameters: parameters as Record<string, unknown> },
          },
          handler: async (toolArgs) => {
            // Forward tool call to worker and wait for response
            return this.forwardToolCall(entry, toolId, toolArgs);
          },
          source: 'plugin',
          pluginId,
        });
        return undefined;
      }
      case 'tools.unregister': {
        const toolId = args[0] as string;
        entry.toolHandlers.delete(toolId);
        toolRegistry.unregister(toolId);
        return undefined;
      }

      // Permissions
      case 'permissions.has':
        return permissionManager.hasPermission(pluginId, args[0] as Permission);
      case 'permissions.hasAll':
        return permissionManager.hasAllPermissions(pluginId, args[0] as Permission[]);
      case 'permissions.request': {
        // Note: simplified — full implementation would need the manifest
        return false;
      }
      case 'permissions.requestAll': {
        return false;
      }
      case 'permissions.getGranted':
        return permissionManager.getGrantedPermissions(pluginId);

      // File System
      case 'fs.readFile': {
        if (!permissionManager.hasPermission(pluginId, 'fs.read' as Permission))
          throw new Error('Permission denied: fs.read');
        const fsModule = await import('fs');
        return fsModule.promises.readFile(args[0] as string, 'utf-8');
      }
      case 'fs.writeFile': {
        if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
          throw new Error('Permission denied: fs.write');
        const fsModule = await import('fs');
        await fsModule.promises.writeFile(args[0] as string, args[1] as string, 'utf-8');
        return undefined;
      }
      case 'fs.exists': {
        const fsModule = await import('fs');
        return fsModule.existsSync(args[0] as string);
      }
      case 'fs.readdir': {
        if (!permissionManager.hasPermission(pluginId, 'fs.read' as Permission))
          throw new Error('Permission denied: fs.read');
        const fsModule = await import('fs');
        return fsModule.promises.readdir(args[0] as string);
      }
      case 'fs.mkdir': {
        if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
          throw new Error('Permission denied: fs.write');
        const fsModule = await import('fs');
        await fsModule.promises.mkdir(args[0] as string, { recursive: true });
        return undefined;
      }
      case 'fs.unlink': {
        if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
          throw new Error('Permission denied: fs.write');
        const fsModule = await import('fs');
        await fsModule.promises.unlink(args[0] as string);
        return undefined;
      }

      // Network
      case 'network.fetch': {
        if (!permissionManager.hasPermission(pluginId, 'network.fetch' as Permission))
          throw new Error('Permission denied: network.fetch');
        const response = await globalThis.fetch(args[0] as string, args[1] as RequestInit | undefined);
        const body = await response.text();
        return { ok: response.ok, status: response.status, body };
      }

      // Shell
      case 'shell.execute': {
        if (!permissionManager.hasPermission(pluginId, 'shell.execute' as Permission))
          throw new Error('Permission denied: shell.execute');
        const { execFile } = await import('child_process');
        const command = args[0] as string;
        const cmdArgs = (args[1] as string[]) || [];
        const options = (args[2] as { cwd?: string }) || {};
        return new Promise((resolve) => {
          execFile(command, cmdArgs, { cwd: options.cwd }, (error, stdout, stderr) => {
            resolve({
              stdout: stdout || '',
              stderr: stderr || '',
              code: error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0,
            });
          });
        });
      }

      // Notification
      case 'notification.show': {
        if (!permissionManager.hasPermission(pluginId, 'notification' as Permission))
          throw new Error('Permission denied: notification');
        pluginEvents.emit('plugin.notification', {
          pluginId, title: args[0] as string, body: args[1] as string,
        }).catch(() => {});
        this.broadcastFn?.({
          type: 'plugin_notification',
          pluginId,
          title: args[0] as string,
          body: args[1] as string,
        });
        return undefined;
      }

      // Plugin inter-communication
      case 'exports':
        // Workers can't meaningfully export APIs (serialization boundary)
        return undefined;
      case 'getPluginAPI':
        return undefined;

      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  /**
   * Forward a tool call to the worker and wait for the response.
   */
  private forwardToolCall(entry: WorkerEntry, toolId: string, args: Record<string, unknown>): Promise<string> {
    return new Promise((resolve) => {
      const callId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const onMessage = (msg: any) => {
        if (msg.type === 'tool_result' && msg.id === callId) {
          clearTimeout(timeout);
          entry.worker.off('message', onMessage);
          resolve(msg.error ? JSON.stringify({ error: msg.error }) : msg.result);
        }
      };

      // Attach listener BEFORE sending message to avoid race condition
      entry.worker.on('message', onMessage);

      const timeout = setTimeout(() => {
        entry.worker.off('message', onMessage);
        resolve(JSON.stringify({ error: `Tool call ${toolId} timed out` }));
      }, 30_000);

      entry.worker.postMessage({
        type: 'tool_call',
        id: callId,
        toolId,
        args,
      });
    });
  }

  /**
   * Forward a command call to the worker and wait for the response.
   */
  private forwardCommandCall(entry: WorkerEntry, command: string, args: string[]): Promise<any> {
    return new Promise((resolve) => {
      const callId = `cc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const onMessage = (msg: any) => {
        if (msg.type === 'command_result' && msg.id === callId) {
          clearTimeout(timeout);
          entry.worker.off('message', onMessage);
          resolve(msg.result);
        }
      };

      entry.worker.on('message', onMessage);

      const timeout = setTimeout(() => {
        entry.worker.off('message', onMessage);
        resolve({ type: 'builtin', command, error: `Command ${command} timed out` });
      }, 30_000);

      entry.worker.postMessage({
        type: 'command_call',
        id: callId,
        command,
        args,
      });
    });
  }
}

// ============================================
// Singleton Export
// ============================================

export const workerHost = new WorkerHost();
