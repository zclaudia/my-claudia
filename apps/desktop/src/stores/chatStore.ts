import { create } from 'zustand';
import type { Message, SystemInfo, UsageInfo } from '@my-claudia/shared';

interface PaginationInfo {
  total: number;
  hasMore: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
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
}

interface ChatState {
  // Messages grouped by session ID
  messages: Record<string, MessageWithToolCalls[]>;
  // Pagination info per session
  pagination: Record<string, PaginationInfo>;
  isLoading: boolean;
  currentRunId: string | null;
  // Active tool calls for current run (keyed by tool_use_id)
  activeToolCalls: Record<string, ToolCallState>;
  // Tool calls history for current run (preserves order)
  toolCallsHistory: ToolCallState[];
  // Current system info from Claude SDK init message
  currentSystemInfo: SystemInfo | null;
  // Current mode (generic — permission mode for Claude, agent for OpenCode, etc.)
  mode: string;
  // Accumulated token usage per session
  sessionUsage: Record<string, { inputTokens: number; outputTokens: number }>;
  // Model override (user-selected model, empty = use default)
  modelOverride: string;

  // Actions
  setMessages: (sessionId: string, messages: MessageWithToolCalls[], pagination?: Omit<PaginationInfo, 'isLoadingMore'>) => void;
  prependMessages: (sessionId: string, messages: MessageWithToolCalls[], pagination?: Omit<PaginationInfo, 'isLoadingMore'>) => void;
  addMessage: (sessionId: string, message: MessageWithToolCalls) => void;
  appendToLastMessage: (sessionId: string, content: string) => void;
  clearMessages: (sessionId: string) => void;

  setLoading: (loading: boolean) => void;
  setLoadingMore: (sessionId: string, loading: boolean) => void;
  setCurrentRunId: (runId: string | null) => void;

  // Tool call actions
  addToolCall: (toolUseId: string, toolName: string, toolInput: unknown) => void;
  updateToolCallResult: (toolUseId: string, result: unknown, isError?: boolean) => void;
  clearToolCalls: () => void;
  finalizeToolCallsToMessage: (sessionId: string) => void;

  // System info actions
  setSystemInfo: (info: SystemInfo) => void;
  clearSystemInfo: () => void;

  // Mode actions
  setMode: (mode: string) => void;

  // Usage tracking
  addSessionUsage: (sessionId: string, usage: UsageInfo) => void;

  // Model override
  setModelOverride: (model: string) => void;

  // Getters
  getPagination: (sessionId: string) => PaginationInfo | undefined;
  getActiveToolCalls: () => ToolCallState[];
}

const DEFAULT_PAGINATION: PaginationInfo = {
  total: 0,
  hasMore: false,
  isLoadingMore: false,
};

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  pagination: {},
  isLoading: false,
  currentRunId: null,
  activeToolCalls: {},
  toolCallsHistory: [],
  currentSystemInfo: null,
  mode: 'default',
  sessionUsage: {},
  modelOverride: '',

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

  addMessage: (sessionId, message) =>
    set((state) => {
      const existingMessages = state.messages[sessionId] || [];
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

  setLoading: (loading) => set({ isLoading: loading }),

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

  setCurrentRunId: (runId) => set({ currentRunId: runId }),

  // Tool call actions
  addToolCall: (toolUseId, toolName, toolInput) =>
    set((state) => {
      const newToolCall: ToolCallState = {
        id: toolUseId,
        toolName,
        toolInput,
        status: 'running',
      };
      return {
        activeToolCalls: {
          ...state.activeToolCalls,
          [toolUseId]: newToolCall,
        },
        toolCallsHistory: [...state.toolCallsHistory, newToolCall],
      };
    }),

  updateToolCallResult: (toolUseId, result, isError) =>
    set((state) => {
      const existing = state.activeToolCalls[toolUseId];
      if (!existing) return state;

      const updatedToolCall = {
        ...existing,
        status: isError ? 'error' as const : 'completed' as const,
        result,
        isError,
      };

      return {
        activeToolCalls: {
          ...state.activeToolCalls,
          [toolUseId]: updatedToolCall,
        },
        // Also update in history
        toolCallsHistory: state.toolCallsHistory.map(tc =>
          tc.id === toolUseId ? updatedToolCall : tc
        ),
      };
    }),

  clearToolCalls: () => set({ activeToolCalls: {}, toolCallsHistory: [] }),

  // Finalize tool calls by attaching them to the last assistant message
  finalizeToolCallsToMessage: (sessionId) =>
    set((state) => {
      const sessionMessages = state.messages[sessionId] || [];
      if (sessionMessages.length === 0 || state.toolCallsHistory.length === 0) return state;

      const lastMessage = sessionMessages[sessionMessages.length - 1];
      if (lastMessage.role !== 'assistant') return state;

      const updatedMessages = [
        ...sessionMessages.slice(0, -1),
        { ...lastMessage, toolCalls: [...state.toolCallsHistory] },
      ];

      return {
        messages: { ...state.messages, [sessionId]: updatedMessages },
        activeToolCalls: {},
        toolCallsHistory: [],
      };
    }),

  // System info actions
  setSystemInfo: (info) => set({ currentSystemInfo: info }),
  clearSystemInfo: () => set({ currentSystemInfo: null }),

  // Mode actions
  setMode: (mode) => set({ mode }),

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
          },
        },
      };
    }),

  // Model override
  setModelOverride: (model) => set({ modelOverride: model }),

  getPagination: (sessionId) => get().pagination[sessionId],

  getActiveToolCalls: () => Object.values(get().activeToolCalls),
}));
