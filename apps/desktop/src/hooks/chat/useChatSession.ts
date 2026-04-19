import { useMemo } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProviderMetaStore } from '../../stores/providerMetaStore';
import { useServerStore } from '../../stores/serverStore';
import { useProviderCapabilities } from './useProviderCapabilities';
import type { MessageWithToolCalls, ToolCallState } from '../../stores/chatStore';
import type { ContentBlock } from '@my-claudia/shared';

const EMPTY_MESSAGES: MessageWithToolCalls[] = [];
const EMPTY_TOOL_CALLS: ToolCallState[] = [];
const EMPTY_CONTENT_BLOCKS: ContentBlock[] = [];

interface UseChatSessionParams {
  sessionId: string;
  isConnected: boolean;
}

export function useChatSession({ sessionId, isConnected }: UseChatSessionParams) {
  // ── Session-scoped store selectors ──
  const sessionMessages = useChatStore((s) => s.messages[sessionId] || EMPTY_MESSAGES);
  const sessionRunId = useChatStore((s) => s.getSessionRunId(sessionId));
  const isSessionRunning = useChatStore((s) => {
    return Object.values(s.activeRuns).some((sid) => sid === sessionId);
  });
  const isLoading = useChatStore((s) => {
    const { activeRuns, backgroundRunIds } = s;
    return Object.entries(activeRuns).some(([runId, sid]) => sid === sessionId && !backgroundRunIds.has(runId));
  });
  const sessionHealth = useChatStore((s) => s.getSessionHealth(sessionId));
  const sessionToolCallsRecord = useChatStore((s) => {
    const runId = s.getSessionRunId(sessionId);
    if (!runId) return null;
    return s.activeToolCalls[runId] || null;
  });
  const sessionToolCalls = useMemo(
    () => (sessionToolCallsRecord ? Object.values(sessionToolCallsRecord) : EMPTY_TOOL_CALLS),
    [sessionToolCallsRecord]
  );
  const sessionContentBlocks = useChatStore((s) => {
    const runId = s.getSessionRunId(sessionId);
    if (!runId) return EMPTY_CONTENT_BLOCKS;
    return s.runContentBlocks[runId] || EMPTY_CONTENT_BLOCKS;
  });
  const sessionToolCallHistory = useChatStore((s) => {
    const runId = s.getSessionRunId(sessionId);
    if (!runId) return EMPTY_TOOL_CALLS;
    return s.toolCallsHistory[runId] || EMPTY_TOOL_CALLS;
  });
  const currentUsage = useChatStore((s) => s.sessionUsage[sessionId] || null);
  const currentSystemInfo = useChatStore((s) => s.systemInfoBySession[sessionId] || null);

  // Store actions
  const addMessage = useChatStore((s) => s.addMessage);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const setMode = useChatStore((s) => s.setMode);
  const selectedMode = useChatStore((s) => s.modeOverrides[sessionId] || '');
  const runtimeMode = useChatStore((s) => s.runtimeModes[sessionId] || '');
  const setModelOverride = useChatStore((s) => s.setModelOverride);
  const modelOverride = useChatStore((s) => s.modelOverrides[sessionId] || '');
  const permissionOverride = useChatStore((s) => s.getPermissionOverride(sessionId));
  const setPermissionOverride = useChatStore((s) => s.setPermissionOverride);

  // ── Derived values ──
  const useStreamingSegmented = isLoading && sessionContentBlocks.length > 1 && sessionToolCallHistory.length > 0;

  const lastSessionMessage = sessionMessages.length > 0 ? sessionMessages[sessionMessages.length - 1] : null;
  const lastStreamingBlock = sessionContentBlocks.length > 0
    ? sessionContentBlocks[sessionContentBlocks.length - 1]
    : null;
  const streamingContentSignature = lastStreamingBlock
    ? `${lastStreamingBlock.type}:${lastStreamingBlock.type === 'text' ? lastStreamingBlock.content : 'toolUseId' in lastStreamingBlock ? lastStreamingBlock.toolUseId : ''}`
    : '';

  // ── Project store ──
  const sessions = useProjectStore((s) => s.sessions);
  const projects = useProjectStore((s) => s.projects);
  const legacyProviders = useProjectStore((s) => s.providers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const scopedProviders = useProviderMetaStore((s) => s.getProviders(activeServerId));
  const providers = scopedProviders.length > 0 ? scopedProviders : legacyProviders;

  const currentSession = sessions.find(s => s.id === sessionId);
  const currentProject = currentSession
    ? projects.find(p => p.id === currentSession.projectId) ?? null
    : null;
  const isForcedPlanSession = currentSession?.projectRole === 'task' && currentSession?.planStatus === 'planning';
  const forcedMode = isForcedPlanSession ? 'plan' : '';
  // `runtimeMode` reflects provider-side transient state within the current run
  // (for example, Claude calling EnterPlanMode mid-run). It does not change the
  // actual mode that was used to start that run, nor the mode that will be used
  // for the next run. Keep the visible/send mode aligned with the configured
  // session mode so the UI does not imply stricter execution guarantees than the
  // backend is actually enforcing.
  const effectiveMode = forcedMode || selectedMode;
  const usageOrDefault = currentUsage || {
    inputTokens: 0,
    outputTokens: 0,
    latestInputTokens: 0,
    latestOutputTokens: 0,
    contextWindow: undefined
  };
  const fileReferenceRoot = currentSession?.workingDirectory || currentProject?.rootPath;

  // ── Provider capabilities ──
  const { providerId, capabilities, commands, commandsCacheKey } = useProviderCapabilities({ sessionId, isConnected });

  return {
    // Messages & run state
    sessionMessages,
    lastSessionMessage,
    sessionRunId,
    isSessionRunning,
    isLoading,
    sessionHealth,

    // Streaming / tool calls
    sessionToolCalls,
    sessionContentBlocks,
    sessionToolCallHistory,
    useStreamingSegmented,
    lastStreamingBlock,
    streamingContentSignature,

    // Session / project context
    currentSession,
    currentProject,
    providers,
    isForcedPlanSession,
    fileReferenceRoot,

    // Provider
    providerId,
    capabilities,
    commands,
    commandsCacheKey,

    // Mode / model / usage
    mode: selectedMode,
    selectedMode,
    runtimeMode,
    forcedMode,
    effectiveMode,
    modelOverride,
    permissionOverride,
    currentUsage: usageOrDefault,
    currentSystemInfo,

    // Store actions
    addMessage,
    clearMessages,
    setMode,
    setModelOverride,
    setPermissionOverride,
  };
}
