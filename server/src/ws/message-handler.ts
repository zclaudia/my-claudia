import type {
  ClientMessage,
  ServerMessage,
  PongMessage,
  ErrorMessage,
} from '@my-claudia/shared';
import type { TerminalManager } from '../terminal-manager.js';
import type { ProcessMonitor } from '../utils/process-monitor.js';
import type { initDatabase } from '../storage/db.js';
import { isProcessAlive, killProcessTree } from '../utils/process-tree.js';
import { providerRegistry } from '../providers/registry.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import { permissionManager as pluginPermissionManager } from '../plugins/permissions.js';
import { sendMessage, broadcastToOtherAuthenticatedClients } from './broadcast.js';
import { handlePermissionDecision, handleAskUserAnswer } from './permission-handler.js';
import type { ConnectedClient, ActiveRun } from './types.js';
import type { AgentFeedService } from '../domains/agent-feed/service.js';
import type { TaskOrchestrator } from '../orchestration/types.js';

/** Context object bundling module-level dependencies for handleClientMessage. */
export interface MessageHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  connectedClients: Map<string, ConnectedClient>;
  processMonitor: ProcessMonitor | null;
  handleRunStart: (client: ConnectedClient, message: any, db: any, options: any, clients: Map<string, ConnectedClient>) => Promise<void>;
  cancelRun: (runId: string) => void;
  broadcastPluginState: () => void;
  findProcessPidsByTaskCommand: (taskCommand?: string, excludedPids?: number[]) => Promise<number[]>;
  agentFeedService?: AgentFeedService;
  orchestrator?: TaskOrchestrator;
}

