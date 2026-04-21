/**
 * Claudia task and inline response message handlers.
 */
import type { ServerMessage } from '@my-claudia/shared';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { useToastStore } from '../../stores/toastStore';
import { useNotchPanelStore } from '../../stores/notchPanelStore';

export function handleClaudiaMessage(msg: ServerMessage, serverId: string): boolean {
  switch (msg.type) {
    case 'claudia_task_created': {
      const taskMsg = msg as import('@my-claudia/shared').ClaudiaTaskCreatedMessage;
      const claudiaStore = useClaudiaStore.getState();
      const optimistic = claudiaStore.tasks.find(t => t.id === taskMsg.clientRequestId);
      if (optimistic) {
        claudiaStore.removeTask(taskMsg.clientRequestId);
        claudiaStore.addTask({
          ...optimistic,
          id: taskMsg.taskId,
          sessionId: taskMsg.sessionId || null,
          branchId: taskMsg.branchId || null,
          branchAction: taskMsg.branchAction,
          contextReset: taskMsg.contextReset,
          title: taskMsg.title,
          status: taskMsg.status,
          updatedAt: Date.now(),
        });
      } else {
        claudiaStore.addTask({
          id: taskMsg.taskId,
          sessionId: taskMsg.sessionId || null,
          branchId: taskMsg.branchId || null,
          branchAction: taskMsg.branchAction,
          contextReset: taskMsg.contextReset,
          input: '',
          title: taskMsg.title,
          status: taskMsg.status,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      if (taskMsg.branchAction !== 'forked') {
        claudiaStore.setActiveBranchId(taskMsg.projectId, taskMsg.branchId);
      }
      return true;
    }

    case 'claudia_task_snapshot': {
      const snapshotMsg = msg as import('@my-claudia/shared').ClaudiaTaskSnapshotMessage;
      const snapshotStore = useClaudiaStore.getState();
      const snapshotTasks = [...snapshotMsg.tasks]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(t => ({ ...t, branchId: t.branchId ?? null }));
      snapshotStore.setTasks(snapshotTasks);
      snapshotStore.setActiveBranchIds(
        Object.fromEntries(snapshotMsg.activeBranches.map((state) => [state.projectId, state.branchId]))
      );
      return true;
    }

    case 'claudia_message_delta': {
      const inlineDelta = msg as import('@my-claudia/shared').ClaudiaMessageDeltaMessage;
      useClaudiaStore.getState().appendInlineDelta(inlineDelta.clientRequestId, inlineDelta.content);
      return true;
    }

    case 'claudia_message_completed': {
      const inlineCompleted = msg as import('@my-claudia/shared').ClaudiaMessageCompletedMessage;
      useClaudiaStore.getState().completeInline(inlineCompleted.clientRequestId, inlineCompleted.responseText);
      return true;
    }

    case 'claudia_message_failed': {
      const inlineFailed = msg as import('@my-claudia/shared').ClaudiaMessageFailedMessage;
      useClaudiaStore.getState().failInline(inlineFailed.clientRequestId, inlineFailed.error);
      return true;
    }

    case 'claudia_message_promoted': {
      const inlinePromoted = msg as import('@my-claudia/shared').ClaudiaMessagePromotedMessage;
      const claudiaForPromotion = useClaudiaStore.getState();
      const inline = claudiaForPromotion.inlineResponses.find((r) => r.clientRequestId === inlinePromoted.clientRequestId);
      claudiaForPromotion.promoteInline(inlinePromoted.clientRequestId, inlinePromoted.taskId);
      claudiaForPromotion.addTask({
        id: inlinePromoted.taskId,
        sessionId: inlinePromoted.sessionId,
        branchId: inlinePromoted.branchId || null,
        branchAction: inlinePromoted.branchAction,
        contextReset: inlinePromoted.contextReset,
        input: inline?.input || '',
        title: (inline?.input || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        status: 'running',
        createdAt: inline?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      if (inlinePromoted.branchId && inlinePromoted.branchAction !== 'forked') {
        claudiaForPromotion.setActiveBranchId(inlinePromoted.projectId, inlinePromoted.branchId);
      }
      if (inline?.streamingText) {
        claudiaForPromotion.appendStreamingText(inlinePromoted.taskId, inline.streamingText);
      }
      return true;
    }

    case 'claudia_task_delta': {
      const deltaMsg = msg as import('@my-claudia/shared').ClaudiaTaskDeltaMessage;
      useClaudiaStore.getState().appendStreamingText(deltaMsg.taskId, deltaMsg.content);
      return true;
    }

    case 'claudia_task_update': {
      const updateMsg = msg as import('@my-claudia/shared').ClaudiaTaskUpdateMessage;
      const claudiaStoreForUpdate = useClaudiaStore.getState();
      const existing = claudiaStoreForUpdate.tasks.find((t) => t.id === updateMsg.taskId);
      if (!existing) {
        claudiaStoreForUpdate.addTask({
          id: updateMsg.taskId,
          sessionId: updateMsg.sessionId || null,
          branchId: updateMsg.branchId || null,
          branchAction: updateMsg.branchAction,
          contextReset: updateMsg.contextReset,
          input: updateMsg.input || '',
          title: updateMsg.title || updateMsg.input || 'Claudia Task',
          status: updateMsg.status,
          createdAt: updateMsg.createdAt || Date.now(),
          updatedAt: updateMsg.updatedAt || Date.now(),
          ...(updateMsg.summary ? { summary: updateMsg.summary } : {}),
          ...(updateMsg.error ? { error: updateMsg.error } : {}),
          ...(updateMsg.responseText !== undefined ? { responseText: updateMsg.responseText } : {}),
          ...(updateMsg.toolCount != null ? { toolCount: updateMsg.toolCount } : {}),
        });
        if (updateMsg.status === 'completed' || updateMsg.status === 'failed' || updateMsg.status === 'cancelled') {
          claudiaStoreForUpdate.clearStreamingText(updateMsg.taskId);
        }
        return true;
      }

      claudiaStoreForUpdate.updateTask(updateMsg.taskId, {
        status: updateMsg.status,
        ...(updateMsg.sessionId ? { sessionId: updateMsg.sessionId } : {}),
        ...(updateMsg.branchId ? { branchId: updateMsg.branchId } : {}),
        ...(updateMsg.branchAction ? { branchAction: updateMsg.branchAction } : {}),
        ...(updateMsg.contextReset !== undefined ? { contextReset: updateMsg.contextReset } : {}),
        ...(updateMsg.input ? { input: updateMsg.input } : {}),
        ...(updateMsg.title ? { title: updateMsg.title } : {}),
        ...(updateMsg.createdAt ? { createdAt: updateMsg.createdAt } : {}),
        ...(updateMsg.updatedAt ? { updatedAt: updateMsg.updatedAt } : {}),
        ...(updateMsg.summary ? { summary: updateMsg.summary } : {}),
        ...(updateMsg.error ? { error: updateMsg.error } : {}),
        ...(updateMsg.responseText !== undefined ? { responseText: updateMsg.responseText } : {}),
        ...(updateMsg.toolCount != null ? { toolCount: updateMsg.toolCount } : {}),
      });
      if (updateMsg.status === 'completed' || updateMsg.status === 'failed' || updateMsg.status === 'cancelled') {
        claudiaStoreForUpdate.clearStreamingText(updateMsg.taskId);
      }
      if (updateMsg.status === 'completed' || updateMsg.status === 'failed') {
        const taskTitle = existing?.title || updateMsg.title || updateMsg.input || 'Claudia task';
        useToastStore.getState().add({
          title: taskTitle,
          message: updateMsg.status === 'completed'
            ? (updateMsg.summary?.slice(0, 100) || 'Task completed')
            : (updateMsg.error?.slice(0, 100) || 'Task failed'),
          type: updateMsg.status === 'completed' ? 'success' : 'error',
          icon: updateMsg.status === 'completed' ? 'task' : 'error',
          initiator: 'claudia',
          sessionId: existing?.sessionId ?? updateMsg.sessionId ?? undefined,
          serverId,
        });
        useNotchPanelStore.getState().open({ auto: true, previewTitle: taskTitle, tab: 'claudia' });
      }
      return true;
    }

    default:
      return false;
  }
}
