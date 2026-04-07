import type { ClaudeMessage } from '../../../providers/types.js';
import type { ProviderRegistryPort } from '../../../providers/registry.js';
import type { PushNotificationService } from '../../../infrastructure/push/push-notification-service.js';
import { summarizeProviderMessage, type TraceRecorder } from '../../../utils/provider-trace.js';
import type { ActiveRun } from './types.js';
import { handleProviderEvent, type ProviderEventState } from './run-events.js';

interface ConsumeProviderStreamInput {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  client: ActiveRun['client'];
  cwd: string;
  db: ActiveRun['db'];
  input: string;
  modeValue: string;
  notificationService: PushNotificationService;
  persistSessionWorkingDirectory: (nextWorkingDirectory: string | null | undefined) => void;
  providerRunner: AsyncIterable<ClaudeMessage>;
  providerType: string;
  runId: string;
  sendRunEvent: (event: import('@my-claudia/shared').ServerMessage) => void;
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
    cwd,
    db,
    input: userInput,
    modeValue,
    notificationService,
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

  for await (const msg of providerRunner) {
    trace.log(
      'server_provider',
      msg.type,
      msg,
      summarizeProviderMessage(msg as { type: string; [key: string]: unknown }),
    );
    if (!activeRuns.has(runId)) {
      break;
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

    if (msg.type === 'init') {
      if (msg.systemInfo?.cwd) {
        trace.setMeta({ cwd: msg.systemInfo.cwd || cwd });
      }
      if (msg.sessionId && msg.sessionId !== previousSdkSessionId) {
        trace.log('server_provider', 'provider_session_attached', { sdkSessionId: state.sdkSessionId }, `provider session ${msg.sessionId}`);
      }
    }
  }
}
