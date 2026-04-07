import { AIReviewQueue } from '../agent/ai-review-queue.js';
import { processAtMentions } from '../../../utils/server-utils.js';
import { runAIReviewCliJob, supportsAIReviewCliJob } from '../../../infrastructure/providers/cli-jobs/review-job.js';
import { createPermissionCallback } from './run-permissions.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import type { PushNotificationService } from '../../../infrastructure/push/push-notification-service.js';
import type { ProviderConfig } from '@my-claudia/shared/core/provider';

function parseProviderEnv(envJson: string | null, providerId: string): Record<string, string> {
  if (!envJson) return {};

  try {
    const parsed = JSON.parse(envJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[AI Review] Ignoring invalid provider env for ${providerId}: expected object`);
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)])
    );
  } catch (error) {
    console.warn(
      `[AI Review] Failed to parse provider env for ${providerId}:`,
      error instanceof Error ? error.message : error
    );
    return {};
  }
}

interface PrepareProviderRunInput {
  activeRun: ActiveRun;
  client: ConnectedClient;
  broadcastToOtherAuthenticatedClients: (
    clients: Map<string, ConnectedClient>,
    originClientId: string,
    message: import('@my-claudia/shared/protocol/messages').ServerMessage,
  ) => void;
  connectedClients: Map<string, ConnectedClient>;
  cwd: string;
  db: ActiveRun['db'];
  message: RunStartMessage;
  notificationService: PushNotificationService;
  onAIReviewResolved: (input: {
    requestId: string;
    toolName: string;
    detail: string;
    result: import('@my-claudia/shared/interaction/permissions').AIReviewResult;
  }) => void;
  providerConfig?: ProviderConfig;
  providerId: string | null;
  providerType: string;
  runId: string;
  sendMessage: (ws: ConnectedClient['ws'], message: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  markPendingResolutionResumed: () => void;
  aiReviewSystemPrompt: string;
}

export interface PreparedProviderRun {
  forcedPlanBySession: boolean;
  modeValue: string;
  permissionCallback: ReturnType<typeof createPermissionCallback>;
  processedInput: string;
}

export function prepareProviderRun(input: PrepareProviderRunInput): PreparedProviderRun {
  const {
    activeRun,
    aiReviewSystemPrompt,
    client,
    broadcastToOtherAuthenticatedClients,
    connectedClients,
    cwd,
    db,
    markPendingResolutionResumed,
    message,
    notificationService,
    onAIReviewResolved,
    providerConfig,
    providerId,
    providerType,
    runId,
    sendMessage,
    sendRunEvent,
    session,
    sessionType,
  } = input;

  const processedInput = processAtMentions(message.input, session.root_path);
  console.log('[@ Mention] Original input:', message.input);
  if (processedInput !== message.input) {
    console.log('[@ Mention] Processed input:', processedInput);
  }

  const forcedPlanBySession = session.project_role === 'task' && session.plan_status === 'planning';
  const modeValue = forcedPlanBySession
    ? 'plan'
    : (message.mode || message.permissionMode || 'default');
  if (forcedPlanBySession && modeValue !== (message.mode || message.permissionMode || 'default')) {
    console.log(`[Mode] Forced plan mode for task planning session ${message.sessionId}`);
  }

  const createDelegationAnalysisProvider = (analysisProviderId?: string) => {
    const resolvedProviderId = analysisProviderId || providerId;
    if (!resolvedProviderId) return undefined;

    const providerRow = db.prepare(`
      SELECT id, type, cli_path as cliPath, env
      FROM providers
      WHERE id = ?
    `).get(resolvedProviderId) as {
      id: string;
      type: string;
      cliPath: string | null;
      env: string | null;
    } | undefined;

    const resolvedType = providerRow?.type || providerConfig?.type;
    if (!resolvedType) return undefined;
    if (!supportsAIReviewCliJob(resolvedType)) return undefined;
    console.log(
      `[AI Review] Using analysis provider id=${resolvedProviderId} type=${resolvedType}${providerRow?.cliPath ? ` cli=${providerRow.cliPath}` : ''}`
    );

    return {
      runPrompt: async (prompt: string, sessionId?: string): Promise<{ response: string; sessionId?: string }> => {
        const result = await runAIReviewCliJob(resolvedType, {
          prompt,
          cwd,
          cliPath: providerRow?.cliPath || providerConfig?.cliPath,
          env: {
            ...(providerConfig?.env || {}),
            ...parseProviderEnv(providerRow?.env ?? null, resolvedProviderId),
          },
          model: message.model,
          systemPrompt: aiReviewSystemPrompt,
          timeoutMs: 120000,
        });

        return {
          response: JSON.stringify({
            type: 'final',
            decision: result.decision,
            reasoning: result.reasoning,
            confidence: result.confidence,
          }),
          sessionId: undefined,
        };
      },
    };
  };

  activeRun.aiReviewQueue = new AIReviewQueue({
    createProvider: (analysisProviderId) => createDelegationAnalysisProvider(analysisProviderId),
    cwd,
  });

  const permissionCallback = createPermissionCallback({
    activeRun,
    cwd,
    db,
    forcedPlanBySession,
    markPendingResolutionResumed,
    message: {
      sessionId: message.sessionId,
      permissionOverride: message.permissionOverride,
    },
    modeValue,
    notificationService,
    onAIReviewResolved,
    providerType,
    runId,
    sendRunEvent,
    session: {
      project_id: session.project_id,
    },
    sessionType,
  });

  return {
    forcedPlanBySession,
    modeValue,
    permissionCallback,
    processedInput,
  };
}
