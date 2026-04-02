import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { sendMessage, broadcastToOtherAuthenticatedClients } from './broadcast.js';
import type { ConnectedClient, ActiveRun } from './types.js';
import { cleanupPendingPermissions } from './run-lifecycle.js';
import { formatProviderErrorMessage, isHardQuotaExceededError } from '../../../helpers/server-utils.js';
import type { ProviderRegistryPort } from '../../../providers/registry.js';
import { createTraceRecorder } from '../../../utils/provider-trace.js';
import type { initDatabase } from '../../../storage/db.js';
import { NotificationService } from '../../notification-feed/notification-service.js';
import type { NotificationFeedService } from '../../notification-feed/service.js';
import { ProcessMonitor } from '../../../utils/process-monitor.js';
import { consumeProviderStream } from './consume-provider-stream.js';
import { initializeRunBootstrap, type RunStartMessage } from './run-bootstrap.js';
import { launchProviderRun } from './run-provider-launch.js';
import { prepareProviderRun } from './run-provider-setup.js';
import { finalizeRun, handleRunException } from './run-recovery.js';

const AI_REVIEW_SYSTEM_PROMPT = [
  'You are a machine-only security review helper for a coding assistant.',
  'Follow the user prompt exactly.',
  'Do not add markdown, commentary, prose, or code fences.',
  'Return only the JSON object requested by the prompt.',
].join(' ');

export interface RunHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  processMonitor: ProcessMonitor | null;
  notificationService: NotificationService;
  notificationFeedService?: NotificationFeedService;
  serverPort: number | null;
  broadcastHeartbeat: () => void;
  providerRegistry: ProviderRegistryPort;
}

type ExtendedAIReviewMetadata = import('@my-claudia/shared').AIReviewMetadata & {
  payloadDisposition?: 'safe_to_send' | 'send_with_redaction' | 'do_not_send';
  redactionCount?: number;
  reviewedFileCount?: number;
};

type ExtendedDelegationContext = import('@my-claudia/shared').NotificationItem['delegationContext'] & {
  payloadDisposition?: 'safe_to_send' | 'send_with_redaction' | 'do_not_send';
  redactionCount?: number;
  reviewedFileCount?: number;
};

function buildAIReviewFeedSummary(aiResult: import('@my-claudia/shared').AIReviewResult): string {
  const metadata = aiResult.metadata as ExtendedAIReviewMetadata | undefined;
  const base = aiResult.reasoning;
  if (metadata?.payloadDisposition === 'do_not_send') {
    return `${base} Remote analysis skipped because sensitive local material was detected.`;
  }
  if (metadata?.payloadDisposition !== 'send_with_redaction') return base;
  const reviewedFileCount = metadata.reviewedFileCount ?? 0;
  const redactionCount = metadata.redactionCount ?? 0;
  return `${base} Payload sanitized locally; redactions: ${redactionCount}; files reviewed: ${reviewedFileCount}.`;
}

function postAIReviewFeedItem(
  feedService: NotificationFeedService | undefined,
  input: {
    sessionId: string;
    projectId: string;
    requestId: string;
    toolName: string;
    detail: string;
    result: import('@my-claudia/shared').AIReviewResult;
  },
): void {
  if (!feedService) return;

  const feedDecision = input.result.decision === 'approve' ? 'approve' : 'deny';
  const status = input.result.decision === 'deny' ? 'failed' : 'completed';
  const title = input.result.decision === 'approve'
    ? `AI review approved ${input.toolName}`
    : input.result.decision === 'deny'
      ? `AI review denied ${input.toolName}`
      : `AI review needs user decision for ${input.toolName}`;
  const metadata = input.result.metadata as ExtendedAIReviewMetadata | undefined;

  feedService.postItem({
    sessionId: input.sessionId,
    projectId: input.projectId,
    source: 'delegation',
    title,
    summary: buildAIReviewFeedSummary(input.result),
    status,
    error: status === 'failed' ? input.result.reasoning : undefined,
    delegationContext: {
      originalRequestId: input.requestId,
      toolName: input.toolName,
      detail: input.detail,
      decision: feedDecision,
      reasoning: input.result.reasoning,
      confidence: input.result.confidence,
      payloadDisposition: metadata?.payloadDisposition,
      redactionCount: metadata?.redactionCount,
      reviewedFileCount: metadata?.reviewedFileCount,
    } as ExtendedDelegationContext,
    completedAt: Date.now(),
  });
}

