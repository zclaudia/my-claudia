import type {
  AgentPermissionInterceptedMessage,
  BackgroundPermissionPendingMessage,
  BackgroundTaskUpdateMessage,
  PromptRequestMessage,
} from '@my-claudia/shared/protocol/messages';
import type {
  UnifiedPermissionPolicy,
  PermissionRequest,
} from '@my-claudia/shared/interaction/permissions';
import { DEFAULT_UNIFIED_POLICY } from '@my-claudia/shared/interaction/permissions';
import type { AskUserQuestionItem } from '@my-claudia/shared/interaction/forms';
import {
  buildRememberKey,
  classify,
  getAgentPermissionPolicy,
  getMatchedPermissionRule,
  getOutsideWorkspacePaths,
  getProjectPermissionOverride,
  isInternalInteractionTool,
  isOutsideWorkspacePathAllowed,
  mergePolicy,
  normalizePolicy,
  PermissionEvaluator,
  resolveRememberedDecision,
} from '../agent/permission-evaluator.js';
import { isBashLikeTool, isSudoCommand } from '../../../utils/server-utils.js';
import type { PermissionDecision } from '../../../infrastructure/providers/types.js';
import type { ActiveRun } from '../transport/types.js';
import { broadcastRunMessage } from '../transport/broadcast.js';
import { normalizeFromAskUser } from '../interactions/interaction-normalizer.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import { writePermissionLog } from '../agent/permission-log-writer.js';
import type { PermissionBridge } from '../agent/permission-bridge.js';
import type { PermissionEscalationContext } from '../../../domains/workflows/ports/step-executor.js';
import { pluginEvents } from '../../../infrastructure/events/index.js';

interface SessionContext {
  project_id: string;
}

interface MessageContext {
  sessionId: string;
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
}

export interface CreatePermissionCallbackInput {
  activeRun: ActiveRun;
  cwd: string;
  db: ActiveRun['db'];
  forcedPlanBySession: boolean;
  markPendingResolutionResumed: () => void;
  message: MessageContext;
  modeValue: string;
  notificationService: NotificationSender;
  providerType: string;
  runId: string;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  session: SessionContext;
  sessionType: 'regular' | 'background' | 'agent';
  /** Permission bridge for workflow-based permission handling */
  permissionBridge: PermissionBridge;
}

