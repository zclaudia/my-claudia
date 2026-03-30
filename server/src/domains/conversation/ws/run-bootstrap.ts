import { v4 as uuidv4 } from 'uuid';
import type { ErrorMessage, ProviderConfig, ServerMessage } from '@my-claudia/shared';
import { sendMessage, broadcastToOtherAuthenticatedClients } from './broadcast.js';
import type { ActiveRun, ConnectedClient } from './types.js';
import { getNextOffset } from './run-lifecycle.js';
import {
  loadProjectAllowedOutsideWorkspaceRoots,
  loadSessionRememberedDecisions,
} from '../agent/permission-evaluator.js';
import { normalizeSessionWorkingDirectory } from '../../../helpers/server-utils.js';
import { resolveProviderCwd } from '../../../utils/provider-cwd.js';
import { getGatewayClient } from '../../../domains/gateway/gateway-instance.js';
import type { initDatabase } from '../../../storage/db.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';

export interface RunStartMessage extends Record<string, unknown> {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  providerId?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  mode?: string;
  model?: string;
  permissionOverride?: Partial<import('@my-claudia/shared').AgentPermissionPolicy>;
  systemContext?: string;
  workingDirectory?: string;
  resend?: boolean;
}

export interface RunSessionRecord {
  id: string;
  project_id: string;
  name: string | null;
  sdk_session_id: string | null;
  session_type: 'regular' | 'background' | 'agent' | null;
  working_directory: string | null;
  project_role: string | null;
  plan_status: string | null;
  task_id: string | null;
  root_path: string | null;
  provider_id: string | null;
  system_prompt: string | null;
}

export interface RunProviderEventState {
  sdkSessionId?: string;
}

interface InitializeRunBootstrapInput {
  activeRuns: Map<string, ActiveRun>;
  client: ConnectedClient;
  clients?: Map<string, ConnectedClient>;
  db: ReturnType<typeof initDatabase>;
  message: RunStartMessage;
  runId: string;
  trace: TraceRecorder;
}

export interface RunBootstrapResult {
  activeRun: ActiveRun;
  broadcastSessionCatalogUpdate: () => void;
  connectedClients: Map<string, ConnectedClient>;
  cwd: string;
  markPendingResolutionResumed: () => void;
  persistSessionWorkingDirectory: (nextWorkingDirectory: string | null | undefined) => void;
  projectId: string;
  providerConfig?: ProviderConfig;
  providerEventState: RunProviderEventState;
  providerId: string | null;
  requestedCwd: string;
  sendRunEvent: (event: ServerMessage) => void;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  userMessageId?: string;
}

