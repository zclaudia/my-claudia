/**
 * ServerState — centralized mutable state for the server process.
 *
 * Replaces the module-level `let` variables and context-factory closures
 * previously scattered across server.ts.  All state reads and writes go
 * through the singleton exported below, making dependencies explicit and
 * the code easier to test.
 */

import type { StateHeartbeatMessage } from '@my-claudia/shared/protocol/messages';
import type { GatewayBackendInfo } from '@my-claudia/shared/core/server';
import type { initDatabase } from './infrastructure/storage/db.js';
import type { ProcessMonitor } from './utils/process-monitor.js';
import type { NotificationSender } from './infrastructure/push/notification-sender.js';
import type { PermissionBridge } from './application/conversation/agent/permission-bridge.js';
import type { PermissionWorkflowResolver } from './domains/workflows/index.js';
import type { NotificationService } from './domains/notification-feed/index.js';
import type { TaskOrchestrator } from './application/orchestration/types.js';
import type { FacadeWsHub } from './infrastructure/gateway/ws-hub.js';
import type { TaskCoordinationPort } from './application/conversation/task-coordination-port.js';
import type { SessionSyncPort } from './application/conversation/session-sync-port.js';
import type { MessageHandlerContext } from './application/conversation/transport/message-handler.js';
import type { RunHandlerContext } from './application/conversation/runtime/run-handler.js';
import type { ConnectedClient, ActiveRun } from './application/conversation/transport/types.js';
import { ClaudiaBranchService } from './application/orchestration/claudia-branch-service.js';
import { getGatewayClient } from './infrastructure/gateway/gateway-instance.js';
import { providerRegistry } from './infrastructure/providers/registry.js';
import {
  buildStateHeartbeat as _buildStateHeartbeat,
  broadcastHeartbeat as _broadcastHeartbeat,
  broadcastPluginState as _broadcastPluginState,
} from './application/conversation/transport/broadcast.js';
import { findProcessPidsByTaskCommand } from './application/conversation/runtime/run-lifecycle.js';

export class ServerState {
  // --- Core state ---
  database: ReturnType<typeof initDatabase> | null = null;
  readonly activeRuns = new Map<string, ActiveRun>();
  connectedClients = new Map<string, ConnectedClient>();

  // --- Infrastructure references (set during createServer) ---
  processMonitor: ProcessMonitor | null = null;
  notificationSender: NotificationSender | null = null;
  serverPort: number | null = null;
  facadeHubRef: FacadeWsHub | null = null;

  // --- Service references (set after setupRoutesAndServices) ---
  notificationsService: NotificationService | undefined;
  permissionBridge: PermissionBridge | undefined;
  cancelWorkflowRun: ((runId: string) => void) | undefined;
  permissionWorkflowResolver: PermissionWorkflowResolver | undefined;
  taskOrchestrator: TaskOrchestrator | undefined;
  branchAllocator: ClaudiaBranchService | undefined;

  // --- Broadcast wrappers ---

  broadcastHeartbeat(): void {
    _broadcastHeartbeat(this.connectedClients, this.activeRuns);
  }

  broadcastPluginState(): void {
    _broadcastPluginState(this.connectedClients);
  }

  buildStateHeartbeat(): StateHeartbeatMessage {
    const heartbeat = _buildStateHeartbeat(this.activeRuns);
    heartbeat.unreadFeedCount = this.notificationsService?.getUnreadCount() ?? 0;
    heartbeat.unreadFeedCountsByTab = this.notificationsService?.getUnreadCountsByTab();
    return heartbeat;
  }

  // --- Context factories ---

  getTaskCoordination(): TaskCoordinationPort | undefined {
    const orch = this.taskOrchestrator;
    const alloc = this.branchAllocator;
    if (!orch || !alloc) return undefined;
    return {
      getTask: (taskId) => orch.getTask(taskId),
      spawnTask: (parentId, config) => orch.spawnTask(parentId, config),
      killTask: (taskId) => orch.killTask(taskId),
      allocateBranch: (opts) => alloc.allocateBranch(opts),
      allocateForContinue: (opts) => alloc.allocateForContinue(opts),
      setActiveBranchId: (hostProjectId, branchId) => alloc.setActiveBranchId(hostProjectId, branchId),
      attachSession: (branchId, sessionId) => alloc.attachSession(branchId, sessionId),
      updateBranchTask: (branchId, taskId, sessionId) => alloc.updateBranchTask(branchId, taskId, sessionId),
    };
  }