export async function handleClientMessage(
  client: ConnectedClient,
  message: ClientMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  ctx: MessageHandlerContext,
  termMgr?: TerminalManager,
): Promise<void> {
  const collectOrchestratorTasks = (): import('../orchestration/types.js').OrchestratorTask[] => {
    if (!ctx.orchestrator) return [];
    const collect = (parentId?: string): import('../orchestration/types.js').OrchestratorTask[] => {
      const direct = ctx.orchestrator!.listTasks(parentId);
      return direct.flatMap((task) => [task, ...collect(task.id)]);
    };
    return collect();
  };

  switch (message.type) {
    case 'auth':
      // Auth is handled in the ws.on('message') handler before this function
      // If we reach here, the client is already authenticated (ignore duplicate auth)
      break;

    case 'ping':
      sendMessage(client.ws, { type: 'pong' } as PongMessage);
      break;

    case 'run_start':
      await ctx.handleRunStart(client, message, db, {}, clients);
      break;

    case 'agent_start':
      // Legacy alias — kept for backward compatibility with older clients.
      // New clients should use claudia_task_submit instead.
      await ctx.handleRunStart(client, {
        type: 'run_start',
        clientRequestId: message.clientRequestId,
        sessionId: message.sessionId,
        input: message.input,
        providerId: message.providerId,
        model: message.model,
      }, db, {}, clients);
      break;

    case 'agent_cancel': {
      // Find and cancel the active run for this agent session
      for (const [runId, run] of ctx.activeRuns.entries()) {
        if (run.sessionId === message.sessionId && !run.completed) {
          ctx.cancelRun(runId);
          break;
        }
      }
      break;
    }

    case 'get_agent_feed':
      if (ctx.agentFeedService) {
        const result = ctx.agentFeedService.listItems({
          limit: message.limit,
          before: message.before,
          unreadOnly: message.unreadOnly,
        });
        sendMessage(client.ws, {
          type: 'agent_feed_list',
          items: result.items,
          hasMore: result.hasMore,
          unreadCount: result.unreadCount,
          append: typeof message.before === 'number',
        } as import('@my-claudia/shared').AgentFeedListMessage);
      }
      break;

    case 'mark_feed_read':
      if (ctx.agentFeedService && Array.isArray(message.itemIds)) {
        ctx.agentFeedService.markRead(message.itemIds);
      }
      break;

    case 'claudia_task_submit': {
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }
      const taskInput = message.input?.trim();
      if (!taskInput) break;
      const title = taskInput.replace(/\s+/g, ' ').slice(0, 80);
      try {
        const taskId = await ctx.orchestrator.spawnTask(null, {
          task: taskInput,
          projectId: message.projectId,
          providerId: message.providerId,
          initiator: 'claudia',
          feed: { source: 'manual', title },
        });
        // Look up the spawned task to get its sessionId
        const tasks = collectOrchestratorTasks();
        const spawnedTask = tasks.find(t => t.id === taskId);
        sendMessage(client.ws, {
          type: 'claudia_task_created',
          clientRequestId: message.clientRequestId,
          taskId,
          sessionId: spawnedTask?.sessionId ?? '',
          title,
          status: 'queued',
        } as import('@my-claudia/shared').ClaudiaTaskCreatedMessage);
      } catch (err) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_SPAWN_FAILED',
          message: err instanceof Error ? err.message : 'Failed to spawn task',
        } as ErrorMessage);
      }
      break;
    }

    case 'claudia_task_continue': {
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }

      const continueInput = message.input?.trim();
      if (!continueInput) break;

      const parentTask = collectOrchestratorTasks().find((task) => task.id === message.taskId);
      if (!parentTask) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_NOT_FOUND',
          message: `Task not found: ${message.taskId}`,
        } as ErrorMessage);
        break;
      }

      const title = continueInput.replace(/\s+/g, ' ').slice(0, 80);
      try {
        const taskId = await ctx.orchestrator.spawnTask(message.taskId, {
          task: continueInput,
          projectId: parentTask.projectId ?? undefined,
          providerId: parentTask.providerId,
          initiator: 'claudia',
          feed: { source: 'manual', title },
        });
        const spawnedTask = collectOrchestratorTasks().find((task) => task.id === taskId);
        sendMessage(client.ws, {
          type: 'claudia_task_created',
          clientRequestId: message.clientRequestId,
          taskId,
          sessionId: spawnedTask?.sessionId ?? '',
          title,
          status: 'queued',
        } as import('@my-claudia/shared').ClaudiaTaskCreatedMessage);
      } catch (err) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_CONTINUE_FAILED',
          message: err instanceof Error ? err.message : 'Failed to continue task',
        } as ErrorMessage);
      }
      break;
    }

    case 'run_cancel':
      ctx.cancelRun(message.runId);
      break;

    case 'kill_leaked_processes':
      if (ctx.processMonitor) {
        console.log('[ProcessMonitor] Manual kill triggered by client');
        const result = await ctx.processMonitor.cleanupNow();
        sendMessage(client.ws, {
          type: 'process_cleanup_result',
          status: result.status,
          leakedCount: result.leakedCount,
          killedCount: result.killedCount,
          activeRunCount: result.activeRunCount,
        });
      }
      break;

    case 'stop_background_task': {
      const { sessionId: targetSessionId, taskId, taskRootPid, cliPid, taskCommand } = message;

      const directPid = taskRootPid;
      if (directPid && isProcessAlive(directPid)) {
        console.log(`[StopTask] Direct PID stop for task ${taskId}: pid=${directPid}`);
        killProcessTree(directPid)
          .then(({ killed, failed }) => {
            const stopped = killed.length > 0 && failed.length === 0 && !isProcessAlive(directPid);
            sendMessage(client.ws, {
              type: 'task_notification',
              runId: '',
              sessionId: targetSessionId,
              taskId,
              status: stopped ? 'stopped' : 'failed',
              message: stopped
                ? `Task stopped by PID ${directPid}`
                : `Failed to stop PID ${directPid}`,
              cliPid,
              taskRootPid,
            } as import('@my-claudia/shared').TaskNotificationMessage);
          })
          .catch(err => {
            console.error(`[StopTask] Direct PID stop failed for task ${taskId}:`, err);
            sendMessage(client.ws, {
              type: 'task_notification',
              runId: '',
              sessionId: targetSessionId,
              taskId,
              status: 'failed',
              message: `PID stop failed: ${err instanceof Error ? err.message : String(err)}`,
              cliPid,
              taskRootPid,
            } as import('@my-claudia/shared').TaskNotificationMessage);
          });
        break;
      }

      const matchedPids = await ctx.findProcessPidsByTaskCommand(taskCommand, [cliPid, taskRootPid].filter((pid): pid is number => typeof pid === 'number'));
      if (matchedPids.length > 0) {
        console.log(`[StopTask] Command-matched stop for task ${taskId}: pids=[${matchedPids.join(',')}]`);
        const killResults = await Promise.all(matchedPids.map(pid => killProcessTree(pid)));
        const failed = killResults.flatMap(result => result.failed);
        const killed = killResults.flatMap(result => result.killed);
        sendMessage(client.ws, {
          type: 'task_notification',
          runId: '',
          sessionId: targetSessionId,
          taskId,
          status: killed.length > 0 && failed.length === 0 ? 'stopped' : 'failed',
          message: killed.length > 0 && failed.length === 0
            ? `Task stopped by command match (${matchedPids.join(', ')})`
            : `Failed to stop command-matched PID(s): ${matchedPids.join(', ')}`,
          cliPid,
          taskRootPid,
        } as import('@my-claudia/shared').TaskNotificationMessage);
        break;
      }

      // Gather provider type and SDK session ID from multiple sources
      const targetRun = [...ctx.activeRuns.values()].find(r => r.sessionId === targetSessionId);
      let resolvedProviderType = targetRun?.providerType;
      let resolvedSdkSessionId = targetRun?.providerSessionId;

      // If active run doesn't have SDK session ID (not yet attached), look up from DB
      if (!resolvedSdkSessionId) {
        const sessionRow = db.prepare('SELECT sdk_session_id FROM sessions WHERE id = ?')
          .get(targetSessionId) as { sdk_session_id: string | null } | undefined;
        resolvedSdkSessionId = sessionRow?.sdk_session_id || undefined;
      }

      // If no provider type from active run, look up from DB
      if (!resolvedProviderType) {
        const providerRow = db.prepare(`
          SELECT pr.type FROM sessions s
          LEFT JOIN projects p ON s.project_id = p.id
          LEFT JOIN providers pr ON pr.id = COALESCE(s.provider_id, p.provider_id)
          WHERE s.id = ? AND pr.type IS NOT NULL
        `).get(targetSessionId) as { type: string } | undefined;
        resolvedProviderType = providerRow?.type;
      }

      if (resolvedProviderType && resolvedSdkSessionId) {
        const adapter = providerRegistry.get(resolvedProviderType);
        if (adapter?.stopTask) {
          console.log(`[StopTask] Stopping task ${taskId}: adapter=${resolvedProviderType} sdkSession=${resolvedSdkSessionId}`);
          adapter.stopTask(resolvedSdkSessionId, taskId)
            .then((killed) => {
              // Notify frontend — include whether processes were actually killed
              sendMessage(client.ws, {
                type: 'task_notification',
                runId: targetRun?.runId || '',
                sessionId: targetSessionId,
                taskId,
                status: killed !== false ? 'stopped' : 'failed',
                message: killed !== false ? 'Task stopped by user' : 'No processes found to kill',
              } as import('@my-claudia/shared').TaskNotificationMessage);
            })
            .catch(err => {
              console.error(`[StopTask] Failed to stop task ${taskId}:`, err);
              sendMessage(client.ws, {
                type: 'task_notification',
                runId: targetRun?.runId || '',
                sessionId: targetSessionId,
                taskId,
                status: 'failed',
                message: `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
              } as import('@my-claudia/shared').TaskNotificationMessage);
            });
          break;
        }
      }

      console.warn(`[StopTask] Cannot stop task ${taskId} in session ${targetSessionId} — providerType=${resolvedProviderType} sdkSessionId=${resolvedSdkSessionId}`);
      break;
    }

    case 'permission_decision':
      handlePermissionDecision(message, ctx.activeRuns);
      break;

    case 'ask_user_answer':
      handleAskUserAnswer(message, ctx.activeRuns, ctx.connectedClients);
      break;

    case 'interaction_response': {
      const resolved = interactionDispatcher.resolve(message.interactionId, message.response);
      if (resolved) {
        // Broadcast interaction_resolved to all clients
        for (const [, run] of ctx.activeRuns) {
          if (run.sessionId === message.sessionId) {
            const resolvedEvent = {
              type: 'interaction_resolved' as const,
              interactionId: message.interactionId,
              sessionId: message.sessionId,
            };
            sendMessage(run.client.ws, resolvedEvent as import('@my-claudia/shared').InteractionResolvedMessage);
            if (clients) broadcastToOtherAuthenticatedClients(clients, run.clientId, resolvedEvent as ServerMessage);
            break;
          }
        }
      } else {
        console.warn(`[InteractionResponse] No pending interaction for ${message.interactionId}`);
      }
      break;
    }

    case 'terminal_open': {
      if (!termMgr) break;
      const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(message.projectId) as { root_path: string } | undefined;
      // Pass the target cwd to TerminalManager — it spawns at $HOME then cd's to this path
      // (avoids macOS TCC permission dialogs that block pty.spawn)
      const cwd = message.workingDirectory || project?.root_path || process.env.HOME || '/';
      try {
        termMgr.create(message.terminalId, client.id, cwd, message.cols, message.rows);
        sendMessage(client.ws, { type: 'terminal_opened', terminalId: message.terminalId, success: true });
      } catch (err) {
        sendMessage(client.ws, {
          type: 'terminal_opened',
          terminalId: message.terminalId,
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create terminal',
        });
      }
      break;
    }

    case 'terminal_input':
      termMgr?.write(message.terminalId, message.data);
      break;

    case 'terminal_resize':
      termMgr?.resize(message.terminalId, message.cols, message.rows);
      break;

    case 'terminal_close':
      termMgr?.destroy(message.terminalId);
      break;

    case 'terminal_detach':
      termMgr?.detachTerminal(message.terminalId, client.id);
      break;

    case 'terminal_attach': {
      if (!termMgr) break;
      const result = termMgr.attach(message.terminalId, client.id, message.cols, message.rows);
      sendMessage(client.ws, {
        type: 'terminal_attached',
        terminalId: message.terminalId,
        success: result.success,
        scrollback: result.scrollback,
        error: result.error,
      });
      break;
    }

    case 'plugin_permission_response': {
      const { pluginId, granted, permanently } = message as import('@my-claudia/shared').PluginPermissionResponseMessage;
      pluginPermissionManager.respondToRequest(pluginId, granted, permanently);
      ctx.broadcastPluginState();
      break;
    }

    default:
      sendMessage(client.ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: ${(message as { type: string }).type}`
      } as ErrorMessage);
  }
}