export function initializeRunBootstrap(input: InitializeRunBootstrapInput): RunBootstrapResult | null {
  const { activeRuns, client, clients, db, message, runId, trace } = input;
  const connectedClients = clients ?? new Map<string, ConnectedClient>();

  const session = db.prepare(`
    SELECT s.id, s.project_id, s.name, s.sdk_session_id, s.type as session_type,
           s.working_directory, s.project_role, s.plan_status, s.task_id,
           p.root_path, COALESCE(s.provider_id, p.provider_id) as provider_id, p.system_prompt
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(message.sessionId) as RunSessionRecord | undefined;

  if (!session) {
    trace.log('server_norm', 'run_start_rejected', { reason: 'SESSION_NOT_FOUND' }, 'session not found');
    sendMessage(client.ws, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found',
    } as ErrorMessage);
    return null;
  }

  const existingRunId = (() => {
    for (const [id, run] of activeRuns.entries()) {
      if (run.sessionId === message.sessionId && !run.completed) return id;
    }
    return null;
  })();
  if (existingRunId) {
    trace.log('server_norm', 'run_start_rejected', { reason: 'SESSION_BUSY', existingRunId }, 'session busy');
    sendMessage(client.ws, {
      type: 'error',
      code: 'SESSION_BUSY',
      message: `Session is already running (runId: ${existingRunId})`,
    } as ErrorMessage);
    return null;
  }

  const explicitProviderId = message.providerId || session.provider_id;
  const providerId = explicitProviderId || (() => {
    const defaultRow = db.prepare(`SELECT id FROM providers WHERE is_default = 1 LIMIT 1`).get() as { id: string } | undefined;
    return defaultRow?.id || null;
  })();

  let providerConfig: ProviderConfig | undefined;
  if (providerId) {
    const providerRow = db.prepare(`
      SELECT id, name, type, cli_path as cliPath, env, is_default as isDefault,
             created_at as createdAt, updated_at as updatedAt
      FROM providers WHERE id = ?
    `).get(providerId) as {
      id: string;
      name: string;
      type: string;
      cliPath: string | null;
      env: string | null;
      isDefault: number;
      createdAt: number;
      updatedAt: number;
    } | undefined;

    if (providerRow) {
      providerConfig = {
        id: providerRow.id,
        name: providerRow.name,
        type: providerRow.type as ProviderConfig['type'],
        cliPath: providerRow.cliPath || undefined,
        env: providerRow.env ? JSON.parse(providerRow.env) : undefined,
        isDefault: providerRow.isDefault === 1,
        createdAt: providerRow.createdAt,
        updatedAt: providerRow.updatedAt,
      };
      trace.setMeta({ provider: providerConfig.type });
    }
  }

  const sessionType = (session.session_type || 'regular') as 'regular' | 'background' | 'agent';
  const projectId = session.project_id || message.sessionId;
  const requestedCwd = message.workingDirectory
    || session.working_directory
    || session.root_path
    || process.cwd();
  const cwd = resolveProviderCwd({
    providerType: providerConfig?.type || 'claude',
    sdkSessionId: session.sdk_session_id || undefined,
    requestedCwd,
    sessionRootPath: session.root_path,
    persistedWorkingDirectory: session.working_directory,
  });

  const activeRun: ActiveRun = {
    runId,
    clientId: client.id,
    client,
    pendingPermissions: new Map(),
    db,
    sessionId: message.sessionId,
    projectId,
    assistantMessageId: uuidv4(),
    fullContent: '',
    collectedToolCalls: [],
    contentBlocks: [],
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentToolCalls: [],
    loopHeartbeatStreak: 0,
    sessionType,
    workspaceRoot: cwd,
    rememberedDecisions: loadSessionRememberedDecisions(db, message.sessionId),
    allowedOutsideWorkspaceRoots: loadProjectAllowedOutsideWorkspaceRoots(db, projectId),
    aiInitiatedPlanMode: false,
    eventSeq: 0,
  };
  activeRuns.set(runId, activeRun);

  db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
    .run('running', Date.now(), message.sessionId);

  let userMessageId: string | undefined;
  if (!message.resend) {
    userMessageId = uuidv4();
    const userOffset = getNextOffset(db, message.sessionId);
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at, offset)
      VALUES (?, ?, 'user', ?, ?, ?)
    `).run(userMessageId, message.sessionId, message.input, Date.now(), userOffset);
  }

  const sendRunEvent = (event: ServerMessage) => {
    if ('runId' in event) {
      activeRun.eventSeq += 1;
      (event as ServerMessage & { seq?: number }).seq = activeRun.eventSeq;
    }
    trace.log('server_norm', event.type, event);
    sendMessage(client.ws, event);
    if (clients) broadcastToOtherAuthenticatedClients(clients, client.id, event);
  };

  const providerEventState: RunProviderEventState = {
    sdkSessionId: session.sdk_session_id || undefined,
  };

  let persistedWorkingDirectory = normalizeSessionWorkingDirectory(session.working_directory, session.root_path);
  trace.setMeta({
    provider: providerConfig?.type,
    cwd: message.workingDirectory || persistedWorkingDirectory || session.root_path || undefined,
  });

  const persistSessionWorkingDirectory = (nextWorkingDirectory: string | null | undefined) => {
    const normalizedNext = normalizeSessionWorkingDirectory(nextWorkingDirectory, session.root_path);
    if (normalizedNext === persistedWorkingDirectory) return;

    const now = Date.now();
    db.prepare(`
      UPDATE sessions
      SET working_directory = ?, updated_at = ?
      WHERE id = ?
    `).run(normalizedNext, now, message.sessionId);

    persistedWorkingDirectory = normalizedNext;

    const gatewayClient = getGatewayClient();
    if (!gatewayClient) return;

    const updatedSession = db.prepare(`
      SELECT s.id, s.project_id as projectId, s.name, s.provider_id as providerId,
             s.sdk_session_id as sdkSessionId, s.type, s.parent_session_id as parentSessionId,
             s.working_directory as workingDirectory,
             s.archived_at as archivedAt,
             s.project_role as projectRole, s.task_id as taskId,
             s.plan_status as planStatus,
             s.last_run_status as lastRunStatus,
             CASE WHEN s.is_read_only = 1 THEN 1 ELSE NULL END as isReadOnly,
             s.created_at as createdAt, s.updated_at as updatedAt
      FROM sessions s
      WHERE s.id = ?
    `).get(message.sessionId) as { id: string; name?: string; createdAt?: number; updatedAt?: number } | undefined;

    if (updatedSession) {
      gatewayClient.commands.catalog.broadcastSessionEvent('updated', updatedSession);
    }
  };

  const broadcastSessionCatalogUpdate = () => {
    const gatewayClient = getGatewayClient();
    if (!gatewayClient) return;

    const updatedSession = db.prepare(`
      SELECT s.id, s.name, s.updated_at as updatedAt, s.archived_at as archivedAt
      FROM sessions s
      WHERE s.id = ?
    `).get(message.sessionId) as {
      id: string;
      name?: string;
      updatedAt?: number;
      archivedAt?: number | null;
    } | undefined;

    if (updatedSession) {
      gatewayClient.commands.catalog.broadcastSessionEvent('updated', updatedSession);
    }
  };

  const markPendingResolutionResumed = () => {
    db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
      .run('running', Date.now(), activeRun.sessionId);

    if (sessionType === 'background') {
      sendMessage(client.ws, {
        type: 'background_task_update',
        sessionId: message.sessionId,
        status: 'running',
      } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
    }
  };

  return {
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
  };
}