  getSessionSync(): SessionSyncPort {
    return {
      broadcastSessionUpdated: (sessionId, db) => {
        const gatewayClient = getGatewayClient();
        if (!gatewayClient) return;

        const updatedSession = db.prepare(`
          SELECT s.id, s.name, s.updated_at as updatedAt, s.archived_at as archivedAt
          FROM sessions s
          WHERE s.id = ?
        `).get(sessionId);

        if (updatedSession) {
          gatewayClient.commands.backendData.broadcastSessionEvent('updated', updatedSession);
        }
      },
    };
  }

  getMessageHandlerContext(
    handleRunStart: (...args: any[]) => Promise<void>,
    cancelRun: (...args: any[]) => void,
  ): MessageHandlerContext {
    return {
      activeRuns: this.activeRuns,
      connectedClients: this.connectedClients,
      processMonitor: this.processMonitor,
      handleRunStart,
      cancelRun,
      broadcastPluginState: () => this.broadcastPluginState(),
      findProcessPidsByTaskCommand,
      notificationService: this.notificationsService,
      taskCoordination: this.getTaskCoordination(),
      providerRegistry,
      permissionBridge: this.permissionBridge,
      cancelWorkflowRun: this.cancelWorkflowRun,
    };
  }

  getRunHandlerContext(): RunHandlerContext {
    return {
      activeRuns: this.activeRuns,
      processMonitor: this.processMonitor,
      notificationService: this.notificationSender!,
      notificationsService: this.notificationsService,
      serverPort: this.serverPort,
      broadcastHeartbeat: () => this.broadcastHeartbeat(),
      permissionBridge: this.permissionBridge,
      permissionWorkflowResolver: this.permissionWorkflowResolver,
      sessionSync: this.getSessionSync(),
      providerRegistry,
    };
  }

  buildClaudiaTaskSnapshot(): import('@my-claudia/shared/protocol/messages').ClaudiaTaskSnapshotMessage | null {
    const orch = this.taskOrchestrator;
    if (!orch || !this.database) return null;
    const db = this.database;
    const branchService = new ClaudiaBranchService(db);
    const getLastAssistantMessage = db.prepare(
      `SELECT content FROM messages
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY created_at DESC LIMIT 1`
    );
    const getToolCount = db.prepare(
      `SELECT COUNT(*) as count
       FROM tool_call_records
       WHERE session_id = ?`
    );

    const collectTasks = (parentId?: string): import('./application/orchestration/types.js').OrchestratorTask[] => {
      const direct = orch.listTasks(parentId);
      return direct.flatMap((task) => [task, ...collectTasks(task.id)]);
    };

    const tasks = collectTasks()
      .filter((task) => task.initiator === 'claudia')
      .map((task) => {
        const responseText = task.responseText ?? (
          task.sessionId && (task.status === 'completed' || task.status === 'failed')
            ? (getLastAssistantMessage.get(task.sessionId) as { content: string } | undefined)?.content
            : undefined
        );
        const toolCount = task.toolCount ?? (
          task.sessionId
            ? (getToolCount.get(task.sessionId) as { count: number } | undefined)?.count
            : undefined
        );
        return {
          id: task.id,
          sessionId: task.sessionId,
          branchId: task.branchId,
          branchAction: task.branchAction,
          contextReset: task.contextReset,
          input: task.task,
          title: task.task.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Claudia Task',
          status: task.status as import('@my-claudia/shared/protocol/messages').ClaudiaTaskStatus,
          summary: task.resultSummary,
          error: task.errorSummary,
          responseText,
          toolCount: toolCount && toolCount > 0 ? toolCount : undefined,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      type: 'claudia_task_snapshot',
      tasks,
      activeBranches: branchService.listActiveBranches(),
    };
  }
}

/** Singleton server state — initialized once, used everywhere in server.ts */
export const serverState = new ServerState();
