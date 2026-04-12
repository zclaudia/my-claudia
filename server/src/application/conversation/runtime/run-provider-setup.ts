import { processAtMentions } from '../../../utils/server-utils.js';
import { createPermissionCallback } from './run-permissions.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import type { ProviderConfig } from '@my-claudia/shared/core/provider';
import type { PermissionBridge } from '../agent/permission-bridge.js';

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
  notificationService: NotificationSender;
  providerConfig?: ProviderConfig;
  providerId: string | null;
  providerType: string;
  runId: string;
  sendMessage: (ws: ConnectedClient['ws'], message: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  markPendingResolutionResumed: () => void;
  permissionBridge?: PermissionBridge;
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
    client,
    broadcastToOtherAuthenticatedClients,
    connectedClients,
    cwd,
    db,
    markPendingResolutionResumed,
    message,
    notificationService,
    providerType,
    runId,
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
    providerType,
    runId,
    sendRunEvent,
    session: {
      project_id: session.project_id,
    },
    sessionType,
    permissionBridge: input.permissionBridge!,
  });

  return {
    forcedPlanBySession,
    modeValue,
    permissionCallback,
    processedInput,
  };
}
