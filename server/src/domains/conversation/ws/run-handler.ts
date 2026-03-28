import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import type {
  ClientMessage,
  ServerMessage,
  ErrorMessage,
  ProviderConfig,
  AgentPermissionPolicy,
  ToolCall,
  ContentBlock,
  AskUserQuestionItem,
} from '@my-claudia/shared';
import { DEFAULT_UNIFIED_POLICY } from '@my-claudia/shared';
import { sendMessage, broadcastToOtherAuthenticatedClients } from './broadcast.js';
import type { ConnectedClient, ActiveRun } from './types.js';
import {
  PERMISSION_TIMEOUT_POLICIES,
  MAX_SESSION_RESET_RETRIES,
  PERIODIC_SAVE_INTERVAL_MS,
} from './types.js';
import { getNextOffset, upsertAssistantMessage, findProcessPidsByTaskCommand } from './run-lifecycle.js';
import { getDiscoveredSkills, loadSkillContent } from '../../../plugins/skill-tools.js';
import { selectSkills } from '../../../plugins/skill-selector.js';
import {
  normalizeSessionWorkingDirectory,
  isSlashCommand,
  isSudoCommand,
  isBashLikeTool,
  providerSupportsNativePlanMode,
  buildNonNativePlanPrompt,
  buildPlanDocumentPrompt,
  processAtMentions,
  buildStatusOutput,
  formatProviderErrorMessage,
  isHardQuotaExceededError,
  SYSTEM_INFO_COMMANDS,
  buildFilePushContext,
} from '../../../helpers/server-utils.js';
import {
  classify,
  getMatchedPermissionRule,
  getOutsideWorkspacePaths,
  isInternalInteractionTool,
  PermissionEvaluator,
  isUnifiedPolicy,
  getAgentPermissionPolicy,
  getProjectPermissionOverride,
  isOutsideWorkspacePathAllowed,
  loadProjectAllowedOutsideWorkspaceRoots,
  mergePolicy,
  normalizePolicy,
  buildRememberKey,
  loadSessionRememberedDecisions,
  resolveRememberedDecision,
} from '../agent/permission-evaluator.js';
import { evaluateAIReview } from '../agent/delegation-evaluator.js';
import { AIReviewQueue } from '../agent/ai-review-queue.js';
import type { PermissionDecision, SystemInfo } from '../../../providers/claude-sdk.js';
import { providerRegistry } from '../../../providers/registry.js';
import { negotiateProfile } from '../../../providers/pcp-negotiator.js';
import { mapPermissionMode } from '../../../providers/pcp-permission.js';
import { createContextEngine } from '../context/engine.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import { normalizeFromToolUse, normalizeFromAskUser } from '../interactions/interaction-normalizer.js';
import { pluginEvents } from '../../../events/index.js';
import { workspaceService } from '../../../services/workspace.js';
import { buildSkillDirectoryHint } from '../../../plugins/skill-tools.js';
import { toolRegistry as pluginToolRegistry } from '../../../plugins/tool-registry.js';
import { resolveProviderCwd } from '../../../utils/provider-cwd.js';
import { createTraceRecorder, summarizeProviderMessage, summarizeServerMessage } from '../../../utils/provider-trace.js';
import { generateToolSignature, detectLoop } from '../../../loop-detection.js';
import { getGatewayClient } from '../../../domains/gateway/gateway-instance.js';
import { initDatabase } from '../../../storage/db.js';
import { NotificationService } from '../../notification-feed/notification-service.js';
import { ProcessMonitor } from '../../../utils/process-monitor.js';

export interface RunHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  processMonitor: ProcessMonitor | null;
  notificationService: NotificationService;
  serverPort: number | null;
  broadcastHeartbeat: () => void;
}

