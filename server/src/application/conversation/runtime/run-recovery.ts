import { cleanupPendingPermissions, upsertAssistantMessage } from './run-lifecycle.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import type { ActiveRun } from '../transport/types.js';
import type { SessionSyncPort } from '../../../application/conversation/session-sync-port.js';
import type { ProcessMonitor } from '../../../utils/process-monitor.js';
import type { ConnectedClient } from '../transport/types.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import { broadcastRunMessage, sendMessage } from '../transport/broadcast.js';
import { MAX_SESSION_RESET_RETRIES } from '../transport/types.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import { postRunFailedNotification } from './run-terminal-notifications.js';

interface HandleRunExceptionInput {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  client: ConnectedClient;
  ctx: unknown;
  db: ActiveRun['db'];
  error: unknown;
  formatProviderErrorMessage: (
    message: string,
    providerType?: string,
    authErrorHint?: { matchAny: Array<string | string[]>; message: string },
  ) => string;
  providerRegistry?: { get(type: string): { manifest?: { authErrorHint?: { matchAny: Array<string | string[]>; message: string } } } | undefined };
  handleRetry: () => Promise<void>;
  isHardQuotaExceededError: (message: string) => boolean;
  message: {
    sessionId: string;
  } & Record<string, unknown>;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  processMonitor: ProcessMonitor | null;
  recoveryState: { sessionResetRetryCount?: number };
  runId: string;
  sdkSessionId?: string;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
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
    notificationsService,
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
  const authHint = activeRun.providerType
    ? input.providerRegistry?.get(activeRun.providerType)?.manifest?.authErrorHint
    : undefined;
  const formattedErrMsg = formatProviderErrorMessage(errMsg, activeRun.providerType, authHint);
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
  postRunFailedNotification({
    db: input.db,
    sessionId: message.sessionId,
    error: formattedErrMsg,
    notificationSender: notificationService,
    notificationsService,
  });

  if (sessionType === 'background') {
    broadcastRunMessage(activeRun, {
      type: 'background_task_update',
      sessionId: message.sessionId,
      status: 'failed',
      reason: formattedErrMsg,
    } as import('@my-claudia/shared/protocol/messages').BackgroundTaskUpdateMessage);
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
