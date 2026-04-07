import { pluginEvents } from '../../../events/index.js';
import { negotiateProfile } from '../../../providers/pcp-negotiator.js';
import type { ClaudeMessage, ProviderAdapter } from '../../../providers/types.js';
import { buildRunContext } from './run-context.js';
import { upsertAssistantMessage } from './run-lifecycle.js';
import { PERIODIC_SAVE_INTERVAL_MS, type ActiveRun, type ConnectedClient } from './types.js';
import { sendMessage } from './broadcast.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';
import type { ProviderConfig } from '@my-claudia/shared/core/provider';

interface LaunchProviderRunInput {
  activeRun: ActiveRun;
  adapter: ProviderAdapter;
  broadcastSessionCatalogUpdate: () => void;
  client: ConnectedClient;
  cwd: string;
  db: ActiveRun['db'];
  forcedPlanBySession: boolean;
  message: RunStartMessage;
  modeValue: string;
  permissionCallback: (request: import('@my-claudia/shared/interaction/permissions').PermissionRequest) => Promise<import('../../../providers/claude-sdk.js').PermissionDecision>;
  processedInput: string;
  providerConfig?: ProviderConfig;
  providerId: string | null;
  providerType: string;
  runId: string;
  sdkSessionId?: string;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  serverPort: number | null;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  trace: TraceRecorder;
  userMessageId?: string;
}

export async function launchProviderRun(input: LaunchProviderRunInput): Promise<{
  providerRunner: AsyncIterable<ClaudeMessage>;
}> {
  const {
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
  } = input;

  if (adapter.manifest) {
    activeRun.effectiveProfile = negotiateProfile(adapter.manifest, {
      model: message.model,
      mode: modeValue,
      hasMcpBridge: !!serverPort,
      serverPort,
    });
    activeRun.effectiveProfile.sessionId = message.sessionId;
    trace.log('server_norm', 'profile_negotiated', {
      providerId: activeRun.effectiveProfile.providerId,
      capabilities: activeRun.effectiveProfile.capabilities
        .filter(c => c.enabled)
        .map(c => `${c.id}:${c.mode}/${c.reliability}`),
    }, 'PCP profile negotiated');
  }

  sendRunEvent({
    type: 'run_started',
    runId,
    sessionId: message.sessionId,
    clientRequestId: message.clientRequestId,
    userMessageId,
    assistantMessageId: activeRun.assistantMessageId,
    sessionType,
    effectiveProfile: activeRun.effectiveProfile,
  });
  broadcastSessionCatalogUpdate();

  pluginEvents.emit('run.started', {
    runId,
    sessionId: message.sessionId,
    input: message.input,
    providerId,
    providerType: providerConfig?.type,
  }).catch((err: unknown) => {
    console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err);
  });

  if (sessionType === 'background') {
    sendRunEvent({
      type: 'background_task_update',
      sessionId: message.sessionId,
      status: 'running',
    } as import('@my-claudia/shared/protocol/messages').BackgroundTaskUpdateMessage);
  }

  const { runOptions } = await buildRunContext({
    adapter,
    cwd,
    db,
    forcedPlanBySession,
    message,
    modeValue,
    providerConfig,
    providerType,
    sdkSessionId,
    serverPort,
    session,
    sessionType,
  });

  console.log(`[Run Debug] session=${message.sessionId} sdk_session=${sdkSessionId || 'NEW'} provider=${providerType} mode=${modeValue} model=${message.model || 'default'} cwd=${cwd} cliPath=${providerConfig?.cliPath || 'default'}`);
  trace.setMeta({ provider: providerType, cwd });
  trace.log('server_norm', 'provider_runner_created', {
    providerType,
    sdkSessionId,
    modeValue,
    model: message.model,
    cwd,
  }, `provider runner ${providerType}`);

  const providerRunner = adapter.run(processedInput, runOptions, permissionCallback);

  activeRun.providerType = providerType;
  const runState = adapter.getRunState?.(runOptions) || {};
  Object.assign(activeRun, runState);

  activeRun.saveInterval = setInterval(() => {
    try {
      upsertAssistantMessage(activeRun);
    } catch (err) {
      console.error(`[Periodic Save] Failed for run ${runId}:`, err);
    }
  }, PERIODIC_SAVE_INTERVAL_MS);

  return { providerRunner };
}
