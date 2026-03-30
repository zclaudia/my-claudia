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
import { cleanupPendingPermissions, getNextOffset, upsertAssistantMessage, findProcessPidsByTaskCommand } from './run-lifecycle.js';
import {
  normalizeSessionWorkingDirectory,
  isSlashCommand,
  isSudoCommand,
  isBashLikeTool,
  processAtMentions,
  buildStatusOutput,
  formatProviderErrorMessage,
  isHardQuotaExceededError,
  SYSTEM_INFO_COMMANDS,
} from '../../../helpers/server-utils.js';
import {
  classify,
  isInternalInteractionTool,
  isUnifiedPolicy,
  loadProjectAllowedOutsideWorkspaceRoots,
  loadSessionRememberedDecisions,
} from '../agent/permission-evaluator.js';
import { AIReviewQueue } from '../agent/ai-review-queue.js';
import type { PermissionDecision, SystemInfo } from '../../../providers/claude-sdk.js';
import { providerRegistry } from '../../../providers/registry.js';
import { runAIReviewCliJob, supportsAIReviewCliJob } from '../../../providers/cli-jobs/review-job.js';
import { negotiateProfile } from '../../../providers/pcp-negotiator.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import { normalizeFromToolUse, normalizeFromAskUser } from '../interactions/interaction-normalizer.js';
import { pluginEvents } from '../../../events/index.js';
import { resolveProviderCwd } from '../../../utils/provider-cwd.js';
import { createTraceRecorder, summarizeProviderMessage, summarizeServerMessage } from '../../../utils/provider-trace.js';
import { generateToolSignature, detectLoop } from '../../../loop-detection.js';
import { getGatewayClient } from '../../../domains/gateway/gateway-instance.js';
import { initDatabase } from '../../../storage/db.js';
import { NotificationService } from '../../notification-feed/notification-service.js';
import type { NotificationFeedService } from '../../notification-feed/service.js';
import { ProcessMonitor } from '../../../utils/process-monitor.js';
import { initializeRunBootstrap, type RunStartMessage } from './run-bootstrap.js';
import { buildRunContext } from './run-context.js';
import { createPermissionCallback } from './run-permissions.js';
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
      cleanupPendingPermissions(activeRun, 'Project path does not exist');
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
      if (!supportsAIReviewCliJob(resolvedType)) return undefined;
      console.log(
        `[AI Review] Using analysis provider id=${resolvedProviderId} type=${resolvedType}${providerRow?.cliPath ? ` cli=${providerRow.cliPath}` : ''}`
      );

      return {
        runPrompt: async (prompt: string, sessionId?: string): Promise<{ response: string; sessionId?: string }> => {
          const result = await runAIReviewCliJob(resolvedType, {
            prompt,
            cwd,
            cliPath: providerRow?.cliPath || providerConfig?.cliPath,
            env: {
              ...(providerConfig?.env || {}),
              ...(providerRow?.env ? JSON.parse(providerRow.env) : {}),
            },
            model: message.model,
            systemPrompt: AI_REVIEW_SYSTEM_PROMPT,
            timeoutMs: 120000,
          });

          return {
            response: JSON.stringify({
              type: 'final',
              decision: result.decision,
              reasoning: result.reasoning,
              confidence: result.confidence,
            }),
            sessionId: undefined,
          };
        },
      };
    };

    // Initialize AI review queue with provider factory + cwd
    activeRun.aiReviewQueue = new AIReviewQueue({
      createProvider: (analysisProviderId) => createDelegationAnalysisProvider(analysisProviderId),
      cwd,
    });

    const permissionCallback = createPermissionCallback({
      activeRun,
      client,
      connectedClients,
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
      providerType,
      runId,
      sendMessage,
      sendRunEvent,
      broadcastToOtherAuthenticatedClients,
      session: {
        project_id: session.project_id,
      },
      sessionType,
    });

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
    broadcastSessionCatalogUpdate();

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
          cleanupPendingPermissions(activeRun, errorMessage);
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
