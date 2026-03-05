import { create } from 'zustand';
import type { Message, SystemInfo, UsageInfo, ContentBlock, RunHealthStatus, AgentPermissionPolicy } from '@my-claudia/shared';

interface PaginationInfo {
  total: number;
  hasMore: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  maxOffset?: number;  // Highest message offset loaded (for gap detection)
  isLoadingMore: boolean;
}

// Tool call state for displaying in the UI
export interface ToolCallState {
  id: string;            // tool_use_id
  toolName: string;
  toolInput: unknown;
  status: 'running' | 'completed' | 'error';
  result?: unknown;
  isError?: boolean;
}

// Extended message with tool calls for display
export interface MessageWithToolCalls extends Message {
  toolCalls?: ToolCallState[];
  contentBlocks?: ContentBlock[];
  clientMessageId?: string;  // Client-generated message ID for dual dedup
}

// Run health info from server heartbeat
export interface RunHealth {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  health: RunHealthStatus;
  loopPattern?: string;
}

interface ChatState {
  // Messages grouped by session ID
  messages: Record<string, MessageWithToolCalls[]>;
  // Pagination info per session
  pagination: Record<string, PaginationInfo>;
  // Active runs: runId → sessionId (supports concurrent runs)
  activeRuns: Record<string, string>;
  // Background run IDs: runs that should not affect the session's loading state
  backgroundRunIds: Set<string>;
  // Run health info from server heartbeat: runId → RunHealth
  runHealth: Record<string, RunHealth>;
  // Active tool calls per run: runId → { toolUseId → ToolCallState }
  activeToolCalls: Record<string, Record<string, ToolCallState>>;
  // Tool calls history per run: runId → ToolCallState[] (preserves order)
  toolCallsHistory: Record<string, ToolCallState[]>;
  // Content blocks per run: runId → ContentBlock[] (text/tool_use interleaved sequence)
  runContentBlocks: Record<string, ContentBlock[]>;
  // System info from Claude SDK init message, keyed by session ID
  systemInfoBySession: Record<string, SystemInfo>;
  // Mode per session (generic — permission mode for Claude, agent for OpenCode, etc.)
  modeOverrides: Record<string, string>;
  // Token usage per session (accumulated + latest run snapshot)
  sessionUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
    latestInputTokens?: number;
    latestOutputTokens?: number;
  }>;
  // Model override per session (user-selected model, empty = use default)
  modelOverrides: Record<string, string>;
  // Permission policy override per session (user-selected policy, null = use project default)
  permissionOverrides: Record<string, Partial<AgentPermissionPolicy> | null>;
  // Worktree override per session (user-selected working directory, empty = use project root)
  worktreeOverrides: Record<string, string>;
  // Input drafts per session (preserved across session switches)
  drafts: Record<string, string>;

  // Actions — Messages
  setMessages: (sessionId: string, messages: MessageWithToolCalls[], pagination?: Omit<PaginationInfo, 'isLoadingMore'>) => void;
  prependMessages: (sessionId: string, messages: MessageWithToolCalls[], pagination?: Omit<PaginationInfo, 'isLoadingMore'>) => void;
  appendMessages: (sessionId: string, messages: MessageWithToolCalls[], pagination?: Omit<PaginationInfo, 'isLoadingMore'>) => void;
  addMessage: (sessionId: string, message: MessageWithToolCalls) => void;
  updateMessageIdByClientMessageId: (sessionId: string, clientMessageId: string, newId: string) => void;
  appendToLastMessage: (sessionId: string, content: string) => void;
  clearMessages: (sessionId: string) => void;
  setLoadingMore: (sessionId: string, loading: boolean) => void;

  // Actions — Run lifecycle
  startRun: (runId: string, sessionId: string, isBackground?: boolean) => void;
  endRun: (runId: string) => void;
  updateRunHealth: (runId: string, health: RunHealth) => void;

  // Actions — Tool calls (per run)
  addToolCall: (runId: string, toolUseId: string, toolName: string, toolInput: unknown) => void;
  updateToolCallResult: (runId: string, toolUseId: string, result: unknown, isError?: boolean) => void;

  // Actions — Content blocks (per run)
  appendTextBlock: (runId: string, content: string) => void;
  addToolUseBlock: (runId: string, toolUseId: string) => void;

  // Finalize run data onto the assistant message (single atomic update)
  finalizeRunToMessage: (runId: string) => void;

  // System info actions
  setSystemInfo: (sessionId: string, info: SystemInfo) => void;
  clearSystemInfo: (sessionId: string) => void;
  getSystemInfo: (sessionId: string) => SystemInfo | null;

  // Mode actions (per session)
  setMode: (sessionId: string, mode: string) => void;
  getMode: (sessionId: string) => string;

  // Usage tracking
  addSessionUsage: (sessionId: string, usage: UsageInfo) => void;

  // Model override (per session)
  setModelOverride: (sessionId: string, model: string) => void;
  getModelOverride: (sessionId: string) => string;

  // Permission override (per session)
  setPermissionOverride: (sessionId: string, policy: Partial<AgentPermissionPolicy> | null) => void;
  getPermissionOverride: (sessionId: string) => Partial<AgentPermissionPolicy> | null;

  // Worktree override (per session)
  setWorktreeOverride: (sessionId: string, path: string) => void;
  getWorktreeOverride: (sessionId: string) => string;
  clearWorktreeOverride: (sessionId: string) => void;

  // Draft actions
  setDraft: (sessionId: string, content: string) => void;
  clearDraft: (sessionId: string) => void;

  // Getters
  getPagination: (sessionId: string) => PaginationInfo | undefined;
  isSessionLoading: (sessionId: string) => boolean;
  getSessionRunId: (sessionId: string) => string | null;
  getSessionHealth: (sessionId: string) => RunHealth | null;
  getSessionToolCalls: (sessionId: string) => ToolCallState[];
  getSessionContentBlocks: (sessionId: string) => ContentBlock[];
  getSessionToolCallHistory: (sessionId: string) => ToolCallState[];
}

