import type { ServerMessage } from '@my-claudia/shared';
import type { MessageDispatchContext } from './types';
import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';

function isCompletedBackgroundStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

function upsertBackgroundTask(taskId: string, task: BackgroundTask): void {
  const backgroundTaskStore = useBackgroundTaskStore.getState();
  const existingTask = backgroundTaskStore.tasks[taskId];

  if (existingTask) {
    const nextDescription = !task.description || task.description === 'Background Task'
      ? existingTask.description
      : task.description;
    backgroundTaskStore.updateTask(taskId, {
      ...task,
      startedAt: existingTask.startedAt,
      description: nextDescription,
      toolUseId: task.toolUseId || existingTask.toolUseId,
      cliPid: task.cliPid ?? existingTask.cliPid,
      taskCommand: task.taskCommand ?? existingTask.taskCommand,
      taskRootPid: task.taskRootPid ?? existingTask.taskRootPid,
    });
    return;
  }

  backgroundTaskStore.addTask(task);
}

export function handleBackgroundTaskMessage(msg: ServerMessage, ctx: MessageDispatchContext): boolean {
  const { serverId } = ctx;

  switch (msg.type) {
    case 'background_task_update': {
      const targetSessionId = msg.parentSessionId || msg.sessionId;
      if (!targetSessionId) return true;

      const taskId = `background:${msg.sessionId}`;
      const mappedStatus = msg.status === 'running'
        ? 'in_progress'
        : msg.status === 'paused'
        ? 'paused'
        : msg.status;

      upsertBackgroundTask(taskId, {
        id: taskId,
        serverId,
        sessionId: targetSessionId,
        description: msg.name || 'Background Task',
        source: 'background_run',
        stoppable: false,
        status: mappedStatus,
        startedAt: Date.now(),
        summary: msg.reason,
        completedAt: isCompletedBackgroundStatus(mappedStatus) ? Date.now() : undefined,
      });
      return true;
    }

    case 'task_notification': {
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      if (msg.sessionId && msg.taskId) {
        upsertBackgroundTask(msg.taskId, {
          id: msg.taskId,
          serverId,
          sessionId: msg.sessionId,
          description: msg.message || 'Background Task',
          source: 'sdk_task',
          stoppable: true,
          status: (msg.status || 'in_progress') as 'started' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'stopped',
          startedAt: Date.now(),
          summary: msg.message,
          completedAt: isCompletedBackgroundStatus(msg.status) ? Date.now() : undefined,
          cliPid: msg.cliPid,
          taskCommand: msg.taskCommand,
          taskRootPid: msg.taskRootPid,
        });
      }
      return true;
    }

    case 'task_progress': {
      upsertBackgroundTask(msg.taskId, {
        id: msg.taskId,
        serverId,
        toolUseId: msg.toolUseId,
        sessionId: msg.sessionId,
        description: msg.description || 'Background Task',
        source: 'sdk_task',
        stoppable: true,
        status: 'in_progress',
        startedAt: Date.now(),
        usage: msg.usage,
        summary: msg.lastToolName ? `Last tool: ${msg.lastToolName}` : undefined,
      });
      return true;
    }

    case 'task_status_notification': {
      upsertBackgroundTask(msg.taskId, {
        id: msg.taskId,
        serverId,
        toolUseId: msg.toolUseId,
        sessionId: msg.sessionId,
        description: msg.summary || 'Background Task',
        source: 'sdk_task',
        stoppable: true,
        status: msg.status,
        startedAt: Date.now(),
        completedAt: Date.now(),
        outputFile: msg.outputFile,
        summary: msg.summary,
        usage: msg.usage,
      });
      return true;
    }

    default:
      return false;
  }
}
