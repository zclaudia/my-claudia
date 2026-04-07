import { cleanupPendingPermissions, upsertAssistantMessage } from './run-lifecycle.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import type { ActiveRun } from './types.js';
import type { SessionSyncPort } from '../../../application/conversation/session-sync-port.js';
import type { ProcessMonitor } from '../../../utils/process-monitor.js';
import type { ConnectedClient } from './types.js';
import type { PushNotificationService } from '../../../infrastructure/push/push-notification-service.js';
import { broadcastRunMessage, sendMessage } from './broadcast.js';
import { MAX_SESSION_RESET_RETRIES } from './types.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';

interface HandleRunExceptionInput {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  client: ConnectedClient;
  ctx: unknown;
  db: ActiveRun['db'];
  error: unknown;
  formatProviderErrorMessage: (message: string, providerType?: string) => string;
  handleRetry: () => Promise<void>;
  isHardQuotaExceededError: (message: string) => boolean;
  message: {
    sessionId: string;
  } & Record<string, unknown>;
  notificationService: PushNotificationService;
  processMonitor: ProcessMonitor | null;
  recoveryState: { sessionResetRetryCount?: number };
  runId: string;
  sdkSessionId?: string;
  sendRunEvent: (event: import('@my-claudia/shared').ServerMessage) => void;
  sessionType: 'regular' | 'background' | 'agent';
  trace: TraceRecorder;
}

export async function handleRunException(input: HandleRunExceptionInput): Promise<{ handedOffToRetry: boolean }> {
  const {
    activeRun,
    activeRuns,
    broadcastHeartbeat,
    error,
    formatProviderErrorMessage,
    handleRetry,
    isHardQuotaExceededError,
    message,
    notificationService,
    processMonitor: _processMonitor,
    recoveryState,
    runId,
    sdkSessionId,
    sendRunEvent,
    sessionType,
    trace,
  } = input;

  console.error('Run error:', error);
  trace.log('server_norm', 'run_exception', error, 'handleRunStart exception');

  const errMsg = error instanceof Error ? error.message : '';
  const formattedErrMsg = formatProviderErrorMessage(errMsg, activeRun.providerType);
  const sessionResetRetryCount = recoveryState.sessionResetRetryCount || 0;

  if (
    errMsg.includes('process exited with code')
    && sdkSessionId
    && sessionResetRetryCount < MAX_SESSION_RESET_RETRIES
    && !isHardQuotaExceededError(errMsg)
  ) {
    console.log(`[Recovery] Auto-resetting corrupted sdk_session_id ${sdkSessionId} for session ${message.sessionId}`);
    input.db.prepare('UPDATE sessions SET sdk_session_id = NULL, updated_at = ? WHERE id = ?')
      .run(Date.now(), message.sessionId);

    sendRunEvent({
      type: 'delta',
      runId,
      sessionId: activeRun.sessionId,
      content: `⚠️ Claude session crashed (corrupted underlying session \`${sdkSessionId.slice(0, 8)}…\`). Resetting session and retrying automatically…`,
    });

    if (activeRun.saveInterval) {
      clearInterval(activeRun.saveInterval);
      activeRun.saveInterval = undefined;
    }
    activeRun.aiReviewQueue?.cancelAll();
    cleanupPendingPermissions(activeRun, 'Session reset retry');
    activeRuns.delete(runId);
    broadcastHeartbeat();

    try {
      await handleRetry();
      return { handedOffToRetry: true };
    } catch (retryError) {
      console.error('[Recovery] Auto-retry after session reset also failed:', retryError);
    }
  }

  try {
    upsertAssistantMessage(activeRun, { indexMetadata: true });
  } catch (saveErr) {
    console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
  }
  sendRunEvent({
    type: 'run_failed',
    runId,
    sessionId: activeRun.sessionId,
    error: formattedErrMsg,
  });
  activeRun.completed = true;
  broadcastHeartbeat();
  notificationService.notify({
    type: 'run_failed',
    title: 'Run failed',
    body: formattedErrMsg.slice(0, 200),
    priority: 'high',
    tags: ['x'],
  });

  if (sessionType === 'background') {
    broadcastRunMessage(activeRun, {
      type: 'background_task_update',
      sessionId: message.sessionId,
      status: 'failed',
      reason: formattedErrMsg,
    } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
  }

  return { handedOffToRetry: false };
}

interface FinalizeRunInput {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  handedOffToRetry: boolean;
  message: { sessionId: string };
  processMonitor: ProcessMonitor | null;
  sessionSync?: SessionSyncPort;
  trace: TraceRecorder;
  runId: string;
}

export function finalizeRun(input: FinalizeRunInput): void {
  const {
    activeRun,
    activeRuns,
    broadcastHeartbeat,
    handedOffToRetry,
    message,
    processMonitor,
    sessionSync,
    runId,
    trace,
  } = input;

  trace.log('server_norm', 'run_finalized', {
    runId,
    sessionId: message.sessionId,
    completed: activeRun.completed === true,
    providerType: activeRun.providerType,
    contentChars: activeRun.fullContent.length,
    collectedToolCalls: activeRun.collectedToolCalls.length,
  }, 'run finalized');

  if (activeRun.saveInterval) {
    clearInterval(activeRun.saveInterval);
    activeRun.saveInterval = undefined;
  }

  if (handedOffToRetry) {
    return;
  }

  cleanupPendingPermissions(activeRun);
  interactionDispatcher.cancelBySession(activeRun.sessionId);
  activeRuns.delete(runId);
  broadcastHeartbeat();

  sessionSync?.broadcastSessionUpdated(message.sessionId, activeRun.db);

  if (processMonitor && activeRuns.size === 0) {
    setTimeout(() => processMonitor?.check(), 5_000);
  }

  activeRun.db.prepare(`
      UPDATE sessions SET last_run_status = NULL, updated_at = ? WHERE id = ?
    `).run(Date.now(), message.sessionId);
}
