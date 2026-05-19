import type {
  AIReviewCompletedMessage,
  ClaudiaTaskStatus,
  PermissionAutoResolvedMessage,
  PermissionRequestMessage,
  PermissionResolvedMessage,
  ServerMessage,
} from '@my-claudia/shared';
import type { MessageHandlerContext } from './types';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { useNotchPanelStore } from '../../stores/notchPanelStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { useToastStore } from '../../stores/toastStore';

function updateClaudiaTaskStatusBySessionId(
  sessionId: string | undefined,
  status: ClaudiaTaskStatus,
): void {
  if (!sessionId) return;
  const claudiaStore = useClaudiaStore.getState();
  const task = claudiaStore.tasks.find((current) => current.sessionId === sessionId);
  if (!task) return;
  claudiaStore.updateTask(task.id, { status, updatedAt: Date.now() });
}

function buildAIReviewToastMessage(aiMsg: AIReviewCompletedMessage): string | undefined {
  const metadata = aiMsg.metadata;
  if (metadata?.payloadDisposition === 'do_not_send') {
    return 'AI review skipped remote analysis because sensitive local material was detected.';
  }
  if (metadata?.payloadDisposition !== 'send_with_redaction') return undefined;
  const files = metadata.reviewedFileCount ?? 0;
  const redactions = metadata.redactionCount ?? 0;
  return `AI review used sanitized local payload; redactions ${redactions}; reviewed ${files} file${files === 1 ? '' : 's'}.`;
}

function buildAIReviewAutoResolveToastMessage(msg: PermissionAutoResolvedMessage): string | undefined {
  const metadata = msg.metadata;
  if (metadata?.payloadDisposition === 'do_not_send') {
    return 'AI review skipped remote analysis because sensitive local material was detected.';
  }
  if (metadata?.payloadDisposition !== 'send_with_redaction') return undefined;
  const files = metadata.reviewedFileCount ?? 0;
  const redactions = metadata.redactionCount ?? 0;
  return `AI review auto-approved with sanitized local payload; redactions ${redactions}; reviewed ${files} file${files === 1 ? '' : 's'}.`;
}

export function handlePermissionMessage(msg: ServerMessage, ctx: MessageHandlerContext): boolean {
  const { serverId } = ctx;

  switch (msg.type) {
    case 'permission_request': {
      const permMsg = msg as PermissionRequestMessage;
      const backendName = ctx.resolveBackendName();
      usePermissionStore.getState().setPendingRequest({
        requestId: permMsg.requestId,
        sessionId: permMsg.sessionId,
        serverId,
        backendName,
        toolName: permMsg.toolName,
        detail: permMsg.detail,
        matchedRule: permMsg.matchedRule,
        timeoutSec: permMsg.timeoutSeconds,
        requiresCredential: permMsg.requiresCredential,
        credentialHint: permMsg.credentialHint,
        aiInitiated: permMsg.aiInitiated,
        workflowMode: permMsg.workflowMode,
        workflowRunId: permMsg.workflowRunId,
      });
      updateClaudiaTaskStatusBySessionId(permMsg.sessionId, 'waiting');
      useToastStore.getState().add({
        title: 'Permission required',
        message: `${permMsg.toolName} needs approval`,
        type: 'info',
        icon: 'permission',
        sessionId: permMsg.sessionId,
        serverId,
      });
      useNotchPanelStore.getState().open({ auto: true, previewTitle: 'Permission required', tab: 'approvals' });
      return true;
    }

    case 'permission_resolved': {
      const resolvedMsg = msg as PermissionResolvedMessage;
      updateClaudiaTaskStatusBySessionId(resolvedMsg.sessionId, 'running');
      usePermissionStore.getState().clearRequestById(resolvedMsg.requestId);
      return true;
    }

    case 'permission_auto_resolved': {
      const autoMsg = msg as PermissionAutoResolvedMessage;
      updateClaudiaTaskStatusBySessionId(autoMsg.sessionId, 'running');
      const autoResolveToast = buildAIReviewAutoResolveToastMessage(autoMsg);
      if (autoResolveToast) {
        useToastStore.getState().add({
          title: 'Permission auto-approved',
          message: autoResolveToast,
          type: 'success',
          icon: 'permission',
          sessionId: autoMsg.sessionId,
          serverId,
        });
      }
      usePermissionStore.getState().clearRequestById(autoMsg.requestId);
      usePromptRequestStore.getState().clearRequestById(autoMsg.requestId);
      useInteractionStore.getState().resolveInteraction(autoMsg.requestId);
      return true;
    }

    case 'ai_review_completed': {
      const aiMsg = msg as AIReviewCompletedMessage;
      usePermissionStore.getState().setAIReviewResult(aiMsg.requestId, {
        decision: aiMsg.decision,
        reasoning: aiMsg.reasoning,
        confidence: aiMsg.confidence,
        metadata: aiMsg.metadata,
      });
      const toastMessage = buildAIReviewToastMessage(aiMsg);
      if (toastMessage) {
        useToastStore.getState().add({
          title: 'AI review completed',
          message: toastMessage,
          type: aiMsg.decision === 'deny' ? 'error' : 'info',
          icon: 'permission',
          sessionId: aiMsg.sessionId,
          serverId,
        });
      }
      return true;
    }

    case 'permission_workflow_progress': {
      const progressMsg = msg as any;
      usePermissionStore.getState().setWorkflowProgress(progressMsg.requestId, {
        workflowRunId: progressMsg.workflowRunId,
        currentStep: progressMsg.currentStep,
        completedSteps: progressMsg.completedSteps,
        totalSteps: progressMsg.totalSteps,
      });
      return true;
    }

    default:
      return false;
  }
}
