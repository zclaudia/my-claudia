import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { sendMessage, broadcastToOtherAuthenticatedClients } from '../transport/broadcast.js';
import type { ConnectedClient, ActiveRun } from '../transport/types.js';
import { cleanupPendingPermissions } from './run-lifecycle.js';
import type { SessionSyncPort } from '../../../application/conversation/session-sync-port.js';
import { formatProviderErrorMessage, isHardQuotaExceededError } from '../../../utils/server-utils.js';
import type { ProviderRegistryPort } from '../../../infrastructure/providers/registry.js';
import { createTraceRecorder } from '../../../utils/provider-trace.js';
import type { initDatabase } from '../../../infrastructure/storage/db.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import { ProcessMonitor } from '../../../utils/process-monitor.js';
import { consumeProviderStream } from './consume-provider-stream.js';
import { initializeRunBootstrap, type RunStartMessage } from './run-bootstrap.js';
import { launchProviderRun } from './run-provider-launch.js';
import { prepareProviderRun } from './run-provider-setup.js';
import { finalizeRun, handleRunException } from './run-recovery.js';

export interface RunHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  processMonitor: ProcessMonitor | null;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  serverPort: number | null;
  broadcastHeartbeat: () => void;
  sessionSync?: SessionSyncPort;
  providerRegistry: ProviderRegistryPort;
  permissionBridge?: import('../agent/permission-bridge.js').PermissionBridge;
  permissionWorkflowResolver?: import('../../../domains/workflows/index.js').PermissionWorkflowResolver;
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
  const notificationsService = ctx!.notificationsService;
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
      sessionSync: ctx!.sessionSync,
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
      cleanupPendingPermissions(activeRun, 'Project path does not exist');
      activeRuns.delete(runId);
      return;
    }

    // When the manifest says the provider pins cwd on resume, we logged the
    // override and must NOT persist the requested cwd back over it; otherwise
    // we trust the caller's cwd and persist it as the session's new root.
    const cwdPinned = sdkSessionId && cwd !== requestedCwd;
    if (cwdPinned) {
      console.log(`[Run] Resuming session ${sdkSessionId} with pinned work dir ${cwd} (requested ${requestedCwd}, provider=${providerType})`);
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
      broadcastToOtherAuthenticatedClients,
      client,
      connectedClients,
      cwd,
      db,
      markPendingResolutionResumed,
      message,
      notificationService,
      providerConfig,
      providerId,
      providerType,
      runId,
      sendMessage,
      sendRunEvent,
      session,
      sessionType,
      permissionBridge: ctx?.permissionBridge,
      permissionWorkflowResolver: ctx?.permissionWorkflowResolver,
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
      notificationsService,
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
      providerRegistry: ctx!.providerRegistry,
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
      notificationsService,
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
      sessionSync: ctx!.sessionSync,
      trace,
      runId,
    });
  }
}
