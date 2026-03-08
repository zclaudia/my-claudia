/**
 * Worker Runner - Entry point for plugin Worker threads.
 *
 * Runs inside a worker_threads Worker. Loads the plugin module and creates
 * a proxy PluginContext that routes all API calls through MessagePort RPC
 * back to the host process.
 */

import { parentPort, workerData } from 'worker_threads';
import type { MessagePort } from 'worker_threads';

// ============================================
// Types
// ============================================

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
  type: 'deactivate' | 'tool_call' | 'command_call' | 'event_forward';
  id?: string;
  toolId?: string;
  command?: string;
  args?: unknown;
  event?: string;
  data?: unknown;
}

// ============================================
// RPC Client (Worker → Host)
// ============================================

class RPCClient {
  private port: MessagePort;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private counter = 0;

  constructor(port: MessagePort) {
    this.port = port;
    this.port.on('message', (msg: RPCResponse | HostMessage) => {
      if (msg.type === 'rpc_response') {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error));
          } else {
            p.resolve(msg.result);
          }
        }
      }
    });
  }

  async call(method: string, ...args: unknown[]): Promise<unknown> {
    const id = `rpc_${++this.counter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req: RPCRequest = { type: 'rpc_request', id, method, args };
      this.port.postMessage(req);
    });
  }
}

// ============================================
// Proxy PluginContext
// ============================================

// Local handler storage — handlers can't cross thread boundaries, so we store them here
const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string> | string>();
const commandHandlers = new Map<string, (args: string[], ctx?: any) => any>();
const eventHandlers = new Map<string, Set<(data: unknown) => void | Promise<void>>>();

function createProxyContext(pluginId: string, rpc: RPCClient): any {
  return {
    pluginId,

    // Storage API
    storage: {
      get: (key: string) => rpc.call('storage.get', key),
      set: (key: string, value: unknown) => rpc.call('storage.set', key, value),
      delete: (key: string) => rpc.call('storage.delete', key),
      keys: () => rpc.call('storage.keys'),
      clear: () => rpc.call('storage.clear'),
    },

    // Events API — store handlers locally, forward registration to host
    events: {
      on: (event: string, handler: (data: unknown) => void) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, new Set());
        }
        eventHandlers.get(event)!.add(handler);
        // Register with host so it forwards events to this worker
        rpc.call('events.on', event).catch(() => {});
        return () => {
          const handlers = eventHandlers.get(event);
          if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
              eventHandlers.delete(event);
              rpc.call('events.off', event).catch(() => {});
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
            if (handlers.size === 0) eventHandlers.delete(event);
          }
        };
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, new Set());
        }
        eventHandlers.get(event)!.add(wrappedHandler);
        rpc.call('events.once', event).catch(() => {});
      },
      emit: (event: string, data: unknown) => rpc.call('events.emit', event, data),
    },

    // Log API (direct to console, prefixed)
    log: {
      info: (...args: unknown[]) => console.log(`[Worker:${pluginId}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Worker:${pluginId}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Worker:${pluginId}]`, ...args),
      debug: (...args: unknown[]) => console.debug(`[Worker:${pluginId}]`, ...args),
    },

    // Commands registration — store handler locally, register metadata on host
    commands: {
      registerCommand: (command: string, handler: (args: string[], ctx?: any) => any) => {
        commandHandlers.set(command, handler);
        rpc.call('commands.register', command).catch(() => {});
      },
      unregisterCommand: (command: string) => {
        commandHandlers.delete(command);
        rpc.call('commands.unregister', command).catch(() => {});
      },
    },

    // Tools registration — store handler locally, register metadata on host
    tools: {
      registerTool: (tool: { id: string; name: string; description: string; parameters: unknown; handler: (args: Record<string, unknown>) => Promise<string> | string }) => {
        toolHandlers.set(tool.id, tool.handler);
        rpc.call('tools.register', tool.id, tool.name, tool.description, tool.parameters).catch(() => {});
      },
      unregisterTool: (toolId: string) => {
        toolHandlers.delete(toolId);
        rpc.call('tools.unregister', toolId).catch(() => {});
      },
    },

    // Permissions (proxied)
    permissions: {
      hasPermission: (permission: string) => rpc.call('permissions.has', permission),
      hasAllPermissions: (permissions: string[]) => rpc.call('permissions.hasAll', permissions),
      requestPermission: (permission: string) => rpc.call('permissions.request', permission),
      requestPermissions: (permissions: string[]) => rpc.call('permissions.requestAll', permissions),
      getGrantedPermissions: () => rpc.call('permissions.getGranted'),
    },

    // FS API (proxied with permission checks on host)
    fs: {
      readFile: (p: string) => rpc.call('fs.readFile', p),
      writeFile: (p: string, content: string) => rpc.call('fs.writeFile', p, content),
      exists: (p: string) => rpc.call('fs.exists', p),
      readdir: (p: string) => rpc.call('fs.readdir', p),
      mkdir: (p: string) => rpc.call('fs.mkdir', p),
      unlink: (p: string) => rpc.call('fs.unlink', p),
    },

    // Network API (proxied)
    network: {
      fetch: (url: string, options?: unknown) => rpc.call('network.fetch', url, options),
    },

    // Shell API (proxied)
    shell: {
      execute: (command: string, args?: string[], options?: unknown) =>
        rpc.call('shell.execute', command, args, options),
    },

    // Notification API (proxied)
    notification: {
      show: (title: string, body: string) => rpc.call('notification.show', title, body),
    },

    // Plugin inter-communication (proxied)
    exports: (api: unknown) => { rpc.call('exports', api).catch(() => {}); },
    getPluginAPI: (targetPluginId: string) => rpc.call('getPluginAPI', targetPluginId),

    env: {
      isDesktop: true,
      isServer: true,
      appVersion: '0.1.0',
      platform: process.platform as 'darwin' | 'win32' | 'linux',
    },
  };
}

// ============================================
// Worker Main
// ============================================

async function main() {
  if (!parentPort) {
    throw new Error('worker-runner must be run inside a Worker thread');
  }

  const { pluginId, modulePath } = workerData as WorkerData;

  // Use parentPort as the RPC channel
  const rpc = new RPCClient(parentPort);
  const context = createProxyContext(pluginId, rpc);

  try {
    // Import the plugin module
    const module = await import(modulePath);

    // Call activate
    if (typeof module.activate === 'function') {
      await module.activate(context);
    }

    // Signal successful activation
    parentPort.postMessage({ type: 'activated' });

    // Listen for host messages
    parentPort.on('message', async (msg: HostMessage) => {
      // Skip RPC responses — handled by RPCClient
      if ((msg as any).type === 'rpc_response') return;

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
          // Execute tool handler stored locally in this worker
          if (msg.id && msg.toolId) {
            try {
              const handler = toolHandlers.get(msg.toolId);
              if (handler) {
                const result = await handler(msg.args as Record<string, unknown> || {});
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
          // Execute command handler stored locally in this worker
          if (msg.id && msg.command) {
            try {
              const handler = commandHandlers.get(msg.command);
              if (handler) {
                const result = await handler(msg.args as string[] || []);
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
          // Forward event to locally stored event handlers
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
