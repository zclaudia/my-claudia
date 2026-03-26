/**
 * WebSocket message dispatcher.
 * Routes ClientMessage to domain-specific handlers under ./handlers/.
 */
import type {
  ClientMessage,
  PongMessage,
  ErrorMessage,
} from '@my-claudia/shared';
import type { TerminalManager } from '../terminal-manager.js';
import type { ProcessMonitor } from '../utils/process-monitor.js';
import type { initDatabase } from '../storage/db.js';
import type { ConnectedClient, ActiveRun } from './types.js';
import type { NotificationFeedService } from '../domains/notification-feed/service.js';
import type { TaskOrchestrator } from '../orchestration/types.js';
import { sendMessage } from './broadcast.js';

// Domain handlers
import {
  handleTerminalOpen, handleTerminalInput, handleTerminalResize,
  handleTerminalClose, handleTerminalDetach, handleTerminalAttach,
} from './handlers/terminal.js';
import {
  handleGetNotifications, handleMarkNotificationsRead, handleDismissNotifications, handleClearReadNotifications,
} from './handlers/notification-feed.js';
import {
  handlePermission, handlePromptAnswerMessage, handleInteractionResponse, handlePluginPermissionResponse,
} from './handlers/permissions.js';
import {
  handleKillLeakedProcesses, handleStopBackgroundTask, handleAgentCancel,
} from './handlers/run.js';
import {
  handleClaudiaMessage, handleClaudiaTaskSubmit, handleClaudiaTaskContinue, handleClaudiaTaskCancel,
} from './handlers/claudia.js';

/** Context object bundling module-level dependencies for handleClientMessage. */
export interface MessageHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  connectedClients: Map<string, ConnectedClient>;
  processMonitor: ProcessMonitor | null;
  handleRunStart: (client: ConnectedClient, message: any, db: any, options: any, clients: Map<string, ConnectedClient>) => Promise<void>;
  cancelRun: (runId: string) => void;
  broadcastPluginState: () => void;
  findProcessPidsByTaskCommand: (taskCommand?: string, excludedPids?: number[]) => Promise<number[]>;
  notificationService?: NotificationFeedService;
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
  switch (message.type) {
    // ── Core ──
    case 'auth':
      break; // Already handled before dispatch

    case 'ping':
      sendMessage(client.ws, { type: 'pong' } as PongMessage);
      break;

    // ── Run lifecycle ──
    case 'run_start':
      await ctx.handleRunStart(client, message, db, {}, clients);
      break;

    case 'agent_start':
      await ctx.handleRunStart(client, {
        type: 'run_start',
        clientRequestId: message.clientRequestId,
        sessionId: message.sessionId,
        input: message.input,
        providerId: message.providerId,
        model: message.model,
      }, db, {}, clients);
      break;

    case 'run_cancel':
      ctx.cancelRun(message.runId);
      break;

    case 'agent_cancel':
      await handleAgentCancel(client, message.sessionId, ctx.activeRuns, ctx.cancelRun, db, ctx.orchestrator);
      break;

    case 'kill_leaked_processes':
      if (ctx.processMonitor) await handleKillLeakedProcesses(client, ctx.processMonitor);
      break;

    case 'stop_background_task':
      await handleStopBackgroundTask(client, message, db, ctx.activeRuns, ctx.findProcessPidsByTaskCommand);
      break;

    // ── Notifications ──
    case 'get_notifications':
      if (ctx.notificationService) handleGetNotifications(client, message, ctx.notificationService);
      break;

    case 'mark_notifications_read':
      if (ctx.notificationService) handleMarkNotificationsRead(message, ctx.notificationService);
      break;

    case 'dismiss_notifications':
      if (ctx.notificationService) handleDismissNotifications(message, ctx.notificationService);
      break;

    case 'clear_read_notifications':
      if (ctx.notificationService) handleClearReadNotifications(ctx.notificationService);
      break;

    // ── Claudia (inline + tasks) ──
    case 'claudia_message':
      await handleClaudiaMessage(client, message, db, clients, ctx);
      break;

    case 'claudia_task_submit':
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }
      await handleClaudiaTaskSubmit(client, message, db, ctx.orchestrator);
      break;

    case 'claudia_task_continue':
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }
      await handleClaudiaTaskContinue(client, message, db, ctx.orchestrator);
      break;

    case 'claudia_task_cancel':
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }
      await handleClaudiaTaskCancel(client, message, ctx.orchestrator);
      break;

    // ── Permissions ──
    case 'permission_decision':
      handlePermission(message, ctx.activeRuns, ctx.connectedClients);
      break;

    case 'prompt_answer':
      handlePromptAnswerMessage(message, ctx.activeRuns, ctx.connectedClients);
      break;

    case 'interaction_response':
      handleInteractionResponse(message, ctx.activeRuns, clients);
      break;

    case 'plugin_permission_response':
      handlePluginPermissionResponse(message, ctx.broadcastPluginState);
      break;

    // ── Terminal ──
    case 'terminal_open':
      if (termMgr) handleTerminalOpen(client, message, db, termMgr);
      break;

    case 'terminal_input':
      if (termMgr) handleTerminalInput(message, termMgr);
      break;

    case 'terminal_resize':
      if (termMgr) handleTerminalResize(message, termMgr);
      break;

    case 'terminal_close':
      if (termMgr) handleTerminalClose(message, termMgr);
      break;

    case 'terminal_detach':
      if (termMgr) handleTerminalDetach(message, client.id, termMgr);
      break;

    case 'terminal_attach':
      if (termMgr) handleTerminalAttach(client, message, termMgr);
      break;

    // ── Unknown ──
    default:
      sendMessage(client.ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: ${(message as { type: string }).type}`
      } as ErrorMessage);
  }
}