const DEFAULT_PAGINATION: PaginationInfo = {
  total: 0,
  hasMore: false,
  isLoadingMore: false,
};

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  pagination: {},
  activeRuns: {},
  backgroundRunIds: new Set<string>(),
  runHealth: {},
  activeToolCalls: {},
  toolCallsHistory: {},
  runContentBlocks: {},
  systemInfoBySession: {},
  modeOverrides: {},
  sessionUsage: {},
  modelOverrides: {},
  permissionOverrides: {},
  worktreeOverrides: {},
  drafts: {},

  setMessages: (sessionId, messages, pagination) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
      pagination: pagination
        ? { ...state.pagination, [sessionId]: { ...pagination, isLoadingMore: false } }
        : state.pagination,
    })),

  prependMessages: (sessionId, newMessages, pagination) =>
    set((state) => {
      const existingMessages = state.messages[sessionId] || [];
      // Prepend new messages (older) to the beginning
      const combined = [...newMessages, ...existingMessages];

      return {
        messages: { ...state.messages, [sessionId]: combined },
        pagination: pagination
          ? { ...state.pagination, [sessionId]: { ...pagination, isLoadingMore: false } }
          : state.pagination,
      };
    }),

  appendMessages: (sessionId, newMessages, pagination) =>
    set((state) => {
      const existingMessages = state.messages[sessionId] || [];
      // Deduplicate by message ID
      const existingIds = new Set(existingMessages.map((m) => m.id));
      const deduped = newMessages.filter((m) => !existingIds.has(m.id));
      if (deduped.length === 0) return state;

      const combined = [...existingMessages, ...deduped];
      const existingPagination = state.pagination[sessionId] || DEFAULT_PAGINATION;

      return {
        messages: { ...state.messages, [sessionId]: combined },
        pagination: {
          ...state.pagination,
          [sessionId]: {
            ...existingPagination,
            // Only update forward-direction fields; preserve hasMore/oldestTimestamp
            // (those are for the "load older" direction and must not be overwritten
            // by gap-fill or sync responses)
            total: pagination?.total ?? existingPagination.total,
            newestTimestamp: pagination?.newestTimestamp ?? existingPagination.newestTimestamp,
            maxOffset: pagination?.maxOffset != null
              ? Math.max(pagination.maxOffset, existingPagination.maxOffset ?? 0)
              : existingPagination.maxOffset,
            isLoadingMore: false,
          },
        },
      };
    }),

  addMessage: (sessionId, message) =>
    set((state) => {
      const existingMessages = state.messages[sessionId] || [];
      // Dual dedup: check both server ID and client-generated message ID
      if (existingMessages.some((m) =>
        m.id === message.id ||
        (message.clientMessageId && m.clientMessageId && m.clientMessageId === message.clientMessageId)
      )) {
        return state;
      }
      const existingPagination = state.pagination[sessionId] || DEFAULT_PAGINATION;

      return {
        messages: {
          ...state.messages,
          [sessionId]: [...existingMessages, message],
        },
        pagination: {
          ...state.pagination,
          [sessionId]: {
            ...existingPagination,
            total: existingPagination.total + 1,
            newestTimestamp: message.createdAt,
          },
        },
      };
    }),

  // Update a message's server ID by matching its clientMessageId
  updateMessageIdByClientMessageId: (sessionId: string, clientMessageId: string, newId: string) =>
    set((state) => {
      const sessionMessages = state.messages[sessionId] || [];
      const idx = sessionMessages.findIndex((m) => m.clientMessageId === clientMessageId);
      if (idx === -1) return state;
      const updated = [...sessionMessages];
      updated[idx] = { ...updated[idx], id: newId };
      return { messages: { ...state.messages, [sessionId]: updated } };
    }),

  appendToLastMessage: (sessionId, content) =>
    set((state) => {
      const sessionMessages = state.messages[sessionId] || [];
      if (sessionMessages.length === 0) return state;

      const lastMessage = sessionMessages[sessionMessages.length - 1];
      if (lastMessage.role !== 'assistant') return state;

      const updatedMessages = [
        ...sessionMessages.slice(0, -1),
        { ...lastMessage, content: lastMessage.content + content },
      ];

      return {
        messages: { ...state.messages, [sessionId]: updatedMessages },
      };
    }),

  clearMessages: (sessionId) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: [] },
      pagination: { ...state.pagination, [sessionId]: DEFAULT_PAGINATION },
    })),

  setLoadingMore: (sessionId, loading) =>
    set((state) => ({
      pagination: {
        ...state.pagination,
        [sessionId]: {
          ...(state.pagination[sessionId] || DEFAULT_PAGINATION),
          isLoadingMore: loading,
        },
      },
    })),

  // ── Run lifecycle ──────────────────────────────────────────────

  startRun: (runId, sessionId, isBackground) => {
    const newBackgroundRunIds = new Set(get().backgroundRunIds);
    if (isBackground) newBackgroundRunIds.add(runId);
    set((state) => ({
      activeRuns: { ...state.activeRuns, [runId]: sessionId },
      backgroundRunIds: newBackgroundRunIds,
      activeToolCalls: { ...state.activeToolCalls, [runId]: {} },
      toolCallsHistory: { ...state.toolCallsHistory, [runId]: [] },
      runContentBlocks: { ...state.runContentBlocks, [runId]: [] },
    }));
  },

  endRun: (runId) =>
    set((state) => {
      const { [runId]: _removedRun, ...remainingRuns } = state.activeRuns;
      const { [runId]: _removedTC, ...remainingTC } = state.activeToolCalls;
      const { [runId]: _removedHist, ...remainingHist } = state.toolCallsHistory;
      const { [runId]: _removedCB, ...remainingCB } = state.runContentBlocks;
      const { [runId]: _removedHealth, ...remainingHealth } = state.runHealth;
      const newBackgroundRunIds = new Set(state.backgroundRunIds);
      newBackgroundRunIds.delete(runId);
      return {
        activeRuns: remainingRuns,
        backgroundRunIds: newBackgroundRunIds,
        activeToolCalls: remainingTC,
        toolCallsHistory: remainingHist,
        runContentBlocks: remainingCB,
        runHealth: remainingHealth,
      };
    }),

  updateRunHealth: (runId, health) =>
    set((state) => ({
      runHealth: { ...state.runHealth, [runId]: health },
    })),

  // ── Tool call actions (per run) ────────────────────────────────

  addToolCall: (runId, toolUseId, toolName, toolInput) =>
    set((state) => {
      const newToolCall: ToolCallState = {
        id: toolUseId,
        toolName,
        toolInput,
        status: 'running',
      };
      const runToolCalls = state.activeToolCalls[runId] || {};
      const runHistory = state.toolCallsHistory[runId] || [];
      return {
        activeToolCalls: {
          ...state.activeToolCalls,
          [runId]: { ...runToolCalls, [toolUseId]: newToolCall },
        },
        toolCallsHistory: {
          ...state.toolCallsHistory,
          [runId]: [...runHistory, newToolCall],
        },
      };
    }),

  updateToolCallResult: (runId, toolUseId, result, isError) =>
    set((state) => {
      const runToolCalls = state.activeToolCalls[runId];
      if (!runToolCalls) return state;
      const existing = runToolCalls[toolUseId];
      if (!existing) return state;

      const updatedToolCall = {
        ...existing,
        status: isError ? 'error' as const : 'completed' as const,
        result,
        isError,
      };

      const runHistory = state.toolCallsHistory[runId] || [];
      return {
        activeToolCalls: {
          ...state.activeToolCalls,
          [runId]: { ...runToolCalls, [toolUseId]: updatedToolCall },
        },
        toolCallsHistory: {
          ...state.toolCallsHistory,
          [runId]: runHistory.map(tc => tc.id === toolUseId ? updatedToolCall : tc),
        },
      };
    }),

  // ── Content block actions (per run) ──────────────────────────

  appendTextBlock: (runId, content) =>
    set((state) => {
      const blocks = state.runContentBlocks[runId];
      if (!blocks) return state;
      const lastBlock = blocks[blocks.length - 1];
      let updatedBlocks: ContentBlock[];
      if (lastBlock && lastBlock.type === 'text') {
        updatedBlocks = [...blocks.slice(0, -1), { type: 'text', content: lastBlock.content + content }];
      } else {
        updatedBlocks = [...blocks, { type: 'text', content }];
      }
      return {
        runContentBlocks: { ...state.runContentBlocks, [runId]: updatedBlocks },
      };
    }),

  addToolUseBlock: (runId, toolUseId) =>
    set((state) => {
      const blocks = state.runContentBlocks[runId];
      if (!blocks) return state;
      return {
        runContentBlocks: {
          ...state.runContentBlocks,
          [runId]: [...blocks, { type: 'tool_use', toolUseId }],
        },
      };
    }),

  // Finalize run data (tool calls + content blocks) onto the assistant message in one atomic update.
  // Prefers existing data when it's more complete (e.g., from API/metadata loaded before mid-stream join).
  finalizeRunToMessage: (runId) =>
    set((state) => {
      const sessionId = state.activeRuns[runId];
      if (!sessionId) return state;

      const sessionMessages = state.messages[sessionId] || [];
      if (sessionMessages.length === 0) return state;

      const lastMessage = sessionMessages[sessionMessages.length - 1];
      if (lastMessage.role !== 'assistant') return state;

      const runHistory = state.toolCallsHistory[runId] || [];
      const blocks = state.runContentBlocks[runId] || [];

      // Pick the more complete version for each field
      const existingToolCalls = lastMessage.toolCalls || [];
      const toolCalls = runHistory.length >= existingToolCalls.length ? [...runHistory] : existingToolCalls;

      const existingBlocks = lastMessage.contentBlocks || [];
      const contentBlocks = blocks.length >= existingBlocks.length ? [...blocks] : existingBlocks;

      const updatedMessages = [
        ...sessionMessages.slice(0, -1),
        { ...lastMessage, toolCalls, contentBlocks },
      ];

      return {
        messages: { ...state.messages, [sessionId]: updatedMessages },
      };
    }),

  // System info actions
  setSystemInfo: (sessionId, info) =>
    set((state) => ({
      systemInfoBySession: {
        ...state.systemInfoBySession,
        [sessionId]: info,
      },
    })),
  clearSystemInfo: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.systemInfoBySession;
      return { systemInfoBySession: rest };
    }),
  getSystemInfo: (sessionId) => get().systemInfoBySession[sessionId] || null,

  // Mode actions (per session)
  setMode: (sessionId, mode) =>
    set((state) => ({
      modeOverrides: { ...state.modeOverrides, [sessionId]: mode },
    })),
  getMode: (sessionId) => get().modeOverrides[sessionId] || '',

  // Usage tracking
  addSessionUsage: (sessionId, usage) =>
    set((state) => {
      const existing = state.sessionUsage[sessionId] || { inputTokens: 0, outputTokens: 0 };
      return {
        sessionUsage: {
          ...state.sessionUsage,
          [sessionId]: {
            inputTokens: existing.inputTokens + usage.inputTokens,
            outputTokens: existing.outputTokens + usage.outputTokens,
            contextWindow: usage.contextWindow || existing.contextWindow,
            latestInputTokens: usage.inputTokens,
            latestOutputTokens: usage.outputTokens,
          },
        },
      };
    }),

  // Model override (per session)
  setModelOverride: (sessionId, model) =>
    set((state) => ({
      modelOverrides: { ...state.modelOverrides, [sessionId]: model },
    })),
  getModelOverride: (sessionId) => get().modelOverrides[sessionId] || '',

  // Permission override (per session)
  setPermissionOverride: (sessionId, policy) =>
    set((state) => {
      if (!policy) {
        // Clear override by removing the key
        const { [sessionId]: _, ...rest } = state.permissionOverrides;
        return { permissionOverrides: rest };
      }
      return {
        permissionOverrides: { ...state.permissionOverrides, [sessionId]: policy },
      };
    }),
  getPermissionOverride: (sessionId) => get().permissionOverrides[sessionId] || null,

  // Worktree override (per session)
  setWorktreeOverride: (sessionId, path) =>
    set((state) => ({
      worktreeOverrides: { ...state.worktreeOverrides, [sessionId]: path },
    })),
  getWorktreeOverride: (sessionId) => get().worktreeOverrides[sessionId] || '',
  clearWorktreeOverride: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.worktreeOverrides;
      return { worktreeOverrides: rest };
    }),

  // Draft actions
  setDraft: (sessionId, content) =>
    set((state) => {
      if (!content) {
        const { [sessionId]: _, ...rest } = state.drafts;
        return { drafts: rest };
      }
      return { drafts: { ...state.drafts, [sessionId]: content } };
    }),

  clearDraft: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.drafts;
      return { drafts: rest };
    }),

  getPagination: (sessionId) => get().pagination[sessionId],

  isSessionLoading: (sessionId) => {
    const { activeRuns, backgroundRunIds } = get();
    return Object.entries(activeRuns).some(
      ([runId, sid]) => sid === sessionId && !backgroundRunIds.has(runId)
    );
  },

  getSessionRunId: (sessionId) => {
    const { activeRuns } = get();
    for (const [runId, sid] of Object.entries(activeRuns)) {
      if (sid === sessionId) return runId;
    }
    return null;
  },

  getSessionHealth: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return null;
    return state.runHealth[runId] || null;
  },

  getSessionToolCalls: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return Object.values(state.activeToolCalls[runId] || {});
  },

  getSessionContentBlocks: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return state.runContentBlocks[runId] || [];
  },

  getSessionToolCallHistory: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return state.toolCallsHistory[runId] || [];
  },
}));
