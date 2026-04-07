import type {
  AgentPermissionInterceptedMessage,
  BackgroundPermissionPendingMessage,
  BackgroundTaskUpdateMessage,
  PermissionAutoResolvedMessage,
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
  isUnifiedPolicy,
  mergePolicy,
  normalizePolicy,
  PermissionEvaluator,
  resolveRememberedDecision,
} from '../agent/permission-evaluator.js';
import { isBashLikeTool, isSudoCommand } from '../../../helpers/server-utils.js';
import type { PermissionDecision } from '../../../infrastructure/providers/types.js';
import { PERMISSION_TIMEOUT_POLICIES, type ActiveRun } from '../transport/types.js';
import { broadcastRunMessage } from '../transport/broadcast.js';
import { normalizeFromAskUser } from '../interactions/interaction-normalizer.js';
import type { PushNotificationService } from '../../../infrastructure/push/push-notification-service.js';

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
  notificationService: PushNotificationService;
  onAIReviewResolved: (input: {
    requestId: string;
    toolName: string;
    detail: string;
    result: import('@my-claudia/shared/interaction/permissions').AIReviewResult;
  }) => void;
  providerType: string;
  runId: string;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  session: SessionContext;
  sessionType: 'regular' | 'background' | 'agent';
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
    onAIReviewResolved,
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
        const timeoutPolicy = PERMISSION_TIMEOUT_POLICIES.get(request.toolName);
        const policyApplies = timeoutPolicy && (!timeoutPolicy.condition || timeoutPolicy.condition(activeRun));
        const aiReviewConfig = effectivePolicy && isUnifiedPolicy(effectivePolicy)
          ? effectivePolicy.aiReview
          : undefined;

        let effectiveTimeoutSeconds: number;
        let effectiveTimeoutBehavior: 'approve' | 'deny' | 'ai_review';
        let aiInitiated = false;

        if (policyApplies) {
          effectiveTimeoutBehavior = timeoutPolicy!.behavior;
          effectiveTimeoutSeconds = request.timeoutSeconds || timeoutPolicy!.timeoutSeconds || 0;
          aiInitiated = timeoutPolicy!.behavior === 'approve';
        } else if (!isEscalateAlways && aiReviewConfig?.enabled) {
          effectiveTimeoutBehavior = 'ai_review';
          effectiveTimeoutSeconds = aiReviewConfig.timeoutBeforeReview;
        } else {
          effectiveTimeoutBehavior = 'deny';
          effectiveTimeoutSeconds = request.timeoutSeconds;
        }

        let timeout: ReturnType<typeof setTimeout> | null = null;
        if (effectiveTimeoutSeconds > 0) {
          const timeoutMs = effectiveTimeoutSeconds * 1000;
          timeout = setTimeout(() => void (async () => {
            if (!activeRun.pendingPermissions.has(request.requestId)) return;

            if (effectiveTimeoutBehavior === 'ai_review' && aiReviewConfig) {
              console.log(`[AI Review] Enqueuing review for ${request.requestId} (${request.toolName}), queue depth: ${activeRun.aiReviewQueue?.pendingCount ?? 0}`);
              try {
                const aiResult = await activeRun.aiReviewQueue!.enqueue(
                  request.requestId,
                  aiReviewConfig,
                  {
                    toolName: request.toolName,
                    toolInput: request.toolInput,
                    detail: request.detail,
                    cwd,
                  },
                );

                if (!activeRun.pendingPermissions.has(request.requestId)) return;

                if (aiResult.decision === 'approve') {
                  onAIReviewResolved({
                    requestId: request.requestId,
                    toolName: request.toolName,
                    detail: request.detail,
                    result: aiResult,
                  });
                  activeRun.pendingPermissions.delete(request.requestId);
                  const resolvedEvent = {
                    type: 'permission_auto_resolved',
                    requestId: request.requestId,
                    sessionId: message.sessionId,
                    behavior: 'approve' as const,
                    reason: `AI review: ${aiResult.reasoning} (${Math.round(aiResult.confidence * 100)}%)`,
                    metadata: aiResult.metadata,
                  } as PermissionAutoResolvedMessage;
                  broadcastRunMessage(activeRun, resolvedEvent);
                  console.log(`[AI Review] Approved ${request.requestId} (${request.toolName}): ${aiResult.reasoning}`);
                  markPendingResolutionResumed();
                  resolve({ behavior: 'allow', updatedInput: request.toolInput });
                } else {
                  onAIReviewResolved({
                    requestId: request.requestId,
                    toolName: request.toolName,
                    detail: request.detail,
                    result: aiResult,
                  });
                  const reviewEvent = {
                    type: 'ai_review_completed',
                    requestId: request.requestId,
                    sessionId: message.sessionId,
                    decision: aiResult.decision,
                    reasoning: aiResult.reasoning,
                    confidence: aiResult.confidence,
                    metadata: aiResult.metadata,
                  } as import('@my-claudia/shared/protocol/messages').AIReviewCompletedMessage;
                  broadcastRunMessage(activeRun, reviewEvent);
                  console.log(`[AI Review] ${aiResult.decision} ${request.requestId} (${request.toolName}): ${aiResult.reasoning} — keeping pending for user`);
                }
              } catch (err) {
                console.error('[AI Review] Failed:', err);
                if (activeRun.pendingPermissions.has(request.requestId)) {
                  const failEvent: import('@my-claudia/shared/protocol/messages').AIReviewCompletedMessage = {
                    type: 'ai_review_completed',
                    requestId: request.requestId,
                    sessionId: message.sessionId,
                    decision: 'uncertain',
                    reasoning: `AI review failed: ${err instanceof Error ? err.message : String(err)}`,
                    confidence: 0,
                  };
                  broadcastRunMessage(activeRun, failEvent);
                }
              }
            } else {
              activeRun.pendingPermissions.delete(request.requestId);
              const behavior = effectiveTimeoutBehavior === 'ai_review' ? 'deny' : effectiveTimeoutBehavior;
              const resolvedEvent = {
                type: 'permission_auto_resolved',
                requestId: request.requestId,
                sessionId: message.sessionId,
                behavior,
              } as PermissionAutoResolvedMessage;
              broadcastRunMessage(activeRun, resolvedEvent);
              markPendingResolutionResumed();
              if (behavior === 'approve') {
                console.log(`[Permission] Auto-approved ${request.requestId} (${request.toolName}) on timeout`);
                resolve({ behavior: 'allow', updatedInput: request.toolInput });
              } else {
                console.log(`[Permission] Auto-denied ${request.requestId} (${request.toolName}) on timeout`);
                resolve({ behavior: 'deny', message: 'Permission request timed out' });
              }
            }
          })().catch((err) => {
            console.error(`[Permission] Timeout handler error for ${request.requestId}:`, err);
          }), timeoutMs);
        }

        const isAskUserQuestion = request.toolName === 'AskUserQuestion';
        const toolInput = request.toolInput as Record<string, unknown>;
        const requiresCredential = !isAskUserQuestion && isSudoCommand(request.toolName, request.toolInput);
        activeRun.pendingPermissions.set(request.requestId, {
          resolve,
          timeout,
          originalToolInput: request.toolInput,
          originalRequest: {
            toolName: request.toolName,
            detail: request.detail,
            ...(matchedRule && { matchedRule }),
            timeoutSeconds: effectiveTimeoutSeconds,
            sessionId: message.sessionId,
            ...(requiresCredential && { requiresCredential: true, credentialHint: 'sudo_password' }),
            ...(isAskUserQuestion && { questions: (toolInput.questions as AskUserQuestionItem[]) || [] }),
            ...(aiInitiated && { aiInitiated: true }),
          },
        });
        console.log(`[Permission] Stored pending permission ${request.requestId} in run ${runId} (timeout: ${effectiveTimeoutSeconds > 0 ? `${effectiveTimeoutSeconds}s` : 'none'}, behavior: ${effectiveTimeoutBehavior}, aiInitiated: ${aiInitiated}, session: ${sessionType})`);

        db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
          .run('waiting', Date.now(), activeRun.sessionId);

        if (sessionType !== 'background') {
          if (request.toolName === 'AskUserQuestion') {
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
            const requestRequiresCredential = isSudoCommand(request.toolName, request.toolInput);
            broadcastRunMessage(activeRun, {
              type: 'permission_request',
              requestId: request.requestId,
              sessionId: message.sessionId,
              toolName: request.toolName,
              detail: request.detail,
              ...(matchedRule && { matchedRule }),
              timeoutSeconds: effectiveTimeoutSeconds,
              ...(requestRequiresCredential && {
                requiresCredential: true,
                credentialHint: 'sudo_password',
              }),
              ...(aiInitiated && { aiInitiated: true }),
            } as import('@my-claudia/shared/protocol/messages').PermissionRequestMessage);
            console.log(`[Permission] Sent permission request ${request.requestId} to client${requestRequiresCredential ? ' (requires sudo credential)' : ''}${aiInitiated ? ' (ai-initiated, auto-approve on timeout)' : ''}`);
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