export async function handleRunStart(
  client: ConnectedClient,
  message: {
    type: 'run_start';
    clientRequestId: string;
    sessionId: string;
    input: string;
    providerId?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    mode?: string;   // Generic mode/agent ID (new unified field)
    model?: string;
    permissionOverride?: Partial<import('@my-claudia/shared').AgentPermissionPolicy>;
    systemContext?: string;
    workingDirectory?: string;  // Optional working directory override
    resend?: boolean;  // True when resending — skip inserting duplicate user message
  },
  db: ReturnType<typeof initDatabase>,
  recoveryState: { sessionResetRetryCount?: number } = {},
  clients?: Map<string, ConnectedClient>,
  ctx?: RunHandlerContext,
): Promise<void> {
  const activeRuns = ctx!.activeRuns;
  const processMonitor = ctx!.processMonitor;
  const notificationService = ctx!.notificationService;
  const serverPort = ctx!.serverPort;
  const broadcastHeartbeat = ctx!.broadcastHeartbeat;
  const connectedClients = clients ?? new Map<string, ConnectedClient>();

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

  // Get session info
  const session = db.prepare(`
    SELECT s.id, s.project_id, s.name, s.sdk_session_id, s.type as session_type,
           s.working_directory, s.project_role, s.plan_status, s.task_id,
           p.root_path, COALESCE(s.provider_id, p.provider_id) as provider_id, p.system_prompt
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(message.sessionId) as {
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
  } | undefined;

  if (!session) {
    trace.log('server_norm', 'run_start_rejected', { reason: 'SESSION_NOT_FOUND' }, 'session not found');
    sendMessage(client.ws, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found'
    } as ErrorMessage);
    return;
  }

  // Hard guard: never allow overlapping runs in the same session.
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
    return;
  }

  // Get provider config: message override → session → project → system default
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
        updatedAt: providerRow.updatedAt
      };
      trace.setMeta({ provider: providerConfig.type });
    }
  }

  // Session type
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

  // Create active run tracking (includes streaming state for message persistence)
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

  // Persist run status for crash recovery
  db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
    .run('running', Date.now(), message.sessionId);

  // Track tool_use_id to tool_name mapping for this run
  const toolUseIdToName = new Map<string, string>();

  // Save user message to database (before sending run_started so IDs are available)
  // Skip when resending — the user message already exists in the DB
  let userMessageId: string | undefined;
  if (!message.resend) {
    userMessageId = uuidv4();
    const userOffset = getNextOffset(db, message.sessionId);
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at, offset)
      VALUES (?, ?, 'user', ?, ?, ?)
    `).run(userMessageId, message.sessionId, message.input, Date.now(), userOffset);
  }

  // Send run started (include real DB message IDs for client-side dedup)
  const sendRunEvent = (event: ServerMessage) => {
    // Inject monotonically increasing seq for run-scoped events (for client-side dedup)
    if ('runId' in event) {
      activeRun.eventSeq += 1;
      (event as ServerMessage & { seq?: number }).seq = activeRun.eventSeq;
    }
    trace.log('server_norm', event.type, event, summarizeServerMessage(event as { type: string; [key: string]: unknown }));
    sendMessage(client.ws, event);
    if (clients) broadcastToOtherAuthenticatedClients(clients, client.id, event);
  };

  let sdkSessionId = session.sdk_session_id || undefined;
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

  try {
    const providerType = providerConfig?.type || 'claude';
    const adapter = providerRegistry.getOrDefault(providerType);

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
      activeRuns.delete(runId);
      return;
    }

    if (providerType === 'kimi' && sdkSessionId && cwd !== requestedCwd) {
      console.log(`[Kimi] Resuming session ${sdkSessionId} with stable work dir ${cwd} (requested ${requestedCwd})`);
    } else {
      persistSessionWorkingDirectory(cwd);
    }

    let systemInfo: SystemInfo | undefined;

    // Process @ mentions - convert file references to context hints
    const processedInput = processAtMentions(message.input, session.root_path);
    console.log('[@ Mention] Original input:', message.input);
    if (processedInput !== message.input) {
      console.log('[@ Mention] Processed input:', processedInput);
    }

    const forcedPlanBySession = session.project_role === 'task' && session.plan_status === 'planning';
    let modeValue = forcedPlanBySession
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

      const analysisAdapter = providerRegistry.get(resolvedType);
      if (!analysisAdapter) return undefined;

      return {
        runPrompt: async (prompt: string, sessionId?: string): Promise<{ response: string; sessionId?: string }> => {
          const collectedMessages: string[] = [];
          let capturedSessionId: string | undefined = sessionId;
          for await (const responseMessage of analysisAdapter.run(prompt, {
            cwd,
            sessionId,
            cliPath: providerRow?.cliPath || providerConfig?.cliPath,
            env: {
              ...(providerConfig?.env || {}),
              ...(providerRow?.env ? JSON.parse(providerRow.env) : {}),
            },
            model: message.model,
          }, async () => ({ decision: 'allow' as const, behavior: 'allow' as const }))) {
            const msg = responseMessage as {
              type: string;
              content?: string;
              result?: string;
              sessionId?: string;
            };
            // Capture sessionId from init message for session reuse
            if (msg.type === 'init' && msg.sessionId) {
              capturedSessionId = msg.sessionId;
            }
            if (msg.type === 'assistant' && msg.content) {
              collectedMessages.push(msg.content);
            } else if (msg.type === 'result' && msg.result) {
              collectedMessages.push(msg.result);
            }
          }

          return {
            response: collectedMessages.join('\n').trim(),
            sessionId: capturedSessionId,
          };
        },
      };
    };

    // Initialize AI review queue with provider factory + cwd
    activeRun.aiReviewQueue = new AIReviewQueue({
      createProvider: (analysisProviderId) => createDelegationAnalysisProvider(analysisProviderId),
      cwd,
    });

    // Permission request callback (shared by claude and opencode)
    // Unified: ALL sessions (including agent sessions) go through the strategy chain.
    const sessionPermissionOverride = message.permissionOverride;
    const permissionCallback = async (request: import('@my-claudia/shared').PermissionRequest) => {
      return new Promise<PermissionDecision>((resolve) => {
        // Strict plan guard is only for Supervisor-forced planning sessions.
        // Normal user-selected plan mode must still allow ExitPlanMode approval flow.
        if (forcedPlanBySession && modeValue === 'plan') {
          const planReadOnlyTools = new Set([
            'read', 'glob', 'grep', 'webfetch', 'websearch', 'todowrite', 'ls', 'askuserquestion',
          ]);
          const normalizedTool = request.toolName.toLowerCase();
          const isAllowedReadTool = planReadOnlyTools.has(normalizedTool);
          const shouldDeny = isBashLikeTool(request.toolName) || !isAllowedReadTool;
          if (shouldDeny) {
            const reason = `Denied by strict Plan Mode: ${request.toolName} is not allowed.`;
            sendMessage(client.ws, {
              type: 'agent_permission_intercepted',
              toolName: request.toolName,
              decision: 'deny',
              reason,
              sessionId: message.sessionId,
              runId,
            } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
            resolve({ behavior: 'deny', message: reason });
            return;
          }
        }

        // --- Check remembered decisions cache ---
        const rememberKey = buildRememberKey(request.toolName, request.toolInput, request.detail);
        const remembered = resolveRememberedDecision(
          activeRun.rememberedDecisions,
          request.toolName,
          request.toolInput,
          request.detail
        );
        if (remembered) {
          sendMessage(client.ws, {
            type: 'agent_permission_intercepted',
            toolName: request.toolName,
            decision: remembered === 'allow' ? 'approve' : 'deny',
            reason: `Remembered decision (${remembered}) for "${rememberKey}"`,
            sessionId: message.sessionId,
            runId,
          } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
          resolve({ behavior: remembered, message: remembered === 'deny' ? 'Denied (remembered)' : undefined });
          return;
        }

        if (
          classify(request.toolName, request.toolInput, request.detail) === 'fileRead'
          && isOutsideWorkspacePathAllowed(
            request.toolName,
            request.toolInput,
            request.detail,
            activeRun.workspaceRoot,
            activeRun.allowedOutsideWorkspaceRoots
          )
        ) {
          sendMessage(client.ws, {
            type: 'agent_permission_intercepted',
            toolName: request.toolName,
            decision: 'approve',
            reason: 'Auto-approved for remembered outside-workspace directory',
            sessionId: message.sessionId,
            runId,
          } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
          resolve({ behavior: 'allow', updatedInput: request.toolInput });
          return;
        }

        // --- Unified permission strategy chain ---
        const globalPolicy = getAgentPermissionPolicy(db);
        const projectOverride = getProjectPermissionOverride(db, session.project_id);

        // Merge: global → project �� session
        let effectivePolicy = globalPolicy
          ? mergePolicy(globalPolicy, projectOverride)
          : projectOverride
            ? normalizePolicy(projectOverride)
            : DEFAULT_UNIFIED_POLICY;

        if (sessionPermissionOverride) {
          const normalizedOverride = normalizePolicy(sessionPermissionOverride);
          effectivePolicy = effectivePolicy
            ? mergePolicy(effectivePolicy, normalizedOverride)
            : normalizedOverride;
        }

        const _cmdPreview = isBashLikeTool(request.toolName) ? ` | cmd=${JSON.stringify((request.toolInput as Record<string, unknown>)?.command || request.detail).slice(0, 120)}` : '';
        console.log(`[Permission] Tool=${request.toolName}${_cmdPreview} | effective=${effectivePolicy?.enabled ? 'enabled' : 'null/disabled'} | sessionType=${sessionType}`);
        if (effectivePolicy?.enabled) {
          const evaluator = new PermissionEvaluator();
          const decision = evaluator.evaluate(
            request.toolName, request.toolInput, request.detail,
            effectivePolicy,
            { rootPath: cwd, sessionType }
          );
          if (decision === 'approve') {
            sendMessage(client.ws, {
              type: 'agent_permission_intercepted',
              toolName: request.toolName,
              decision: 'approve',
              reason: 'Auto-approved by category policy',
              sessionId: message.sessionId,
              runId,
            } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
            resolve({ behavior: 'allow', updatedInput: request.toolInput });
            return;
          }
          if (decision === 'deny') {
            sendMessage(client.ws, {
              type: 'agent_permission_intercepted',
              toolName: request.toolName,
              decision: 'deny',
              reason: 'Blocked by category policy',
              sessionId: message.sessionId,
              runId,
            } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
            resolve({ behavior: 'deny', message: 'Denied by policy' });
            return;
          }
          // 'escalate' → fall through to user UI flow
        }
        // --- End strategy chain ---

        const matchedRule = effectivePolicy?.enabled
          ? getMatchedPermissionRule(
            request.toolName,
            request.toolInput,
            request.detail,
            effectivePolicy,
            { rootPath: cwd, sessionType }
          ) || undefined
          : undefined;

        if (matchedRule === 'Outside workspace access') {
          const outsidePaths = getOutsideWorkspacePaths(
            request.toolName,
            request.toolInput,
            request.detail,
            cwd
          );
          const bashCommand = isBashLikeTool(request.toolName)
            ? ((request.toolInput as { command?: unknown } | undefined)?.command ?? request.detail)
            : undefined;
          console.warn('[Permission] Outside workspace access detected', {
            sessionId: message.sessionId,
            runId,
            toolName: request.toolName,
            rootPath: cwd,
            command: bashCommand,
            outsidePaths,
          });
        }

        const continueWithUserFlow = () => {
          if (isInternalInteractionTool(request.toolName)) {
            sendMessage(client.ws, {
              type: 'agent_permission_intercepted',
              toolName: request.toolName,
              decision: 'approve',
              reason: 'Internal interaction tool handles its own user flow',
              sessionId: message.sessionId,
              runId,
            } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
            resolve({ behavior: 'allow', updatedInput: request.toolInput });
            return;
          }

          // For background sessions, escalate sends a notification instead of blocking UI
          if (sessionType === 'background') {
            sendMessage(client.ws, {
              type: 'background_permission_pending',
              sessionId: message.sessionId,
              requestId: request.requestId,
              toolName: request.toolName,
              detail: request.detail,
              timeoutSeconds: request.timeoutSeconds,
            } as import('@my-claudia/shared').BackgroundPermissionPendingMessage);

            sendMessage(client.ws, {
              type: 'background_task_update',
              sessionId: message.sessionId,
              status: 'paused',
              reason: `Permission needed: ${request.toolName}`,
            } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);

            notificationService.notify({
              type: 'background_permission',
              title: 'Background task needs attention',
              body: `${request.toolName}: ${request.detail.slice(0, 200)}`,
              priority: 'urgent',
              tags: ['rotating_light'],
            });
          }

          // Determine effective timeout behavior
          // For escalateAlways tools: use hardcoded PERMISSION_TIMEOUT_POLICIES (e.g., ExitPlanMode auto-approve)
          // For other escalated tools: use AI review timeout from policy
          const isEscalateAlways = effectivePolicy?.escalateAlways?.includes(request.toolName);
          const timeoutPolicy = PERMISSION_TIMEOUT_POLICIES.get(request.toolName);
          const policyApplies = timeoutPolicy && (!timeoutPolicy.condition || timeoutPolicy.condition(activeRun));

          // Resolve AI review config from unified policy
          const aiReviewConfig = effectivePolicy && isUnifiedPolicy(effectivePolicy)
            ? effectivePolicy.aiReview
            : undefined;

          let effectiveTimeoutSeconds: number;
          let effectiveTimeoutBehavior: 'approve' | 'deny' | 'ai_review';
          let aiInitiated = false;

          if (policyApplies) {
            // Hardcoded timeout policy (e.g., ExitPlanMode)
            effectiveTimeoutBehavior = timeoutPolicy!.behavior;
            effectiveTimeoutSeconds = request.timeoutSeconds || timeoutPolicy!.timeoutSeconds || 0;
            aiInitiated = timeoutPolicy!.behavior === 'approve';
          } else if (!isEscalateAlways && aiReviewConfig?.enabled) {
            // AI review timeout for non-escalateAlways tools
            effectiveTimeoutBehavior = 'ai_review';
            effectiveTimeoutSeconds = aiReviewConfig.timeoutBeforeReview;
          } else {
            // escalateAlways tools or no AI review: no timeout, wait for user
            effectiveTimeoutBehavior = 'deny';
            effectiveTimeoutSeconds = request.timeoutSeconds;
          }

          let timeout: ReturnType<typeof setTimeout> | null = null;
          if (effectiveTimeoutSeconds > 0) {
            const timeoutMs = effectiveTimeoutSeconds * 1000;
            timeout = setTimeout(() => void (async () => {
              // Guard: if user already resolved this permission, skip
              if (!activeRun.pendingPermissions.has(request.requestId)) return;

              if (effectiveTimeoutBehavior === 'ai_review' && aiReviewConfig) {
                // Enqueue AI review (serialized via AIReviewQueue)
                console.log(`[AI Review] Enqueuing review for ${request.requestId} (${request.toolName}), queue depth: ${activeRun.aiReviewQueue?.pendingCount ?? 0}`);
                try {
                  const aiResult = await activeRun.aiReviewQueue!.enqueue(
                    request.requestId,
                    aiReviewConfig,
                    {
                      toolName: request.toolName,
                      toolInput: request.toolInput,
                      detail: request.detail,
                      cwd,
                    },
                  );

                  // Guard: user may have resolved while review was queued/in-flight
                  if (!activeRun.pendingPermissions.has(request.requestId)) return;

                  if (aiResult.decision === 'approve') {
                    // AI approved — resolve and notify
                    activeRun.pendingPermissions.delete(request.requestId);
                    const resolvedEvent = {
                      type: 'permission_auto_resolved',
                      requestId: request.requestId,
                      sessionId: message.sessionId,
                      behavior: 'approve' as const,
                      reason: `AI review: ${aiResult.reasoning} (${Math.round(aiResult.confidence * 100)}%)`,
                    } as import('@my-claudia/shared').PermissionAutoResolvedMessage;
                    sendMessage(client.ws, resolvedEvent);
                    if (connectedClients.size > 0) {
                      broadcastToOtherAuthenticatedClients(connectedClients, client.id, resolvedEvent);
                    }
                    console.log(`[AI Review] Approved ${request.requestId} (${request.toolName}): ${aiResult.reasoning}`);
                    resolve({ behavior: 'allow', updatedInput: request.toolInput });
                  } else {
                    // AI denied, uncertain, or cancelled — notify but keep waiting for user
                    const reviewEvent = {
                      type: 'ai_review_completed',
                      requestId: request.requestId,
                      sessionId: message.sessionId,
                      decision: aiResult.decision,
                      reasoning: aiResult.reasoning,
                      confidence: aiResult.confidence,
                    } as import('@my-claudia/shared').AIReviewCompletedMessage;
                    sendMessage(client.ws, reviewEvent);
                    if (connectedClients.size > 0) {
                      broadcastToOtherAuthenticatedClients(connectedClients, client.id, reviewEvent);
                    }
                    console.log(`[AI Review] ${aiResult.decision} ${request.requestId} (${request.toolName}): ${aiResult.reasoning} — keeping pending for user`);
                  }
                } catch (err) {
                  console.error('[AI Review] Failed:', err);
                  // Keep waiting for user on failure
                }
              } else {
                // Non-AI-review timeout (e.g., ExitPlanMode auto-approve, or legacy deny)
                activeRun.pendingPermissions.delete(request.requestId);
                const behavior = effectiveTimeoutBehavior === 'ai_review' ? 'deny' : effectiveTimeoutBehavior;
                const resolvedEvent = {
                  type: 'permission_auto_resolved',
                  requestId: request.requestId,
                  sessionId: message.sessionId,
                  behavior,
                } as import('@my-claudia/shared').PermissionAutoResolvedMessage;
                sendMessage(client.ws, resolvedEvent);
                if (connectedClients.size > 0) {
                  broadcastToOtherAuthenticatedClients(connectedClients, client.id, resolvedEvent);
                }
                if (behavior === 'approve') {
                  console.log(`[Permission] Auto-approved ${request.requestId} (${request.toolName}) on timeout`);
                  resolve({ behavior: 'allow', updatedInput: request.toolInput });
                } else {
                  console.log(`[Permission] Auto-denied ${request.requestId} (${request.toolName}) on timeout`);
                  resolve({ behavior: 'deny', message: 'Permission request timed out' });
                }
              }
            })().catch((err) => {
              console.error(`[Permission] Timeout handler error for ${request.requestId}:`, err);
            }), timeoutMs);
          }

          const isAskUserQuestion = request.toolName === 'AskUserQuestion';
          const toolInput = request.toolInput as Record<string, unknown>;
          const requiresCredential = !isAskUserQuestion && isSudoCommand(request.toolName, request.toolInput);
          activeRun.pendingPermissions.set(request.requestId, {
            resolve,
            timeout,
            originalToolInput: request.toolInput,
            originalRequest: {
              toolName: request.toolName,
              detail: request.detail,
              ...(matchedRule && { matchedRule }),
              timeoutSeconds: effectiveTimeoutSeconds,
              sessionId: message.sessionId,
              ...(requiresCredential && { requiresCredential: true, credentialHint: 'sudo_password' }),
              ...(isAskUserQuestion && { questions: (toolInput.questions as AskUserQuestionItem[]) || [] }),
              ...(aiInitiated && { aiInitiated: true }),
            }
          });
          console.log(`[Permission] Stored pending permission ${request.requestId} in run ${runId} (timeout: ${effectiveTimeoutSeconds > 0 ? effectiveTimeoutSeconds + 's' : 'none'}, behavior: ${effectiveTimeoutBehavior}, aiInitiated: ${aiInitiated}, session: ${sessionType})`);

          // Persist waiting status for crash recovery
          db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
            .run('waiting', Date.now(), activeRun.sessionId);

          // For regular sessions: send UI prompts as before
          if (sessionType !== 'background') {
            if (request.toolName === 'AskUserQuestion') {
              const toolInput = request.toolInput as { questions?: Array<any> };
              sendMessage(client.ws, {
                type: 'prompt_request',
                requestId: request.requestId,
                sessionId: message.sessionId,
                questions: toolInput.questions || [],
              } as import('@my-claudia/shared').PromptRequestMessage);
              console.log(`[Permission] Sent prompt_request ${request.requestId} to client (${(toolInput.questions || []).length} questions)`);
              // Emit a parallel unified interaction_prompt event for the chat UI
              const askUserInteraction = normalizeFromAskUser({
                requestId: request.requestId,
                sessionId: message.sessionId,
                runId,
                providerType,
                questions: toolInput.questions || [],
              });
              sendRunEvent(askUserInteraction);
              const firstQuestion = (toolInput.questions || [])[0];
              notificationService.notify({
                type: 'prompt_request',
                title: 'Claude has a question',
                body: firstQuestion?.question?.slice(0, 200) || 'Interactive question',
                priority: 'high',
                tags: ['question'],
              });
            } else {
              // Detect sudo commands and flag for credential input
              const requiresCredential = isSudoCommand(request.toolName, request.toolInput);
              sendMessage(client.ws, {
                type: 'permission_request',
                requestId: request.requestId,
                sessionId: message.sessionId,
                toolName: request.toolName,
                detail: request.detail,
                ...(matchedRule && { matchedRule }),
                timeoutSeconds: effectiveTimeoutSeconds,
                ...(requiresCredential && {
                  requiresCredential: true,
                  credentialHint: 'sudo_password',
                }),
                ...(aiInitiated && { aiInitiated: true }),
              });
              console.log(`[Permission] Sent permission request ${request.requestId} to client${requiresCredential ? ' (requires sudo credential)' : ''}${aiInitiated ? ' (ai-initiated, auto-approve on timeout)' : ''}`);
              notificationService.notify({
                type: 'permission_request',
                title: 'Permission Required',
                body: `${matchedRule ? `[${matchedRule}] ` : ''}${request.toolName}: ${request.detail.slice(0, 200)}`,
                priority: 'urgent',
                tags: ['warning'],
              });
            }
          }
        };

        // AI review is now handled via timeout, no pre-check delegation needed
        continueWithUserFlow();
      });
    };

    // PCP: negotiate effective profile before emitting run_started
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

    // Emit plugin event
    pluginEvents.emit('run.started', {
      runId,
      sessionId: message.sessionId,
      input: message.input,
      providerId,
      providerType: providerConfig?.type,
    }).catch((err: unknown) => { console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err); });

    // Notify background task started
    if (sessionType === 'background') {
      sendMessage(client.ws, {
        type: 'background_task_update',
        sessionId: message.sessionId,
        status: 'running',
      } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
    }

    // Inject file push context (env vars + system prompt) so AI agents can push files to user's device
    // When interaction tools are available, push_file tool replaces the curl-based prompt
    const filePushEnv: Record<string, string> = {};
    let filePushContext: string | undefined;
    const hasInteractionTools = providerType !== 'claude'
      && pluginToolRegistry.getAll().some(t => t.source === 'interaction');
    if (serverPort) {
      const apiUrl = `http://127.0.0.1:${serverPort}`;
      filePushEnv.MY_CLAUDIA_API_URL = apiUrl;
      filePushEnv.MY_CLAUDIA_SESSION_ID = message.sessionId;
      // Only inject curl-based prompt when interaction tools are NOT available (fallback)
      if (!hasInteractionTools) {
        filePushContext = buildFilePushContext(apiUrl, message.sessionId);
      }
    }

    const injectNonNativePlanPrompt = modeValue === 'plan' && !providerSupportsNativePlanMode(providerType);
    const nonNativePlanPrompt = injectNonNativePlanPrompt
      ? buildNonNativePlanPrompt(providerType)
      : undefined;
    const planDocumentPrompt = forcedPlanBySession && session.task_id
      ? buildPlanDocumentPrompt(session.task_id)
      : undefined;

    // Interaction tool prompt (injected when interaction tools are registered)
    const interactionToolPrompt = hasInteractionTools
      ? `## Interaction Tools
You have access to these interaction tools via MCP:
- **update_todo_list**: Show/update a visible task list for the user. Call this to track progress on multi-step tasks. Each call replaces the previous list.
- **ask_user_form**: Present a structured form when you need specific input from the user — multiple fields, choices, or confirmations. The form blocks until the user responds.
- **request_approval**: Request user approval before proceeding with a destructive, irreversible, or high-impact action. Blocks until the user approves or rejects. The response contains { approved: true/false, reason?: string }.
- **push_file**: Push a local file to the user's device. Use this when you build, generate, or export files (images, APKs, binaries, archives, documents, etc.) that the user needs. Images and small files (<500KB) auto-download; larger files show a download notification. Prefer this over curl to push files.

Prefer ask_user_form over AskUserQuestion when you need multiple pieces of information at once or want to offer specific options/choices.
Use request_approval when an action is destructive or hard to reverse — do not just proceed without confirmation.
Use push_file instead of curl to send files to the user — it is more reliable and works across all providers.
- **enter_plan_mode**: Enter plan mode to analyze and plan before executing. Use for complex multi-step tasks. In plan mode, only use read-only tools.
- **exit_plan_mode**: Exit plan mode with your completed plan for user review. Blocks until the user approves or denies. If denied, read the feedback and revise.

Use enter_plan_mode / exit_plan_mode for complex tasks that affect multiple files or have ambiguous requirements. Flow: enter_plan_mode → analyze (read-only) → exit_plan_mode with plan → if approved, execute; if denied, revise and resubmit.`
      : undefined;

    // 🆕 Assemble workspace prompt (SOUL.md, AGENTS.md, TOOLS.md, skills)
    const workspacePrompt = await workspaceService.assembleSystemPrompt({
      projectId: session.project_id || undefined,
      projectPath: session.root_path || undefined,
      skills: [], // TODO: Load from project.agentConfig.skills when database schema is updated
    });

    // Skill directory hint — lightweight listing of available skill tools
    const skillDirectoryHint = buildSkillDirectoryHint();

    // PCP: map permission mode to provider-native mode
    const nativeMode = adapter.manifest
      ? mapPermissionMode(adapter.manifest, modeValue)
      : modeValue;

    const runOptions = {
      cwd,
      sessionId: sdkSessionId,
      cliPath: providerConfig?.cliPath,
      env: { ...(providerConfig?.env || {}), ...filePushEnv },
      mode: nativeMode,
      model: message.model,
      systemPrompt: (() => {
        // For agent sessions, auto-inject matching skills content
        let activeSkillsContent: string | undefined;
        if (sessionType === 'agent') {
          try {
            const allSkills = getDiscoveredSkills();
            const matched = selectSkills(allSkills, { userInput: message.input, os: process.platform });
            if (matched.length > 0) {
              activeSkillsContent = matched
                .map((s) => loadSkillContent(s.dirPath))
                .filter(Boolean)
                .join('\n\n---\n\n');
            }
          } catch { /* skill selector is best-effort */ }
        }
        // Use explicit contextTemplate if provided (from TaskOrchestrator), otherwise infer from session type
        const template = ((message as Record<string, unknown>)._contextTemplate || (sessionType === 'agent' ? 'agent' : 'coding')) as import('../context/types.js').ContextTemplate;
        return createContextEngine().assemble(template, {
          sessionId: message.sessionId,
          projectId: session.project_id,
          cwd,
          workspacePrompt,
          skillDirectoryHint,
          systemContext: message.systemContext,
          activeSkillsContent,
          nonNativePlanPrompt,
          planDocumentPrompt,
          filePushContext,
          interactionToolPrompt,
          sessionSystemPrompt: session.system_prompt || undefined,
        }) || undefined;
      })(),
      sessionTitle: session.name || undefined,
      serverPort: serverPort || undefined,
      claudiaSessionId: message.sessionId,
      db,
    };

    // Debug: log all run parameters for 403 diagnosis
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

    // Store provider info for abort support
    activeRun.providerType = providerType;
    const runState = adapter.getRunState?.(runOptions) || {};
    Object.assign(activeRun, runState);

    // Start periodic save for message persistence (survives cancel/disconnect)
    activeRun.saveInterval = setInterval(() => {
      try {
        upsertAssistantMessage(activeRun);
      } catch (err) {
        console.error(`[Periodic Save] Failed for run ${runId}:`, err);
      }
    }, PERIODIC_SAVE_INTERVAL_MS);

    // Run provider with streaming
    for await (const msg of providerRunner) {
      trace.log(
        'server_provider',
        msg.type,
        msg,
        summarizeProviderMessage(msg as { type: string; [key: string]: unknown }),
      );
      // Check if run was cancelled
      if (!activeRuns.has(runId)) {
        break;
      }

      // Track activity for stuck detection
      activeRun.lastActivityAt = Date.now();

      switch (msg.type) {
        case 'init':
          // Save system info for potential use in /status command
          if (msg.systemInfo) {
            systemInfo = msg.systemInfo;
            activeRun.latestSystemInfo = msg.systemInfo;
            persistSessionWorkingDirectory(msg.systemInfo.cwd);
            trace.setMeta({ cwd: msg.systemInfo.cwd || cwd });
            // Send system info to client for display
            sendRunEvent({
              type: 'system_info',
              runId,
              systemInfo: {
                model: msg.systemInfo.model,
                claudeCodeVersion: msg.systemInfo.claudeCodeVersion,
                cwd: msg.systemInfo.cwd,
                permissionMode: msg.systemInfo.permissionMode,
                apiKeySource: msg.systemInfo.apiKeySource,
                tools: msg.systemInfo.tools,
                mcpServers: msg.systemInfo.mcpServers,
                slashCommands: msg.systemInfo.slashCommands,
                agents: msg.systemInfo.agents,
              }
            });
          }
          if (msg.sessionId && msg.sessionId !== sdkSessionId) {
            sdkSessionId = msg.sessionId;
            trace.log('server_provider', 'provider_session_attached', { sdkSessionId }, `provider session ${sdkSessionId}`);
            // Update session with SDK session ID (handles both new and replaced sessions)
            db.prepare(`
              UPDATE sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?
            `).run(sdkSessionId, Date.now(), message.sessionId);

            // Store session ID for provider abort support
            activeRun.providerSessionId = sdkSessionId;

            sendRunEvent({
              type: 'session_created',
              sessionId: message.sessionId,
              sdkSessionId: msg.sessionId
            });
          }
          break;

        case 'assistant':
          if (msg.content) {
            activeRun.fullContent += msg.content;
            // Track content blocks for segmented rendering
            const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
            if (lastBlock && lastBlock.type === 'text') {
              lastBlock.content += msg.content;
            } else {
              activeRun.contentBlocks.push({ type: 'text', content: msg.content });
            }
            sendRunEvent({
              type: 'delta',
              runId,
              sessionId: activeRun.sessionId,
              content: msg.content
            });
          }
          break;

        case 'tool_use':
          // Forward tool use to client
          console.log(`[Tool Use] ${msg.toolName} (${msg.toolUseId})`);
          // Track tool_use_id to tool_name mapping
          if (msg.toolUseId && msg.toolName) {
            toolUseIdToName.set(msg.toolUseId, msg.toolName);
          }
          // Track for loop detection (sliding window of last 20 tool signatures)
          if (msg.toolName) {
            const input = msg.toolInput as Record<string, unknown> | undefined;
            const toolSignature = generateToolSignature(msg.toolName, input, activeRun.providerType);
            activeRun.recentToolCalls.push(toolSignature);
            if (activeRun.recentToolCalls.length > 20) {
              activeRun.recentToolCalls.shift();
            }
          }
          // Collect for persistence
          activeRun.collectedToolCalls.push({
            toolUseId: msg.toolUseId || '',
            name: msg.toolName || '',
            input: msg.toolInput,
          });
          // Track content blocks for segmented rendering
          activeRun.contentBlocks.push({ type: 'tool_use', toolUseId: msg.toolUseId || '' });
          sendRunEvent({
            type: 'tool_use',
            runId,
            sessionId: activeRun.sessionId,
            toolUseId: msg.toolUseId || '',
            toolName: msg.toolName || '',
            toolInput: msg.toolInput
          });
          pluginEvents.emit('run.toolCall', {
            runId,
            sessionId: activeRun.sessionId,
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            toolInput: msg.toolInput,
          }).catch((err: unknown) => { console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err); });
          // Phase 1: Emit parallel interaction event for TodoWrite
          const todoInteraction = normalizeFromToolUse({
            sessionId: activeRun.sessionId,
            runId,
            providerType,
            toolUseId: msg.toolUseId || '',
            toolName: msg.toolName || '',
            toolInput: msg.toolInput,
          });
          if (todoInteraction) {
            sendRunEvent(todoInteraction);
          }
          break;

        case 'tool_result': {
          // Forward tool result to client
          // Look up tool name from our tracking map
          const toolName = msg.toolUseId ? toolUseIdToName.get(msg.toolUseId) || '' : '';
          console.log(`[Tool Result] ${msg.toolUseId} (${toolName}) - error: ${msg.isToolError}`);
          // Update collected tool call with output
          const collected = activeRun.collectedToolCalls.find(tc => tc.toolUseId === msg.toolUseId);
          if (collected) {
            collected.output = msg.toolResult;
            collected.isError = msg.isToolError || false;
          }
          sendRunEvent({
            type: 'tool_result',
            runId,
            sessionId: activeRun.sessionId,
            toolUseId: msg.toolUseId || '',
            toolName: toolName,
            result: msg.toolResult,
            isError: msg.isToolError
          });
          pluginEvents.emit('run.toolResult', {
            runId,
            sessionId: activeRun.sessionId,
            toolName,
            toolUseId: msg.toolUseId,
            result: msg.toolResult,
            isError: msg.isToolError,
          }).catch((err: unknown) => { console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err); });
          // Sync plan mode state to client (Claude native + Codex via MCP tools)
          if ((activeRun.providerType === 'claude' || activeRun.providerType === 'codex') && !msg.isToolError) {
            if (toolName === 'EnterPlanMode') {
              sendRunEvent({ type: 'mode_change', runId, sessionId: activeRun.sessionId, mode: 'plan' });
              // Track AI-initiated plan mode (only when the run didn't start in plan mode)
              if (modeValue !== 'plan') {
                activeRun.aiInitiatedPlanMode = true;
                console.log(`[Permission] AI entered plan mode during ${modeValue} run — ExitPlanMode will auto-approve`);
              }
            } else if (toolName === 'ExitPlanMode') {
              sendRunEvent({ type: 'mode_change', runId, sessionId: activeRun.sessionId, mode: 'default' });
              activeRun.aiInitiatedPlanMode = false;
            }
          }
          break;
        }

        case 'tool_activity': {
          // Subagent activity text — find the last running Agent tool to attach it to
          const lastAgentToolUseId = [...activeRun.collectedToolCalls]
            .reverse()
            .find(tc => tc.name === 'Agent' && !tc.output)?.toolUseId;
          if (lastAgentToolUseId && msg.content) {
            sendRunEvent({
              type: 'tool_activity',
              runId,
              sessionId: activeRun.sessionId,
              toolUseId: lastAgentToolUseId,
              content: msg.content,
            });
          }
          break;
        }

        case 'result':
          // If result has content that wasn't already streamed via 'assistant' events, send it.
          // (Some providers only return content in the result, not through streaming.)
          if (msg.content && !activeRun.fullContent) {
            activeRun.fullContent = msg.content;
            // Non-streaming fallback: build content block for the full response
            activeRun.contentBlocks.push({ type: 'text', content: msg.content });
            sendRunEvent({
              type: 'delta',
              runId,
              sessionId: activeRun.sessionId,
              content: msg.content
            });
          }

          // If this was a system-info command and we got no content, use systemInfo
          const inputTrimmed = message.input.trim().toLowerCase();
          if (!activeRun.fullContent && SYSTEM_INFO_COMMANDS.includes(inputTrimmed) && systemInfo) {
            console.log(`[System Info] Building output for "${message.input}" from init data`);
            const statusOutput = buildStatusOutput(systemInfo);
            if (statusOutput) {
              activeRun.fullContent = statusOutput;
              sendRunEvent({
                type: 'delta',
                runId,
                sessionId: activeRun.sessionId,
                content: statusOutput
              });
            }
          }

          // OpenCode fallback: some task/subagent flows may only emit tool events and no
          // assistant text. Ensure users still get a visible completion message.
          if (
            !activeRun.fullContent &&
            activeRun.providerType === 'opencode' &&
            activeRun.collectedToolCalls.length > 0
          ) {
            const fallback = 'Task execution completed, but the provider did not return a final visible text response. Send "summarize the result" to get a structured conclusion.';
            activeRun.fullContent = fallback;
            activeRun.contentBlocks.push({ type: 'text', content: fallback });
            sendRunEvent({
              type: 'delta',
              runId,
              sessionId: activeRun.sessionId,
              content: fallback
            });
          }

          // Detect truncated completions — the model's last output was a thinking
          // block (ending with </think>) with no subsequent text or tool_use.
          // This commonly happens with third-party models via LiteLLM proxies that
          // have limited compatibility with Claude Code's tool_use protocol, or when
          // output token limits are hit mid-generation.
          {
            const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
            const endsWithThinking = lastBlock?.type === 'text' &&
              lastBlock.content.trimEnd().endsWith('</think>');
            if (endsWithThinking) {
              console.warn(`[Truncation] Run ${runId} ended with a thinking block as last output. Possible provider truncation.`);
              const warning = '\n\n⚠️ *The model appeared to stop mid-thought without producing a response. This may be caused by output token limits or provider compatibility issues. Try sending "continue" or starting a new session.*';
              activeRun.fullContent += warning;
              activeRun.contentBlocks.push({ type: 'text', content: warning });
              sendRunEvent({
                type: 'delta',
                runId,
                sessionId: activeRun.sessionId,
                content: warning
              });
            }
          }

          // Final save — upsert with usage info and metadata indexing
          upsertAssistantMessage(activeRun, {
            usage: msg.usage,
            indexMetadata: true
          });

          if (activeRun.completed) {
            // Early run_completed was already sent (background task triggered it).
            // Send usage info separately so the client can update token counts.
            if (msg.usage) {
              sendRunEvent({
                type: 'run_completed',
                runId,
                sessionId: activeRun.sessionId,
                usage: msg.usage
              });
            }
            console.log(`[Result] Run ${runId} already completed (early completion), sending final usage`);
          } else {
            sendRunEvent({
              type: 'run_completed',
              runId,
              sessionId: activeRun.sessionId,
              usage: msg.usage
            });
            // Mark completed immediately so heartbeat no longer reports this run as active.
            // The for-await loop may still receive trailing SDK messages (e.g. task_notification)
            // but the client should see the session as idle.
            activeRun.completed = true;
            pluginEvents.emit('run.completed', {
              runId,
              sessionId: activeRun.sessionId,
              usage: msg.usage,
            }).catch((err: unknown) => { console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err); });
            broadcastHeartbeat();
            notificationService.notify({
              type: 'run_completed',
              title: 'Run completed',
              body: `Session: ${message.sessionId}`,
              priority: 'default',
              tags: ['white_check_mark'],
            });
          }
          // Notify background task completion
          if (sessionType === 'background') {
            sendMessage(client.ws, {
              type: 'background_task_update',
              sessionId: message.sessionId,
              status: 'completed',
            } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
          }
          break;

        case 'error': {
          const rawProviderError = (msg.error || 'Provider error') as string;
          const errorMessage = formatProviderErrorMessage(rawProviderError, activeRun.providerType);
          console.error(`[Provider Error] runId=${runId} provider=${activeRun.providerType}: ${rawProviderError}`);

          if (!activeRun.completed) {
            try {
              upsertAssistantMessage(activeRun, { indexMetadata: true });
            } catch (saveErr) {
              console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
            }
            sendRunEvent({
              type: 'run_failed',
              runId,
              sessionId: activeRun.sessionId,
              error: errorMessage,
            });
            activeRun.completed = true;
            pluginEvents.emit('run.error', {
              runId,
              sessionId: activeRun.sessionId,
              error: errorMessage,
            }).catch((err: unknown) => { console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err); });
            broadcastHeartbeat();
            notificationService.notify({
              type: 'run_failed',
              title: 'Run failed',
              body: errorMessage.slice(0, 200),
              priority: 'high',
              tags: ['x'],
            });
          }
          // Mark run as ended now; for-await loop exits on next iteration by guard.
          activeRun.aiReviewQueue?.cancelAll();
      activeRuns.delete(runId);
          break;
        }

        case 'task_notification': {
          // Forward background/sub-agent task notifications to client, but do not
          // mark the parent run complete here. Newer provider/SDK versions can emit
          // task notifications while the parent run is still logically active.
          const adapter = activeRun.providerType ? providerRegistry.get(activeRun.providerType) : undefined;
          const buildTaskNotificationEvent = () => {
            const cliPid = activeRun.providerSessionId
              ? adapter?.getCliPid?.(activeRun.providerSessionId)
              : undefined;
            const taskProcInfo = msg.taskId ? adapter?.getTaskProcessInfo?.(msg.taskId) : undefined;
            return {
              cliPid,
              taskProcInfo,
              event: {
                type: 'task_notification',
                runId,
                sessionId: activeRun.sessionId,
                taskId: msg.taskId,
                status: msg.taskStatus,
                message: msg.taskMessage,
                cliPid,
                taskCommand: taskProcInfo?.command,
                taskRootPid: taskProcInfo?.rootPid,
              } as import('@my-claudia/shared').TaskNotificationMessage,
            };
          };

          const { cliPid, taskProcInfo, event } = buildTaskNotificationEvent();
          console.log(`[Task Notification] taskId=${msg.taskId} status=${msg.taskStatus} message=${msg.taskMessage} cliPid=${cliPid} rootPid=${taskProcInfo?.rootPid} command=${taskProcInfo?.command?.slice(0, 80)}`);
          sendRunEvent(event);

          if (msg.taskId && msg.taskStatus === 'started' && !taskProcInfo?.rootPid) {
            const timer = setTimeout(async () => {
              const refreshed = buildTaskNotificationEvent();
              let resolvedRootPid = refreshed.taskProcInfo?.rootPid;

              if (!resolvedRootPid && refreshed.event.taskCommand) {
                const matchedPids = await findProcessPidsByTaskCommand(
                  refreshed.event.taskCommand,
                  [refreshed.event.cliPid, refreshed.event.taskRootPid].filter((pid): pid is number => typeof pid === 'number'),
                );
                resolvedRootPid = matchedPids[0];
              }

              if (resolvedRootPid && resolvedRootPid !== taskProcInfo?.rootPid) {
                console.log(`[Task Notification] Backfilled PID for taskId=${msg.taskId} rootPid=${resolvedRootPid}`);
                sendRunEvent({
                  ...refreshed.event,
                  taskRootPid: resolvedRootPid,
                });
              }
            }, 1800);
            timer.unref();
          }

          break;
        }
      }
    }
  } catch (error) {
    console.error('Run error:', error);
    trace.log('server_norm', 'run_exception', error, 'handleRunStart exception');

    const errMsg = error instanceof Error ? error.message : '';
    const formattedErrMsg = formatProviderErrorMessage(errMsg, activeRun.providerType);

    // If the Claude CLI process crashed (exit code 1) and we were resuming an
    // existing SDK session, the session is likely corrupted. Auto-reset and retry
    // once instead of failing immediately — this saves the user a manual retry.
    const sessionResetRetryCount = recoveryState.sessionResetRetryCount || 0;
    if (
      errMsg.includes('process exited with code') &&
      sdkSessionId &&
      sessionResetRetryCount < MAX_SESSION_RESET_RETRIES &&
      !isHardQuotaExceededError(errMsg)
    ) {
      console.log(`[Recovery] Auto-resetting corrupted sdk_session_id ${sdkSessionId} for session ${message.sessionId}`);
      db.prepare(`UPDATE sessions SET sdk_session_id = NULL, updated_at = ? WHERE id = ?`)
        .run(Date.now(), message.sessionId);

      // Notify the user visually that a reset is happening
      const resetNotice = `⚠️ Claude session crashed (corrupted underlying session \`${sdkSessionId.slice(0, 8)}…\`). Resetting session and retrying automatically…`;
      sendRunEvent({
        type: 'delta',
        runId,
        sessionId: activeRun.sessionId,
        content: resetNotice,
      });

      // Clean up current run state before retrying
      if (activeRun.saveInterval) {
        clearInterval(activeRun.saveInterval);
        activeRun.saveInterval = undefined;
      }
      activeRun.aiReviewQueue?.cancelAll();
      activeRuns.delete(runId);
      broadcastHeartbeat();

      // Re-invoke handleRunStart with a fresh run (sdk_session_id is now NULL)
      try {
        await handleRunStart(
          client,
          { ...message, resend: true },
          db,
          { sessionResetRetryCount: sessionResetRetryCount + 1 },
          clients,
          ctx,
        );
        return; // retry succeeded — skip the error path below
      } catch (retryError) {
        console.error('[Recovery] Auto-retry after session reset also failed:', retryError);
        // Fall through to normal error handling
      }
    }

    // Save any accumulated content before reporting failure
    try {
      upsertAssistantMessage(activeRun, { indexMetadata: true });
    } catch (saveErr) {
      console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
    }
    sendRunEvent({
      type: 'run_failed',
      runId,
      sessionId: activeRun.sessionId,
      error: formattedErrMsg
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
    // Notify background task failure
    if (sessionType === 'background') {
      sendMessage(client.ws, {
        type: 'background_task_update',
        sessionId: message.sessionId,
        status: 'failed',
        reason: formattedErrMsg,
      } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
    }
  } finally {
    trace.log('server_norm', 'run_finalized', {
      runId,
      sessionId: message.sessionId,
      completed: activeRun.completed === true,
      providerType: activeRun.providerType,
      contentChars: activeRun.fullContent.length,
      collectedToolCalls: activeRun.collectedToolCalls.length,
    }, 'run finalized');
    // Stop periodic save
    if (activeRun.saveInterval) {
      clearInterval(activeRun.saveInterval);
      activeRun.saveInterval = undefined;
    }

    // Cleanup
    interactionDispatcher.cancelBySession(activeRun.sessionId);
    activeRuns.delete(runId);
    broadcastHeartbeat();

    // Trigger deferred leak check — give child processes a few seconds to exit gracefully
    if (processMonitor && activeRuns.size === 0) {
      setTimeout(() => processMonitor?.check(), 5_000);
    }

    // Clear run status and update session updated_at
    db.prepare(`
      UPDATE sessions SET last_run_status = NULL, updated_at = ? WHERE id = ?
    `).run(Date.now(), message.sessionId);
  }
}