export async function handleRunStart(
  client: ConnectedClient,
  message: RunStartMessage,
  db: ReturnType<typeof initDatabase>,
  recoveryState: { sessionResetRetryCount?: number } = {},
  clients?: Map<string, ConnectedClient>,
  ctx?: RunHandlerContext,
): Promise<void> {
  const activeRuns = ctx!.activeRuns;
  const processMonitor = ctx!.processMonitor;
  const notificationService = ctx!.notificationService;
  const notificationFeedService = ctx!.notificationFeedService;
  const serverPort = ctx!.serverPort;
  const broadcastHeartbeat = ctx!.broadcastHeartbeat;
  const runId = uuidv4();
  const trace = createTraceRecorder({
    runId,
    sessionId: message.sessionId,
    cwd: message.workingDirectory,
  });
  trace.log('server_norm', 'run_start_requested', {
    clientRequestId: message.clientRequestId,
    sessionId: message.sessionId,
    providerId: message.providerId,
    mode: message.mode,
    model: message.model,
    workingDirectory: message.workingDirectory,
    resend: message.resend,
  }, 'run_start requested');
  const bootstrap = initializeRunBootstrap({
    activeRuns,
    client,
    clients,
    db,
    message,
    runId,
    trace,
  });
  if (!bootstrap) return;

  const {
    activeRun,
    broadcastSessionCatalogUpdate,
    connectedClients,
    cwd,
    markPendingResolutionResumed,
    persistSessionWorkingDirectory,
    projectId,
    providerConfig,
    providerEventState,
    providerId,
    requestedCwd,
    sendRunEvent,
    session,
    sessionType,
    userMessageId,
  } = bootstrap;

  const toolUseIdToName = new Map<string, string>();
  let sdkSessionId = providerEventState.sdkSessionId;
  let handedOffToRetry = false;

  try {
    const providerType = providerConfig?.type || 'claude';
    const adapter = ctx!.providerRegistry.getOrDefault(providerType);

    // Kimi stores session state under the work_dir scope. Resuming the same
    // session ID under a different directory creates a fresh empty context,
    // which makes follow-up turns look "interrupted". Keep resumed Kimi runs
    // pinned to the session root directory.
    // Validate cwd exists — spawn() fails with cryptic ENOENT if cwd is invalid
    if (!fs.existsSync(cwd)) {
      console.warn(`[Run] cwd does not exist: ${cwd}`);
      sendRunEvent({
        type: 'run_failed',
        runId,
        sessionId: activeRun.sessionId,
        error: `Project path does not exist: ${cwd}`
      });
      activeRun.completed = true;
      broadcastHeartbeat();
      activeRun.aiReviewQueue?.cancelAll();
      cleanupPendingPermissions(activeRun, 'Project path does not exist');
      activeRuns.delete(runId);
      return;
    }

    if (providerType === 'kimi' && sdkSessionId && cwd !== requestedCwd) {
      console.log(`[Kimi] Resuming session ${sdkSessionId} with stable work dir ${cwd} (requested ${requestedCwd})`);
    } else {
      persistSessionWorkingDirectory(cwd);
    }

    const {
      forcedPlanBySession,
      modeValue,
      permissionCallback,
      processedInput,
    } = prepareProviderRun({
      activeRun,
      aiReviewSystemPrompt: AI_REVIEW_SYSTEM_PROMPT,
      broadcastToOtherAuthenticatedClients,
      client,
      connectedClients,
      cwd,
      db,
      markPendingResolutionResumed,
      message,
      notificationService,
      onAIReviewResolved: ({ requestId, toolName, detail, result }) => {
        postAIReviewFeedItem(notificationFeedService, {
          sessionId: message.sessionId,
          projectId: session.project_id,
          requestId,
          toolName,
          detail,
          result,
        });
      },
      providerConfig,
      providerId,
      providerType,
      runId,
      sendMessage,
      sendRunEvent,
      session,
      sessionType,
    });

    const { providerRunner } = await launchProviderRun({
      activeRun,
      adapter,
      broadcastSessionCatalogUpdate,
      client,
      cwd,
      db,
      forcedPlanBySession,
      message,
      modeValue,
      permissionCallback,
      processedInput,
      providerConfig,
      providerId,
      providerType,
      runId,
      sdkSessionId,
      sendRunEvent,
      serverPort,
      session,
      sessionType,
      trace,
      userMessageId,
    });

    await consumeProviderStream({
      activeRun,
      activeRuns,
      broadcastHeartbeat,
      client,
      cwd,
      db,
      input: message.input,
      modeValue,
      notificationService,
      persistSessionWorkingDirectory,
      providerRegistry: ctx!.providerRegistry,
      providerRunner,
      providerType,
      runId,
      sendRunEvent,
      sessionId: message.sessionId,
      sessionType,
      state: providerEventState,
      toolUseIdToName,
      trace,
    });
    sdkSessionId = providerEventState.sdkSessionId;
  } catch (error) {
    const recoveryResult = await handleRunException({
      activeRun,
      activeRuns,
      broadcastHeartbeat,
      client,
      ctx,
      db,
      error,
      formatProviderErrorMessage,
      handleRetry: async () => {
        await handleRunStart(
          client,
          { ...message, resend: true },
          db,
          { sessionResetRetryCount: (recoveryState.sessionResetRetryCount || 0) + 1 },
          clients,
          ctx,
        );
      },
      isHardQuotaExceededError,
      message,
      notificationService,
      processMonitor,
      recoveryState,
      runId,
      sdkSessionId,
      sendRunEvent,
      sessionType,
      trace,
    });
    handedOffToRetry = recoveryResult.handedOffToRetry;
  } finally {
    finalizeRun({
      activeRun,
      activeRuns,
      broadcastHeartbeat,
      handedOffToRetry,
      message,
      processMonitor,
      trace,
      runId,
    });
  }
}
