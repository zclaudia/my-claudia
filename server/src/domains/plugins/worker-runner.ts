/**
 * Worker Runner - Entry point for plugin Worker threads.
 */

import type { MessagePort } from 'worker_threads';
import { parentPort, workerData } from 'worker_threads';

interface WorkerData {
  pluginId: string;
  modulePath: string;
}

interface RPCRequest {
  type: 'rpc_request';
  id: string;
  method: string;
  args: unknown[];
}

interface RPCResponse {
  type: 'rpc_response';
  id: string;
  result?: unknown;
  error?: string;
}

interface HostMessage {
  type: 'deactivate' | 'tool_call' | 'command_call' | 'event_forward' | 'scheduler_tick';
  id?: string;
  toolId?: string;
  command?: string;
  taskId?: string;
  args?: unknown;
  event?: string;
  data?: unknown;
}

class RPCClient {
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private counter = 0;

  constructor(private port: MessagePort) {
    this.port.on('message', (msg: RPCResponse | HostMessage) => {
      if (msg.type === 'rpc_response') {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    });
  }

  async call(method: string, ...args: unknown[]): Promise<unknown> {
    const id = `rpc_${++this.counter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: RPCRequest = { type: 'rpc_request', id, method, args };
      this.port.postMessage(request);
    });
  }
}

const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string> | string>();
const commandHandlers = new Map<string, (args: string[], ctx?: any) => any>();
const eventHandlers = new Map<string, Set<(data: unknown) => void | Promise<void>>>();
const schedulerHandlers = new Map<string, () => Promise<void> | void>();

function createProxyContext(pluginId: string, rpc: RPCClient): any {
  return {
    pluginId,
    storage: {
      get: (key: string) => rpc.call('storage.get', key),
      set: (key: string, value: unknown) => rpc.call('storage.set', key, value),
      delete: (key: string) => rpc.call('storage.delete', key),
      keys: () => rpc.call('storage.keys'),
      clear: () => rpc.call('storage.clear'),
    },
    events: {
      on: (event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, new Set());
        }
        eventHandlers.get(event)!.add(handler);
        void rpc.call('events.on', event).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
        return () => {
          const handlers = eventHandlers.get(event);
          if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
              eventHandlers.delete(event);
              void rpc.call('events.off', event).catch((err: unknown) => {
                console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
              });
            }
          }
        };
      },
      once: (event: string, handler: (data: unknown) => void) => {
        const wrappedHandler = (data: unknown) => {
          handler(data);
          const handlers = eventHandlers.get(event);
          if (handlers) {
            handlers.delete(wrappedHandler);
            if (handlers.size === 0) {
              eventHandlers.delete(event);
            }
          }
        };
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, new Set());
        }
        eventHandlers.get(event)!.add(wrappedHandler);
        void rpc.call('events.once', event).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
      },
      emit: (event: string, data: unknown) => rpc.call('events.emit', event, data),
    },
    log: {
      info: (...args: unknown[]) => console.log(`[Worker:${pluginId}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Worker:${pluginId}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Worker:${pluginId}]`, ...args),
      debug: (...args: unknown[]) => console.debug(`[Worker:${pluginId}]`, ...args),
    },
    commands: {
      registerCommand: (command: string, handler: (args: string[], ctx?: any) => any) => {
        commandHandlers.set(command, handler);
        void rpc.call('commands.register', command).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
      },
      unregisterCommand: (command: string) => {
        commandHandlers.delete(command);
        void rpc.call('commands.unregister', command).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
      },
    },
    registerCommand: (command: string, handler: (args: string[], ctx?: any) => any) => {
      commandHandlers.set(command, handler);
      void rpc.call('commands.register', command).catch((err: unknown) => {
        console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
      });
    },
    tools: {
      registerTool: (tool: { id: string; name: string; description: string; parameters: unknown; handler: (args: Record<string, unknown>) => Promise<string> | string }) => {
        toolHandlers.set(tool.id, tool.handler);
        void rpc.call('tools.register', tool.id, tool.name, tool.description, tool.parameters).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
      },
      unregisterTool: (toolId: string) => {
        toolHandlers.delete(toolId);
        void rpc.call('tools.unregister', toolId).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
      },
    },
    registerTool: (tool: { id: string; name: string; description: string; parameters: unknown; handler: (args: Record<string, unknown>) => Promise<string> | string }) => {
      toolHandlers.set(tool.id, tool.handler);
      void rpc.call('tools.register', tool.id, tool.name, tool.description, tool.parameters).catch((err: unknown) => {
        console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
      });
    },
    permissions: {
      hasPermission: (permission: string) => rpc.call('permissions.has', permission),
      hasAllPermissions: (permissions: string[]) => rpc.call('permissions.hasAll', permissions),
      requestPermission: (permission: string) => rpc.call('permissions.request', permission),
      requestPermissions: (permissions: string[]) => rpc.call('permissions.requestAll', permissions),
      getGrantedPermissions: () => rpc.call('permissions.getGranted'),
    },
    fs: {
      readFile: (p: string) => rpc.call('fs.readFile', p),
      writeFile: (p: string, content: string) => rpc.call('fs.writeFile', p, content),
      exists: (p: string) => rpc.call('fs.exists', p),
      readdir: (p: string) => rpc.call('fs.readdir', p),
      mkdir: (p: string) => rpc.call('fs.mkdir', p),
      unlink: (p: string) => rpc.call('fs.unlink', p),
    },
    network: {
      fetch: (url: string, options?: unknown) => rpc.call('network.fetch', url, options),
    },
    shell: {
      execute: (command: string, args?: string[], options?: unknown) =>
        rpc.call('shell.execute', command, args, options),
    },
    notification: {
      show: (title: string, body: string) => rpc.call('notification.show', title, body),
    },
    scheduler: {
      register: (
        task: { id: string; name: string; intervalMs: number; immediate?: boolean },
        handler: () => Promise<void> | void,
      ) => {
        schedulerHandlers.set(task.id, handler);
        void rpc.call('scheduler.register', task.id, task.name, task.intervalMs, task.immediate).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
        return () => {
          schedulerHandlers.delete(task.id);
          void rpc.call('scheduler.unregister', task.id).catch((err: unknown) => {
            console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
          });
        };
      },
      unregister: (taskId: string) => {
        schedulerHandlers.delete(taskId);
        void rpc.call('scheduler.unregister', taskId).catch((err: unknown) => {
          console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
        });
      },
      trigger: (taskId: string) => rpc.call('scheduler.trigger', taskId),
    },
    exports: (api: unknown) => {
      void rpc.call('exports', api).catch((err: unknown) => {
        console.warn('[WorkerRunner] RPC failed:', err instanceof Error ? err.message : err);
      });
    },
    getPluginAPI: (targetPluginId: string) => rpc.call('getPluginAPI', targetPluginId),
    env: {
      isDesktop: true,
      isServer: true,
      appVersion: '0.1.0',
      platform: process.platform as 'darwin' | 'win32' | 'linux',
    },
  };
}

async function main() {
  if (!parentPort) {
    throw new Error('worker-runner must be run inside a Worker thread');
  }

  const { pluginId, modulePath } = workerData as WorkerData;
  const rpc = new RPCClient(parentPort);
  const context = createProxyContext(pluginId, rpc);

  try {
    const module = await import(modulePath);

    if (typeof module.activate === 'function') {
      await module.activate(context);
    }

    parentPort.postMessage({ type: 'activated' });

    parentPort.on('message', async (msg: HostMessage) => {
      if ((msg as any).type === 'rpc_response') {
        return;
      }

      switch (msg.type) {
        case 'deactivate':
          try {
            if (typeof module.deactivate === 'function') {
              await module.deactivate();
            }
            parentPort!.postMessage({ type: 'deactivated' });
          } catch (error) {
            parentPort!.postMessage({
              type: 'deactivate_error',
              error: error instanceof Error ? error.message : String(error),
            });
          }
          break;
        case 'tool_call':
          if (msg.id && msg.toolId) {
            try {
              const handler = toolHandlers.get(msg.toolId);
              if (handler) {
                const result = await handler((msg.args as Record<string, unknown>) || {});
                parentPort!.postMessage({
                  type: 'tool_result',
                  id: msg.id,
                  result,
                });
              } else {
                parentPort!.postMessage({
                  type: 'tool_result',
                  id: msg.id,
                  result: JSON.stringify({ error: `Tool handler "${msg.toolId}" not found in worker` }),
                });
              }
            } catch (error) {
              parentPort!.postMessage({
                type: 'tool_result',
                id: msg.id,
                result: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
              });
            }
          }
          break;
        case 'command_call':
          if (msg.id && msg.command) {
            try {
              const handler = commandHandlers.get(msg.command);
              if (handler) {
                const result = await handler((msg.args as string[]) || []);
                parentPort!.postMessage({
                  type: 'command_result',
                  id: msg.id,
                  result,
                });
              } else {
                parentPort!.postMessage({
                  type: 'command_result',
                  id: msg.id,
                  result: { type: 'builtin', command: msg.command, error: 'Command handler not found in worker' },
                });
              }
            } catch (error) {
              parentPort!.postMessage({
                type: 'command_result',
                id: msg.id,
                result: { type: 'builtin', command: msg.command, error: error instanceof Error ? error.message : String(error) },
              });
            }
          }
          break;
        case 'event_forward':
          if (msg.event) {
            const handlers = eventHandlers.get(msg.event);
            if (handlers) {
              for (const handler of handlers) {
                try {
                  await handler(msg.data);
                } catch (error) {
                  console.error(`[Worker:${pluginId}] Event handler error for ${msg.event}:`, error);
                }
              }
            }
          }
          break;
        case 'scheduler_tick':
          if (msg.id && msg.taskId) {
            try {
              const handler = schedulerHandlers.get(msg.taskId);
              if (handler) {
                await handler();
              }
              parentPort!.postMessage({
                type: 'scheduler_tick_result',
                id: msg.id,
              });
            } catch (error) {
              parentPort!.postMessage({
                type: 'scheduler_tick_result',
                id: msg.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          break;
      }
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'activation_error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

main().catch((error) => {
  console.error('[WorkerRunner] Fatal error:', error);
  process.exit(1);
});