export function createPermissionCallback(input: CreatePermissionCallbackInput) {
  const {
    activeRun,
    cwd,
    db,
    forcedPlanBySession,
    markPendingResolutionResumed,
    message,
    modeValue,
    notificationService,
    permissionBridge,
    providerType,
    runId,
    sendRunEvent,
    session,
    sessionType,
  } = input;

  const sessionPermissionOverride = message.permissionOverride;

  return async (request: PermissionRequest) => {
    return new Promise<PermissionDecision>((resolve) => {
      if (forcedPlanBySession && modeValue === 'plan') {
        const planReadOnlyTools = new Set([
          'read', 'glob', 'grep', 'webfetch', 'websearch', 'todowrite', 'ls', 'askuserquestion',
        ]);
        const normalizedTool = request.toolName.toLowerCase();
        const isAllowedReadTool = planReadOnlyTools.has(normalizedTool);
        const shouldDeny = isBashLikeTool(request.toolName) || !isAllowedReadTool;
        if (shouldDeny) {
          const reason = `Denied by strict Plan Mode: ${request.toolName} is not allowed.`;
          broadcastRunMessage(activeRun, {
            type: 'agent_permission_intercepted',
            toolName: request.toolName,
            decision: 'deny',
            reason,
            sessionId: message.sessionId,
            runId,
          } as AgentPermissionInterceptedMessage);
          writePermissionLog(db, message.sessionId, request.toolName, request.detail, 'deny', false);
          resolve({ behavior: 'deny', message: reason });
          return;
        }
      }

      const rememberKey = buildRememberKey(request.toolName, request.toolInput, request.detail);
      const remembered = resolveRememberedDecision(
        activeRun.rememberedDecisions,
        request.toolName,
        request.toolInput,
        request.detail,
      );
      if (remembered) {
        broadcastRunMessage(activeRun, {
          type: 'agent_permission_intercepted',
          toolName: request.toolName,
          decision: remembered === 'allow' ? 'approve' : 'deny',
          reason: `Remembered decision (${remembered}) for "${rememberKey}"`,
          sessionId: message.sessionId,
          runId,
        } as AgentPermissionInterceptedMessage);
        writePermissionLog(db, message.sessionId, request.toolName, request.detail, remembered, true);
        resolve({ behavior: remembered, message: remembered === 'deny' ? 'Denied (remembered)' : undefined });
        return;
      }

      if (
        classify(request.toolName, request.toolInput, request.detail) === 'fileRead'
        && isOutsideWorkspacePathAllowed(
          request.toolName,
          request.toolInput,
          request.detail,
          activeRun.workspaceRoot,
          activeRun.allowedOutsideWorkspaceRoots,
        )
      ) {
        broadcastRunMessage(activeRun, {
          type: 'agent_permission_intercepted',
          toolName: request.toolName,
          decision: 'approve',
          reason: 'Auto-approved for remembered outside-workspace directory',
          sessionId: message.sessionId,
          runId,
        } as AgentPermissionInterceptedMessage);
        writePermissionLog(db, message.sessionId, request.toolName, request.detail, 'allow', true);
        resolve({ behavior: 'allow', updatedInput: request.toolInput });
        return;
      }

      const globalPolicy = getAgentPermissionPolicy(db);
      const projectOverride = getProjectPermissionOverride(db, session.project_id);

      let effectivePolicy = globalPolicy
        ? mergePolicy(globalPolicy, projectOverride)
        : projectOverride
          ? normalizePolicy(projectOverride)
          : DEFAULT_UNIFIED_POLICY;

      if (sessionPermissionOverride) {
        effectivePolicy = mergePolicy(effectivePolicy, sessionPermissionOverride);
      }

      const commandPreview = isBashLikeTool(request.toolName)
        ? ` | cmd=${JSON.stringify((request.toolInput as Record<string, unknown>)?.command || request.detail).slice(0, 120)}`
        : '';
      console.log(`[Permission] Tool=${request.toolName}${commandPreview} | effective=${effectivePolicy?.enabled ? 'enabled' : 'null/disabled'} | sessionType=${sessionType}`);

      if (effectivePolicy?.enabled) {
        const evaluator = new PermissionEvaluator();
        const decision = evaluator.evaluate(
          request.toolName,
          request.toolInput,
          request.detail,
          effectivePolicy,
          { rootPath: cwd, sessionType },
        );
        if (decision === 'approve') {
          broadcastRunMessage(activeRun, {
            type: 'agent_permission_intercepted',
            toolName: request.toolName,
            decision: 'approve',
            reason: 'Auto-approved by category policy',
            sessionId: message.sessionId,
            runId,
          } as AgentPermissionInterceptedMessage);
          resolve({ behavior: 'allow', updatedInput: request.toolInput });
          return;
        }
        if (decision === 'deny') {
          broadcastRunMessage(activeRun, {
            type: 'agent_permission_intercepted',
            toolName: request.toolName,
            decision: 'deny',
            reason: 'Blocked by category policy',
            sessionId: message.sessionId,
            runId,
          } as AgentPermissionInterceptedMessage);
          resolve({ behavior: 'deny', message: 'Denied by policy' });
          return;
        }
      }

      const matchedRule = effectivePolicy?.enabled
        ? getMatchedPermissionRule(
            request.toolName,
            request.toolInput,
            request.detail,
            effectivePolicy,
            { rootPath: cwd, sessionType },
          ) || undefined
        : undefined;

      if (matchedRule === 'Outside workspace access') {
        const outsidePaths = getOutsideWorkspacePaths(
          request.toolName,
          request.toolInput,
          request.detail,
          cwd,
        );
        const bashCommand = isBashLikeTool(request.toolName)
          ? ((request.toolInput as { command?: unknown } | undefined)?.command ?? request.detail)
          : undefined;
        console.warn('[Permission] Outside workspace access detected', {
          sessionId: message.sessionId,
          runId,
          toolName: request.toolName,
          rootPath: cwd,
          command: bashCommand,
          outsidePaths,
        });
      }

      const continueWithUserFlow = () => {
        if (isInternalInteractionTool(request.toolName)) {
          broadcastRunMessage(activeRun, {
            type: 'agent_permission_intercepted',
            toolName: request.toolName,
            decision: 'approve',
            reason: 'Internal interaction tool handles its own user flow',
            sessionId: message.sessionId,
            runId,
          } as AgentPermissionInterceptedMessage);
          resolve({ behavior: 'allow', updatedInput: request.toolInput });
          return;
        }

        if (sessionType === 'background') {
          broadcastRunMessage(activeRun, {
            type: 'background_permission_pending',
            sessionId: message.sessionId,
            requestId: request.requestId,
            toolName: request.toolName,
            detail: request.detail,
            timeoutSeconds: request.timeoutSeconds,
          } as BackgroundPermissionPendingMessage);

          broadcastRunMessage(activeRun, {
            type: 'background_task_update',
            sessionId: message.sessionId,
            status: 'paused',
            reason: `Permission needed: ${request.toolName}`,
          } as BackgroundTaskUpdateMessage);

          notificationService.notify({
            type: 'background_permission',
            title: 'Background task needs attention',
            body: `${request.toolName}: ${request.detail.slice(0, 200)}`,
            priority: 'urgent',
            tags: ['rotating_light'],
          });
        }

        const isEscalateAlways = effectivePolicy?.escalateAlways?.includes(request.toolName);
        const category = classify(request.toolName, request.toolInput, request.detail);

        // ── All permission escalations go through the workflow engine ──
        const escalationContext: PermissionEscalationContext = {
          requestId: request.requestId,
          runId,
          sessionId: message.sessionId,
          toolName: request.toolName,
          toolInput: request.toolInput as Record<string, unknown>,
          detail: request.detail,
          cwd,
          category,
          matchedRule,
          isEscalateAlways: !!isEscalateAlways,
          sessionType,
          aiInitiatedPlanMode: !!activeRun.aiInitiatedPlanMode,
        };

        // Register in bridge so workflow's permission_decide step can resolve it
        permissionBridge.register(request.requestId, resolve, escalationContext);

        // Store pending permission (user can still manually decide via frontend)
        const isAskUserQuestion = request.toolName === 'AskUserQuestion';
        const toolInput = request.toolInput as Record<string, unknown>;
        const requiresCredential = !isAskUserQuestion && isSudoCommand(request.toolName, request.toolInput);
        activeRun.pendingPermissions.set(request.requestId, {
          resolve,
          timeout: null,
          originalToolInput: request.toolInput,
          originalRequest: {
            toolName: request.toolName,
            detail: request.detail,
            ...(matchedRule && { matchedRule }),
            timeoutSeconds: 0,
            sessionId: message.sessionId,
            ...(requiresCredential && { requiresCredential: true, credentialHint: 'sudo_password' }),
            ...(isAskUserQuestion && { questions: (toolInput.questions as AskUserQuestionItem[]) || [] }),
          },
        });

        db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
          .run('waiting', Date.now(), activeRun.sessionId);

        // Emit event to trigger the permission workflow
        pluginEvents.emit('permission.escalated', escalationContext as unknown as Record<string, unknown>);
        console.log(`[Permission] Delegated ${request.requestId} (${request.toolName}) to permission workflow`);

        // Send request to frontend (user can still manually approve/deny)
        if (sessionType !== 'background') {
          if (isAskUserQuestion) {
            const askUserInput = request.toolInput as { questions?: AskUserQuestionItem[] };
            broadcastRunMessage(activeRun, {
              type: 'prompt_request',
              requestId: request.requestId,
              sessionId: message.sessionId,
              questions: askUserInput.questions || [],
            } as PromptRequestMessage);
            console.log(`[Permission] Sent prompt_request ${request.requestId} to client (${(askUserInput.questions || []).length} questions)`);
            const askUserInteraction = normalizeFromAskUser({
              requestId: request.requestId,
              sessionId: message.sessionId,
              runId,
              providerType,
              questions: askUserInput.questions || [],
            });
            sendRunEvent(askUserInteraction);
            const firstQuestion = (askUserInput.questions || [])[0] as { question?: string } | undefined;
            notificationService.notify({
              type: 'prompt_request',
              title: 'Claude has a question',
              body: firstQuestion?.question?.slice(0, 200) || 'Interactive question',
              priority: 'high',
              tags: ['question'],
            });
          } else {
            broadcastRunMessage(activeRun, {
              type: 'permission_request',
              requestId: request.requestId,
              sessionId: message.sessionId,
              toolName: request.toolName,
              detail: request.detail,
              ...(matchedRule && { matchedRule }),
              timeoutSeconds: 0,
              ...(requiresCredential && {
                requiresCredential: true,
                credentialHint: 'sudo_password',
              }),
              workflowMode: true,
            } as import('@my-claudia/shared/protocol/messages').PermissionRequestMessage);
            console.log(`[Permission] Sent permission request ${request.requestId} to client`);
            notificationService.notify({
              type: 'permission_request',
              title: 'Permission Required',
              body: `${matchedRule ? `[${matchedRule}] ` : ''}${request.toolName}: ${request.detail.slice(0, 200)}`,
              priority: 'urgent',
              tags: ['warning'],
            });
          }
        }
      };

      continueWithUserFlow();
    });
  };
}
