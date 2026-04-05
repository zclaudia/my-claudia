import type { initDatabase } from '../../storage/db.js';
import type { ConnectedClient, ActiveRun } from '../conversation/ws/types.js';
import { sendMessage } from '../conversation/ws/broadcast.js';
import { SessionRepository } from '../sessions/repository.js';
import { registerTaskTools } from '../conversation/agent-tools/task-tools.js';
import { createTaskOrchestrator } from './task-orchestrator.js';
import type { TaskOrchestrator } from './types.js';
import type { NotificationService } from '../notification/service.js';

export interface OrchestrationDomainDeps {
  db: ReturnType<typeof initDatabase>;
  clients: Map<string, ConnectedClient>;
  handleRunStart: (...args: any[]) => Promise<void>;
  createVirtualClient: typeof import('../conversation/ws/types.js').createVirtualClient;
  getServerPort: () => number | null;
  notificationService: NotificationService;
}

export interface OrchestrationDomainResult {
  orchestrator: TaskOrchestrator;
}

export function registerOrchestrationDomain(
  deps: OrchestrationDomainDeps,
): OrchestrationDomainResult {
  const {
    db,
    clients,
    handleRunStart,
    createVirtualClient,
    getServerPort,
    notificationService,
  } = deps;

  const sessionRepo = new SessionRepository(db);
  const orchestrator = createTaskOrchestrator({
    db,
    createVirtualClient,
    handleRunStart,
    getClients: () => clients,
    serverPort: getServerPort(),
    createSession: (opts) => sessionRepo.create({
      projectId: opts.projectId,
      name: opts.name,
      type: opts.type,
    } as any),
    sessionExists: (id) => !!sessionRepo.findById(id),
    notificationService,
    onTaskStatusChange: (task, extra) => {
      if (task.initiator !== 'claudia') return;
      const update: import('@my-claudia/shared').ClaudiaTaskUpdateMessage = {
        type: 'claudia_task_update',
        taskId: task.id,
        status: task.status as import('@my-claudia/shared').ClaudiaTaskStatus,
        sessionId: task.sessionId ?? undefined,
        branchId: task.branchId ?? undefined,
        branchAction: task.branchAction,
        contextReset: task.contextReset,
        input: task.task,
        title: task.task.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Claudia Task',
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        summary: task.resultSummary,
        error: task.errorSummary,
        responseText: extra?.responseText ?? task.responseText,
        toolCount: extra?.toolCount ?? task.toolCount,
      };
      for (const [, client] of clients) {
        if (client.authenticated) sendMessage(client.ws, update);
      }
    },
    onTaskDelta: (taskId, content) => {
      const delta: import('@my-claudia/shared').ClaudiaTaskDeltaMessage = {
        type: 'claudia_task_delta',
        taskId,
        content,
      };
      for (const [, client] of clients) {
        if (client.authenticated) sendMessage(client.ws, delta);
      }
    },
  });

  registerTaskTools(orchestrator, () => db);
  orchestrator.start(10000);

  return { orchestrator };
}
