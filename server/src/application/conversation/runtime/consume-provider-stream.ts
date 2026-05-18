import type { ClaudeMessage } from '../../../infrastructure/providers/types.js';
import type { ProviderRegistryPort } from '../../../infrastructure/providers/registry.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import { summarizeProviderMessage, type TraceRecorder } from '../../../utils/provider-trace.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import { handleProviderEvent, type ProviderEventState } from './run-events.js';
import { postRunCompletedNotification } from './run-terminal-notifications.js';
import { spawnBackgroundFollowUpConsumer } from './background-follow-up.js';

interface ConsumeProviderStreamInput {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  client: ActiveRun['client'];
  connectedClients: Map<string, ConnectedClient>;
  cwd: string;
  db: ActiveRun['db'];
  input: string;
  modeValue: string;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  persistSessionWorkingDirectory: (nextWorkingDirectory: string | null | undefined) => void;
  providerRunner: AsyncIterable<ClaudeMessage>;
  providerType: string;
  runId: string;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  sessionId: string;
  sessionType: ActiveRun['sessionType'];
  state: ProviderEventState;
  toolUseIdToName: Map<string, string>;
  trace: TraceRecorder;
  providerRegistry: ProviderRegistryPort;
}

export async function consumeProviderStream(input: ConsumeProviderStreamInput): Promise<void> {
  const {
    activeRun,
    activeRuns,
    broadcastHeartbeat,
    client,
    connectedClients,
    cwd,
    db,
    input: userInput,
    modeValue,
    notificationService,
    notificationsService,
    persistSessionWorkingDirectory,
    providerRunner,
    providerRegistry,
    providerType,
    runId,
    sendRunEvent,
    sessionId,
    sessionType,
    state,
    toolUseIdToName,
    trace,
  } = input;

  // Use manual iteration instead of for-await-of. Breaking out of a
  // for-await loop calls iterator.return() which closes the generator and
  // kills the underlying CLI subprocess. With manual iteration we can hand
  // off the still-open iterator to a background consumer when there are
  // in-flight background tasks.
  const iterator = providerRunner[Symbol.asyncIterator]();

  try {
    while (true) {
      const iterResult = await iterator.next();
      if (iterResult.done) break;
      const msg = iterResult.value;

      trace.log(
        'server_provider',
        msg.type,
        msg,
        summarizeProviderMessage(msg as { type: string; [key: string]: unknown }),
      );
      if (!activeRuns.has(runId)) {
        await iterator.return?.();
        return;
      }

      activeRun.lastActivityAt = Date.now();
      const previousSdkSessionId = state.sdkSessionId;

      handleProviderEvent({
        activeRun,
        activeRuns,
        broadcastHeartbeat,
        client,
        db,
        input: userInput,
        modeValue,
        msg,
        notificationService,
        notificationsService,
        persistSessionWorkingDirectory,
        providerRegistry,
        providerType,
        runId,
        sendRunEvent,
        sessionId,
        sessionType,
        state,
        toolUseIdToName,
      });

      // Once the run is marked completed, decide whether to stop or hand off.
      if (activeRun.completed) {
        if (activeRun.pendingBackgroundTasks > 0) {
          // Hand off the iterator to a detached background consumer.
          // The main run ends normally (finalizeRun will clean it up).
          // The follow-up turn will be handled as a brand-new run.
          console.log(
            `[Stream] Run ${runId} completed with ${activeRun.pendingBackgroundTasks} pending background task(s), ` +
            `handing off stream to background consumer`,
          );
          spawnBackgroundFollowUpConsumer(iterator, {
            activeRuns,
            broadcastHeartbeat,
            client,
            connectedClients,
            db,
            sessionId,
            projectId: activeRun.projectId,
            providerType,
            providerRegistry,
            notificationService,
            notificationsService,
            initialPendingTasks: activeRun.pendingBackgroundTasks,
            workspaceRoot: activeRun.workspaceRoot,
          });
          // Return without closing the iterator — background consumer owns it now
          return;
        }
        // Normal completion — close the iterator and return
        await iterator.return?.();
        return;
      }

      if (msg.type === 'init') {
        if (msg.systemInfo?.cwd) {
          trace.setMeta({ cwd: msg.systemInfo.cwd || cwd });
        }
        if (msg.sessionId && msg.sessionId !== previousSdkSessionId) {
          trace.log('server_provider', 'provider_session_attached', { sdkSessionId: state.sdkSessionId }, `provider session ${msg.sessionId}`);
        }
      }
    }
  } catch (err) {
    await iterator.return?.();
    throw err;
  }

  // If the provider stream ended without emitting a result/error event,
  // the frontend never receives run_completed/run_failed and gets stuck in
  // a permanent loading state.  Emit a synthetic run_completed so the client
  // can move on.
  if (!activeRun.completed) {
    trace.log('server_norm', 'stream_ended_without_result', { runId, providerType }, 'provider stream ended without result event');
    sendRunEvent({
      type: 'run_completed',
      runId,
      sessionId,
    });
    activeRun.completed = true;
    broadcastHeartbeat();
    postRunCompletedNotification({
      db,
      sessionId,
      notificationSender: notificationService,
      notificationsService,
    });
  }
}
