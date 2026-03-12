import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Loader2, AlertTriangle, ClipboardList, ArrowDown, ArrowLeft, X, FileText, Terminal as TerminalIcon, ChevronDown, ChevronUp, Lock, Unlock, Archive, RotateCcw, Download, MoreHorizontal, ExternalLink } from 'lucide-react';
import { MessageList } from './MessageList';
import { MessageInput, type Attachment } from './MessageInput';
import { ToolCallList } from './ToolCallItem';
import { LoadingIndicator } from './LoadingIndicator';
import { InlinePermissionRequest } from './InlinePermissionRequest';
import { InlineAskUserQuestion } from './InlineAskUserQuestion';
import { useFilePushStore } from '../../stores/filePushStore';
import { ModeSelector } from './ModeSelector';
import { SystemInfoButton } from './SystemInfoButton';
import { ModelSelector } from './ModelSelector';
import { PermissionSelector } from './PermissionSelector';
import { WorktreeSelector } from './WorktreeSelector';
import { TokenUsageDisplay } from './TokenUsageDisplay';
import { BottomPanel } from '../BottomPanel';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useUIStore } from '../../stores/uiStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useAskUserQuestionStore } from '../../stores/askUserQuestionStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import * as api from '../../services/api';
import { uploadFile } from '../../services/fileUpload';
import { TaskCardStrip } from '../supervision/TaskCardStrip';
import { BackgroundTaskPanel } from '../BackgroundTaskPanel';
import { DraftEditorModal } from './DraftEditorModal';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import type { AgentPermissionPolicy, CommandExecuteResponse, Message, MessageAttachment, MessageInput as MessageInputData, ProviderCapabilities, SlashCommand } from '@my-claudia/shared';
import type { MessageWithToolCalls } from '../../stores/chatStore';

const isDesktopTauri = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && !navigator.userAgent.includes('Android');

// True when this window was opened as a standalone session window (no pop-out needed)
const isStandaloneSessionWindow = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('sessionWindow');

// Restore tool calls and content blocks from persisted metadata when loading messages from the server
function restoreToolCalls(messages: Message[]): MessageWithToolCalls[] {
  return messages.map(msg => {
    const result: MessageWithToolCalls = { ...msg };
    if (msg.metadata?.toolCalls && msg.metadata.toolCalls.length > 0) {
      result.toolCalls = msg.metadata.toolCalls.map((tc, i) => ({
        id: tc.toolUseId || `persisted-${msg.id}-${i}`,
        toolName: tc.name,
        toolInput: tc.input,
        status: tc.isError ? 'error' as const : 'completed' as const,
        result: tc.output,
        isError: tc.isError,
      }));
    }
    if (msg.metadata?.contentBlocks && msg.metadata.contentBlocks.length > 0) {
      result.contentBlocks = msg.metadata.contentBlocks;
    }
    return result;
  });
}

interface ChatInterfaceProps {
  sessionId: string;
  onReturnToDashboard?: (projectId: string) => void;
}

const MESSAGES_PER_PAGE = 50;
const BOTTOM_REFRESH_LIMIT = 12;
const BOTTOM_REFRESH_COOLDOWN_MS = 2500;
const SUPPRESS_LOAD_MORE_MS = 1200;
const EMPTY_MESSAGES: MessageWithToolCalls[] = [];
const EMPTY_TOOL_CALLS: import('../../stores/chatStore').ToolCallState[] = [];
const EMPTY_CONTENT_BLOCKS: import('@my-claudia/shared').ContentBlock[] = [];
const ATTACHMENT_PLACEHOLDER = '[Attachments]';

export function ChatInterface({ sessionId, onReturnToDashboard }: ChatInterfaceProps) {
  const messages = useChatStore((s) => s.messages);
  const pagination = useChatStore((s) => s.pagination);
  const activeRuns = useChatStore((s) => s.activeRuns);
  const backgroundRunIds = useChatStore((s) => s.backgroundRunIds);
  const runHealth = useChatStore((s) => s.runHealth);
  const activeToolCalls = useChatStore((s) => s.activeToolCalls);
  const runContentBlocks = useChatStore((s) => s.runContentBlocks);
  const toolCallsHistory = useChatStore((s) => s.toolCallsHistory);
  const addMessage = useChatStore((s) => s.addMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const prependMessages = useChatStore((s) => s.prependMessages);
  const appendMessages = useChatStore((s) => s.appendMessages);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const setLoadingMore = useChatStore((s) => s.setLoadingMore);
  const setMode = useChatStore((s) => s.setMode);
  const getMode = useChatStore((s) => s.getMode);
  const getSystemInfo = useChatStore((s) => s.getSystemInfo);
  const sessionUsage = useChatStore((s) => s.sessionUsage);
  const setModelOverride = useChatStore((s) => s.setModelOverride);
  const getModelOverride = useChatStore((s) => s.getModelOverride);
  const sessionRunId = useMemo(() => {
    for (const [runId, sid] of Object.entries(activeRuns)) {
      if (sid === sessionId) return runId;
    }
    return null;
  }, [activeRuns, sessionId]);
  const isSessionRunning = useMemo(
    () => Object.values(activeRuns).some((sid) => sid === sessionId),
    [activeRuns, sessionId]
  );
  // Only show loading/toolCalls for THIS session's active run
  const isLoading = useMemo(
    () => Object.entries(activeRuns).some(([runId, sid]) => sid === sessionId && !backgroundRunIds.has(runId)),
    [activeRuns, backgroundRunIds, sessionId]
  );
  const sessionHealth = sessionRunId ? (runHealth[sessionRunId] || null) : null;
  const sessionToolCalls = useMemo(
    () => (sessionRunId ? Object.values(activeToolCalls[sessionRunId] || {}) : EMPTY_TOOL_CALLS),
    [sessionRunId, activeToolCalls]
  );
  const sessionContentBlocks = sessionRunId ? (runContentBlocks[sessionRunId] || EMPTY_CONTENT_BLOCKS) : EMPTY_CONTENT_BLOCKS;
  const sessionToolCallHistory = sessionRunId ? (toolCallsHistory[sessionRunId] || EMPTY_TOOL_CALLS) : EMPTY_TOOL_CALLS;
  const useStreamingSegmented = isLoading && sessionContentBlocks.length > 1 && sessionToolCallHistory.length > 0;
  const mode = getMode(sessionId);
  const modelOverride = getModelOverride(sessionId);
  const permissionOverride = useChatStore((s) => s.getPermissionOverride(sessionId));
  const setPermissionOverride = useChatStore((s) => s.setPermissionOverride);
  const { projects, sessions, providers, providerCommands, providerCapabilities, setProviderCapabilities } = useProjectStore();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const { setDrawerOpen, drawerOpen, bottomPanelTab, setBottomPanelTab } = useTerminalStore();
  const {
    advancedInput,
    setAdvancedInput,
    forceScrollToBottomSessionId,
    consumeForceScrollToBottom,
    poppedOutSessions,
    addPoppedOutSession,
    removePoppedOutSession,
  } = useUIStore();
  const { isOpen: fileViewerOpen } = useFileViewerStore();
  const { sendMessage: wsSendMessage, isConnected, handlePermissionDecision, handleAskUserAnswer } = useConnection();
  const isMobile = useIsMobile();
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Draft editor state
  const draftEditorOpen = useDraftEditorStore((s) => s.isEditorOpen);
  const draftShowLockPrompt = useDraftEditorStore((s) => s.showLockPrompt);
  const draftExists = useDraftEditorStore((s) => s.draftExists[sessionId] ?? false);
  const openDraftEditor = useDraftEditorStore((s) => s.openEditor);
  const checkDraftExists = useDraftEditorStore((s) => s.checkDraftExists);

  // Check draft existence when entering session
  useEffect(() => {
    checkDraftExists(sessionId);
  }, [sessionId, checkDraftExists]);

  // Per-session pending permission/question requests
  // Also include requests without sessionId (backward compat with servers that haven't been updated)
  const permissionRequests = usePermissionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
  const askUserRequests = useAskUserQuestionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRefreshRef = useRef<{ lastAt: number; inFlight: boolean }>({ lastAt: 0, inFlight: false });
  const lastScrollTopRef = useRef(0);
  const suppressLoadMoreUntilRef = useRef<number>(0);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, viewportHeight: 0 });
  const [initialDraft, setInitialDraft] = useState<string | undefined>(undefined);

  // State for restoring message after cancel
  const [lastSentMessage, setLastSentMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resendChecking, setResendChecking] = useState(false);
  // Queued message: when user sends while a run is active, queue it for auto-send
  const [queuedMessage, setQueuedMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [taskPlanStatus, setTaskPlanStatus] = useState<api.TaskPlanStatus | null>(null);
  const [planStatusLoading, setPlanStatusLoading] = useState(false);
  const [submitPlanLoading, setSubmitPlanLoading] = useState(false);
  const [discardPlanLoading, setDiscardPlanLoading] = useState(false);

  // Session action bar state
  const [isRenamingSession, setIsRenamingSession] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const sessionMessages = messages[sessionId] || EMPTY_MESSAGES;
  const lastSessionMessage = sessionMessages.length > 0 ? sessionMessages[sessionMessages.length - 1] : null;
  const resendTargetMessage = useMemo(() => {
    if (!lastSessionMessage || lastSessionMessage.role !== 'user' || isSessionRunning) {
      return null;
    }
    return lastSessionMessage;
  }, [lastSessionMessage, isSessionRunning]);
  const resendText = useMemo(() => {
    if (!resendTargetMessage) return null;
    const raw = (resendTargetMessage.content || '').trim();
    if (!raw || raw === ATTACHMENT_PLACEHOLDER) return null;
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        const text = parsed.text.trim();
        return text || null;
      }
    } catch {
      // Plain text fallback
    }
    return raw;
  }, [resendTargetMessage]);
  // Get current session and project to determine provider
  const currentSession = sessions.find(s => s.id === sessionId);
  const currentProject = currentSession
    ? projects.find(p => p.id === currentSession.projectId)
    : null;
  const isForcedPlanSession = currentSession?.projectRole === 'task' && currentSession?.planStatus === 'planning';
  const sessionPagination = pagination[sessionId];
  const hasSessionSnapshot = !!sessionPagination;
  const isInitialMessageLoading = !loadError && (!initialLoadDone || !hasSessionSnapshot);
  const currentSystemInfo = getSystemInfo(sessionId);
  const currentUsage = sessionUsage[sessionId] || {
    inputTokens: 0,
    outputTokens: 0,
    latestInputTokens: 0,
    latestOutputTokens: 0,
    contextWindow: undefined
  };
  const fileReferenceRoot = currentSession?.workingDirectory || currentProject?.rootPath;

  // Reset per-session ephemeral state when switching sessions
  useEffect(() => {
    setLastSentMessage(null);
    setRestoreMessage(null);
    setUploadError(null);
    setLoadError(null);
    setResendChecking(false);
    setQueuedMessage(null);
    setScrollMetrics({ scrollTop: 0, viewportHeight: 0 });
    setInitialDraft(useChatStore.getState().drafts[sessionId]);
    bottomRefreshRef.current = { lastAt: 0, inFlight: false };
    lastScrollTopRef.current = 0;
    setIsRenamingSession(false);
    setRenameValue('');
  }, [sessionId]);

  // Task planning sessions are hard-locked to Plan mode.
  useEffect(() => {
    if (isForcedPlanSession && mode !== 'plan') {
      setMode(sessionId, 'plan');
    }
  }, [isForcedPlanSession, mode, sessionId, setMode]);

  // Auto-check plan document completeness during task planning.
  useEffect(() => {
    const taskId = currentSession?.taskId;
    if (!isConnected || !isForcedPlanSession || !taskId) {
      setTaskPlanStatus(null);
      return;
    }

    let cancelled = false;
    setPlanStatusLoading(true);
    api.getTaskPlanStatus(taskId)
      .then((status) => {
        if (!cancelled) setTaskPlanStatus(status);
      })
      .catch(() => {
        if (!cancelled) setTaskPlanStatus(null);
      })
      .finally(() => {
        if (!cancelled) setPlanStatusLoading(false);
      });

    return () => { cancelled = true; };
  }, [isConnected, isForcedPlanSession, currentSession?.taskId, sessionMessages.length]);

  // Auto-send queued message when the current run finishes
  const queuedMessageRef = useRef(queuedMessage);
  queuedMessageRef.current = queuedMessage;
  useEffect(() => {
    if (!isLoading && isConnected && queuedMessageRef.current) {
      const { content, attachments } = queuedMessageRef.current;
      setQueuedMessage(null);
      // Use setTimeout to avoid calling handleSendMessage during render
      setTimeout(() => handleSendMessage(content, attachments), 0);
    }
  }, [isLoading, isConnected]);


  // Ctrl+` keyboard shortcut to toggle terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`' && currentSession?.projectId) {
        e.preventDefault();
        const store = useTerminalStore.getState();
        const pid = currentSession.projectId;
        if (store.isDrawerOpen(pid) && store.bottomPanelTab === 'terminal') {
          store.setDrawerOpen(pid, false);
        } else if (store.isDrawerOpen(pid)) {
          store.setBottomPanelTab('terminal');
        } else {
          if (!store.terminals[pid]) {
            store.openTerminal(pid);
          }
          store.setDrawerOpen(pid, true);
          store.setBottomPanelTab('terminal');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentSession?.projectId]);

  // Cmd+P / Ctrl+P keyboard shortcut to open file search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && currentProject?.rootPath) {
        e.preventDefault();
        const store = useFileViewerStore.getState();
        if (!store.isOpen) {
          store.togglePanel();
        }
        store.setSearchOpen(true);
        useTerminalStore.getState().setBottomPanelTab('file');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentProject?.rootPath]);

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  }, []);

  const jumpToBottomInstant = useCallback(() => {
    suppressLoadMoreUntilRef.current = Date.now() + SUPPRESS_LOAD_MORE_MS;
    scrollToBottom(true);
  }, [scrollToBottom]);

  // Sync filePush metadata from loaded messages into filePushStore for download tracking
  const syncFilePushMessages = useCallback((msgs: MessageWithToolCalls[]) => {
    const fpStore = useFilePushStore.getState();
    for (const msg of msgs) {
      if (msg.metadata?.filePush) {
        const fp = msg.metadata.filePush;
        fpStore.addItem({
          fileId: fp.fileId,
          fileName: fp.fileName,
          mimeType: fp.mimeType,
          fileSize: fp.fileSize,
          sessionId: msg.sessionId,
          description: fp.description,
          autoDownload: false, // Don't auto-download for history messages
        });
      }
    }
  }, []);

  // Load messages with pagination (all via HTTP)
  const loadMessages = useCallback(async (before?: number) => {
    try {
      if (before) {
        // Load more (older messages)
        setLoadingMore(sessionId, true);

        const result = await api.getSessionMessages(sessionId, {
          limit: MESSAGES_PER_PAGE,
          before
        });

        const restoredOlder = restoreToolCalls(result.messages);
        prependMessages(sessionId, restoredOlder, result.pagination);
        // Sync filePush messages to filePushStore for download state tracking
        syncFilePushMessages(restoredOlder);
      } else {
        // Initial load via HTTP
        if (!isConnected) {
          console.warn('Cannot load messages: not connected');
          setMessages(sessionId, [], { total: 0, hasMore: false });
          setInitialLoadDone(true);
          return;
        }

        setLoadError(null);
        const result = await api.getSessionMessages(sessionId, {
          limit: MESSAGES_PER_PAGE
        });

        const restoredMessages = restoreToolCalls(result.messages);
        setMessages(sessionId, restoredMessages, result.pagination);
        // Sync filePush messages to filePushStore for download state tracking
        syncFilePushMessages(restoredMessages);

        // Restore active run state (fixes loading state lost after page refresh)
        if (result.activeRun) {
          const chatState = useChatStore.getState();
          if (!chatState.activeRuns[result.activeRun.runId]) {
            chatState.startRun(result.activeRun.runId, sessionId);
          }
        }

        setInitialLoadDone(true);
        // Scroll to bottom on initial load - use instant to avoid visible scroll animation
        setTimeout(() => scrollToBottom(true), 0);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      setLoadingMore(sessionId, false);
      // On error, set empty messages to prevent undefined
      if (!before) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        // Detect common error patterns for user-friendly messages
        const isTimeout = errMsg.includes('timed out') || errMsg.includes('timeout') || errMsg.includes('TIMEOUT');
        const isOffline = errMsg.includes('BACKEND_OFFLINE') || errMsg.includes('502') || errMsg.includes('Failed to fetch');
        const friendlyMsg = isOffline
          ? 'Backend is offline. This session may belong to a server that is currently unreachable.'
          : isTimeout
          ? 'Request timed out. The backend server may be unresponsive.'
          : `Failed to load messages: ${errMsg}`;
        setLoadError(friendlyMsg);
        setMessages(sessionId, [], { total: 0, hasMore: false });
        setInitialLoadDone(true);
      }
    }
  }, [sessionId, setLoadingMore, prependMessages, setMessages, scrollToBottom, isConnected, syncFilePushMessages]);

  // Load initial messages when session changes
  useEffect(() => {
    setInitialLoadDone(false);
    loadMessages();
  }, [sessionId, loadMessages]);

  // One-shot jump: when entering from Active Sessions, force scroll to latest content.
  useEffect(() => {
    if (forceScrollToBottomSessionId !== sessionId || !initialLoadDone) return;
    scrollToBottom(true);
    const timer = setTimeout(() => scrollToBottom(true), 120);
    consumeForceScrollToBottom(sessionId);
    return () => clearTimeout(timer);
  }, [forceScrollToBottomSessionId, sessionId, initialLoadDone, scrollToBottom, consumeForceScrollToBottom]);

  // Load more messages (older)
  const loadMoreMessages = useCallback(async () => {
    if (!sessionPagination?.hasMore || sessionPagination?.isLoadingMore) {
      console.debug(`[ChatInterface] loadMoreMessages skipped: hasMore=${sessionPagination?.hasMore}, isLoadingMore=${sessionPagination?.isLoadingMore}`);
      return;
    }

    const oldestTimestamp = sessionPagination?.oldestTimestamp;
    if (!oldestTimestamp) {
      console.debug('[ChatInterface] loadMoreMessages skipped: no oldestTimestamp');
      return;
    }
    console.debug(`[ChatInterface] loadMoreMessages: loading before=${oldestTimestamp}`);

    // Save scroll position before loading
    const container = messagesContainerRef.current;
    const scrollHeightBefore = container?.scrollHeight || 0;

    await loadMessages(oldestTimestamp);

    // Restore scroll position after loading
    if (container) {
      const scrollHeightAfter = container.scrollHeight;
      container.scrollTop = scrollHeightAfter - scrollHeightBefore;
    }
  }, [loadMessages, sessionPagination]);

  // Fallback sync: when user is already at bottom and keeps scrolling down,
  // fetch a small latest window to recover from delayed/missed push updates.
  const refreshLatestMessagesFromBottom = useCallback(async () => {
    if (!isConnected || !initialLoadDone) return;
    const state = bottomRefreshRef.current;
    const now = Date.now();
    if (state.inFlight || now - state.lastAt < BOTTOM_REFRESH_COOLDOWN_MS) return;

    state.inFlight = true;
    state.lastAt = now;
    try {
      const result = await api.getSessionMessages(sessionId, { limit: BOTTOM_REFRESH_LIMIT });
      const restored = restoreToolCalls(result.messages);
      appendMessages(sessionId, restored, result.pagination);
      syncFilePushMessages(restored);
    } catch (error) {
      console.debug('[ChatInterface] bottom refresh failed:', error);
    } finally {
      state.inFlight = false;
    }
  }, [appendMessages, initialLoadDone, isConnected, sessionId, syncFilePushMessages]);

  const handleMessageWheel = useCallback((deltaY: number) => {
    if (deltaY <= 0) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= 24) {
      void refreshLatestMessagesFromBottom();
    }
  }, [refreshLatestMessagesFromBottom]);

  // Handle scroll to detect when user scrolls near top or away from bottom
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const currentScrollTop = container.scrollTop;
    const wasScrollingDown = currentScrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    setScrollMetrics({
      scrollTop: currentScrollTop,
      viewportHeight: container.clientHeight,
    });

    // If scrolled near top (within 100px), load more messages.
    // During jump-to-bottom, suppress this to avoid fighting the programmatic scroll.
    const suppressLoadMore = Date.now() < suppressLoadMoreUntilRef.current;
    if (!suppressLoadMore && currentScrollTop < 100 && sessionPagination?.hasMore && !sessionPagination?.isLoadingMore) {
      loadMoreMessages();
    }

    // Show scroll-to-bottom button when not near the bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 300);
    // Mobile-safe fallback: touch scrolling won't fire wheel events.
    if (wasScrollingDown && distanceFromBottom <= 24) {
      void refreshLatestMessagesFromBottom();
    }
  }, [loadMoreMessages, refreshLatestMessagesFromBottom, sessionPagination]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const updateMetrics = () => {
      setScrollMetrics({
        scrollTop: container.scrollTop,
        viewportHeight: container.clientHeight,
      });
    };

    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    return () => window.removeEventListener('resize', updateMetrics);
  }, [sessionId, initialLoadDone]);

  // Derive provider ID and fetch capabilities when it changes
  const providerId = currentSession?.providerId || currentProject?.providerId;
  // Scope provider caches by active server/backend to avoid cross-backend contamination.
  const providerScopeKey = activeServerId || 'local';
  // Cache key: use providerId if set, otherwise '_default' for Claude defaults
  const capsCacheKey = `${providerScopeKey}:${providerId || '_default'}`;
  const commandsCacheKey = `${providerScopeKey}:${providerId || '_default'}`;

  // Fetch commands when provider or project changes (via HTTP)
  useEffect(() => {
    const projectRoot = currentProject?.rootPath;

    if (!isConnected) {
      return;
    }

    if (providerId) {
      // Load commands for the specific provider
      api.getProviderCommands(providerId, projectRoot || undefined)
        .then(commands => {
          useProjectStore.getState().setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          console.error('Failed to load provider commands:', err);
        });
    } else {
      // No provider configured — load default commands by type
      api.getProviderTypeCommands('claude', projectRoot || undefined)
        .then(commands => {
          useProjectStore.getState().setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          console.error('Failed to load default commands:', err);
        });
    }
  }, [currentSession?.providerId, currentProject?.providerId, currentProject?.rootPath, isConnected, commandsCacheKey]);

  useEffect(() => {
    if (!isConnected) return;
    // Skip if already cached
    if (providerCapabilities[capsCacheKey]) return;

    const fetchCaps = providerId
      ? api.getProviderCapabilities(providerId)
      : api.getProviderTypeCapabilities('claude');

    fetchCaps
      .then(caps => {
        setProviderCapabilities(capsCacheKey, caps);
        // Set default mode for this session if not already set
        if (caps.defaultModeId && !useChatStore.getState().getMode(sessionId)) {
          useChatStore.getState().setMode(sessionId, caps.defaultModeId);
        }
      })
      .catch(err => {
        console.error('Failed to load provider capabilities:', err);
      });
  }, [capsCacheKey, providerId, isConnected, providerCapabilities, setProviderCapabilities]);

  const capabilities: ProviderCapabilities | null = providerCapabilities[capsCacheKey] || null;

  // Get commands for current provider within current server/backend scope,
  // and append local-only helper commands that are handled in ChatInterface.
  const commands = useMemo<SlashCommand[]>(() => {
    const base = providerCommands[commandsCacheKey] || [];
    const extras: SlashCommand[] = [
      {
        command: '/new-cli-session',
        description: 'Reset underlying provider session (next message starts a fresh CLI session)',
        source: 'local',
      },
      {
        command: '/reset-cli-session',
        description: 'Alias of /new-cli-session',
        source: 'local',
      },
    ];

    const seen = new Set(base.map((c) => c.command));
    const merged = [...base];
    for (const cmd of extras) {
      if (!seen.has(cmd.command)) merged.push(cmd);
    }
    return merged;
  }, [providerCommands, commandsCacheKey]);

  // Scroll to bottom when new messages arrive (but not when loading history)
  useEffect(() => {
    if (initialLoadDone && sessionMessages.length > 0) {
      const container = messagesContainerRef.current;
      if (!container) return;

      // Only auto-scroll if user is near the bottom
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        scrollToBottom();
      }
    }
  }, [sessionMessages.length, initialLoadDone]);

  // Scroll to bottom when tool calls are updated (during streaming)
  useEffect(() => {
    if (initialLoadDone && sessionToolCalls.length > 0) {
      const container = messagesContainerRef.current;
      if (!container) return;

      // Only auto-scroll if user is near the bottom
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        scrollToBottom();
      }
    }
  }, [sessionToolCalls, initialLoadDone, scrollToBottom]);

  const handleSendMessage = async (content: string, attachments?: Attachment[]) => {
    if (!content.trim() && !attachments?.length) return;

    // Cold-start / reconnect: queue first message and auto-send once connected.
    if (!isConnected) {
      setQueuedMessage({ content, attachments });
      return;
    }

    // If a run is active, queue the message for auto-send after the run finishes
    if (isLoading) {
      setQueuedMessage({ content, attachments });
      return;
    }

    // Save the message for potential restore after cancel
    setLastSentMessage({ content, attachments });
    // Clear any previous restore/error state
    setRestoreMessage(null);
    setUploadError(null);

    // Upload files first and get fileIds
    let uploadedAttachments: MessageAttachment[] = [];

    if (attachments && attachments.length > 0) {
      try {
        // Upload all attachments
        for (const attachment of attachments) {
          // Convert data URL to Blob
          const blob = await (await fetch(attachment.data)).blob();
          const file = new File([blob], attachment.name, { type: attachment.mimeType });

          // Upload and get fileId
          const uploaded = await uploadFile(file);
          uploadedAttachments.push({
            fileId: uploaded.fileId,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            type: attachment.type
          });
        }
      } catch (error) {
        console.error('Failed to upload attachments:', error);
        setUploadError(error instanceof Error ? error.message : 'Failed to upload file');
        return;
      }
    }

    // Build structured message input
    const messageInput: MessageInputData = {
      text: content,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined
    };

    // Serialize for transmission
    const fullContent = JSON.stringify(messageInput);

    // Use a single ID for both local message and server request (dual dedup)
    const clientMessageId = crypto.randomUUID();

    // Add user message to local state
    addMessage(sessionId, {
      id: clientMessageId,
      clientMessageId,
      sessionId,
      role: 'user',
      content: content || '[Attachments]',
      createdAt: Date.now(),
    });

    // Send to server via WebSocket (clientRequestId = clientMessageId for correlation)
    const runStartMsg = {
      type: 'run_start' as const,
      clientRequestId: clientMessageId,
      sessionId,
      input: fullContent,
      mode: mode || undefined,
      model: modelOverride || undefined,
      permissionOverride: permissionOverride || undefined,
      workingDirectory: currentSession?.workingDirectory || undefined,
    };
    console.log('[ChatInterface] run_start:', { sessionId, mode: runStartMsg.mode, model: runStartMsg.model, workingDirectory: runStartMsg.workingDirectory });
    await startRun(runStartMsg);

    // Scroll to bottom after sending
    setTimeout(() => scrollToBottom(), 100);
  };

  const handleResendLastMessage = useCallback(async () => {
    if (!resendText) return;
    setResendChecking(true);
    try {
      const runState = await api.getSessionRunState(sessionId);
      if (runState.isRunning) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Cannot resend yet: session is still running${runState.activeRunId ? ` (${runState.activeRunId})` : ''}.`,
          createdAt: Date.now(),
        });
        return;
      }
      // Resend: reuse the existing user message — just start a new run with resend flag
      // so the server skips inserting a duplicate user message
      const messageInput: MessageInputData = { text: resendText };
      await startRun({
        type: 'run_start',
        clientRequestId: crypto.randomUUID(),
        sessionId,
        input: JSON.stringify(messageInput),
        resend: true,
        mode: mode || undefined,
        model: modelOverride || undefined,
        permissionOverride: permissionOverride || undefined,
        workingDirectory: currentSession?.workingDirectory || undefined,
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Resend preflight failed:', error);
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: 'Resend preflight failed. Please try again.',
        createdAt: Date.now(),
      });
    } finally {
      setResendChecking(false);
    }
  }, [resendText, sessionId, addMessage, wsSendMessage, mode, modelOverride, permissionOverride, currentSession, scrollToBottom]);

  // Handle built-in command response
  const handleBuiltInCommand = useCallback((result: CommandExecuteResponse) => {
    const { action, data, command: cmdName } = result;

    switch (action) {
      case 'clear':
        clearMessages(sessionId);
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || 'Chat history cleared.',
          createdAt: Date.now(),
        });
        break;

      case 'help':
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.content as string) || 'No help available.',
          createdAt: Date.now(),
        });
        break;

      case 'status': {
        let statusText = '**System Status:**\n\n';
        if (data?.version) statusText += `- **Version:** ${data.version}\n`;
        if (data?.uptime) statusText += `- **Server Uptime:** ${data.uptime}\n`;
        if (data?.model) statusText += `- **Model:** ${data.model}\n`;
        if (data?.provider) statusText += `- **Provider:** ${data.provider}\n`;
        if (data?.nodeVersion) statusText += `- **Node.js:** ${data.nodeVersion}\n`;
        if (data?.platform) statusText += `- **Platform:** ${data.platform}\n`;
        if (data?.projectPath) statusText += `- **Project:** ${data.projectPath}\n`;

        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: statusText,
          createdAt: Date.now(),
        });
        break;
      }

      case 'cost': {
        const usage = data?.tokenUsage as { used: number; total: number; percentage: string } | undefined;
        let costText = '**Token Usage:**\n\n';
        if (usage) {
          costText += `- **Used:** ${usage.used.toLocaleString()} tokens\n`;
          costText += `- **Total:** ${usage.total.toLocaleString()} tokens\n`;
          costText += `- **Usage:** ${usage.percentage}%\n`;
        }
        if (data?.model) {
          costText += `- **Model:** ${data.model}\n`;
        }

        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: costText,
          createdAt: Date.now(),
        });
        break;
      }

      case 'memory': {
        const memoryData = data as { path?: string; exists?: boolean; message?: string; error?: boolean } | undefined;
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: memoryData?.message || 'CLAUDE.md information not available.',
          createdAt: Date.now(),
        });
        break;
      }

      case 'model': {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || `Model: ${data?.model || 'unknown'}\nProvider: ${data?.provider || 'unknown'}`,
          createdAt: Date.now(),
        });
        break;
      }

      case 'config':
        // TODO: Open settings modal
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || 'Opening settings...',
          createdAt: Date.now(),
        });
        break;

      case 'new-session':
        // TODO: Create new session
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || 'Creating new session...',
          createdAt: Date.now(),
        });
        break;

      case 'reload':
        // Re-fetch commands from server (cache already cleared server-side)
        (providerId
          ? api.getProviderCommands(providerId, currentProject?.rootPath || undefined)
          : api.getProviderTypeCommands('claude', currentProject?.rootPath || undefined)
        )
          .then(cmds => {
            useProjectStore.getState().setProviderCommands(commandsCacheKey, cmds);
            addMessage(sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              role: 'system',
              content: `Commands reloaded (${cmds.length} commands)`,
              createdAt: Date.now(),
            });
            setTimeout(() => scrollToBottom(), 100);
          })
          .catch(err => {
            addMessage(sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              role: 'system',
              content: `Failed to reload commands: ${err.message}`,
              createdAt: Date.now(),
            });
          });
        return; // Skip the scrollToBottom below since we handle it in the .then

      case 'show_panel': {
        // Plugin command: open the panel in the bottom drawer
        const panelId = data?.panelId as string | undefined;
        if (panelId && currentProject?.id) {
          setDrawerOpen(currentProject.id, true);
          setBottomPanelTab(`plugin:${panelId}`);
        }
        break;
      }

      default:
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Command ${cmdName} executed.`,
          createdAt: Date.now(),
        });
    }

    // Scroll to bottom after command output
    setTimeout(() => scrollToBottom(), 100);
  }, [sessionId, clearMessages, addMessage, scrollToBottom, providerId, currentProject?.rootPath, commandsCacheKey, currentProject?.id, setDrawerOpen, setBottomPanelTab]);

  const handleWorktreeChange = useCallback(async (worktreePath: string) => {
    if (isForcedPlanSession) {
      throw new Error('Worktree switching is locked during Supervisor planning mode.');
    }
    // 乐观更新 projectStore（立即反映在 UI）
    useProjectStore.getState().updateSession(sessionId, {
      workingDirectory: worktreePath || undefined,
    });
    // 持久化到 DB
    try {
      await api.updateSessionWorkingDirectory(sessionId, worktreePath);
    } catch (err) {
      console.error('[Worktree] Failed to persist working directory:', err);
    }
  }, [isForcedPlanSession, sessionId]);

  const handleResetProviderSession = useCallback(async () => {
    try {
      await api.resetSessionSdkSession(sessionId);
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: 'Underlying CLI session reset. The next message will start a new provider-side session.',
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (err) {
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to reset CLI session: ${(err as Error).message}`,
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [addMessage, scrollToBottom, sessionId]);

  const clearInterruptedStatus = useCallback(async () => {
    if (currentSession?.lastRunStatus !== 'interrupted') return;

    useProjectStore.getState().updateSession(sessionId, { lastRunStatus: null });

    try {
      await api.dismissInterrupted(sessionId);
    } catch (error) {
      console.warn('[ChatInterface] Failed to persist interrupted status dismissal:', error);
    }
  }, [currentSession?.lastRunStatus, sessionId]);

  const startRun = useCallback(async (runStartMsg: {
    type: 'run_start';
    clientRequestId: string;
    sessionId: string;
    input: string;
    resend?: boolean;
    mode?: string;
    model?: string;
    permissionOverride?: Partial<AgentPermissionPolicy>;
    workingDirectory?: string;
  }) => {
    await clearInterruptedStatus();
    wsSendMessage(runStartMsg);
  }, [clearInterruptedStatus, wsSendMessage]);

  const handleCommand = useCallback(async (command: string, args: string) => {
    // Find the command definition to check its source
    const commandDef = commands.find(c => c.command === command);

    // Handle /help locally with dynamic command list
    if (command === '/help') {
      const grouped: Record<string, typeof commands> = {};
      for (const cmd of commands) {
        const label = cmd.source === 'local' ? 'Built-in Commands'
          : cmd.source === 'provider' ? 'Provider Commands'
          : cmd.source === 'custom' ? 'Custom Commands'
          : cmd.source === 'plugin' ? 'Plugin Commands'
          : 'Other Commands';
        (grouped[label] ||= []).push(cmd);
      }
      const sections = Object.entries(grouped)
        .map(([label, cmds]) =>
          `**${label}:**\n\n${cmds.map(c => `- \`${c.command}\` — ${c.description}`).join('\n')}`
        )
        .join('\n\n');
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: sections,
        createdAt: Date.now(),
      });
      return;
    }

    // Handle /worktree locally — view or switch
    if (command === '/worktree') {
      if (isForcedPlanSession) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Worktree is locked during Supervisor planning mode.',
          createdAt: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
      const trimmedArgs = args.trim();
      if (!trimmedArgs) {
        const current = currentSession?.workingDirectory || currentProject?.rootPath || '(unknown)';
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Current worktree: \`${current}\`\n\n**Usage:**\n- \`/worktree <path>\` — switch to an existing worktree path\n- \`/worktree reset\` — reset to project root\n- \`/create-worktree [branch] [path]\` — create a new worktree`,
          createdAt: Date.now(),
        });
      } else if (trimmedArgs === 'reset') {
        await handleWorktreeChange('');
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Worktree reset to project root.',
          createdAt: Date.now(),
        });
      } else {
        try {
          await handleWorktreeChange(trimmedArgs);
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: `Worktree set to: \`${trimmedArgs}\``,
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: `Failed to set worktree: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
      }
      setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // Handle /new-cli-session (alias /reset-cli-session) locally.
    // Keeps app session/messages, but forces next run to start a fresh provider-side SDK/CLI session.
    if (command === '/new-cli-session' || command === '/reset-cli-session') {
      try {
        await api.resetSessionSdkSession(sessionId);
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Underlying CLI session reset. The next message will start a new provider-side session.',
          createdAt: Date.now(),
        });
      } catch (err) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Failed to reset CLI session: ${(err as Error).message}`,
          createdAt: Date.now(),
        });
      }
      setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // ── Supervisor commands (only in main supervisor session) ──
    if (currentSession?.projectRole === 'main' && currentProject?.id) {
      if (command === '/create-task') {
        const title = args.trim();
        if (!title) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: 'Usage: `/create-task <title>` — create a new supervision task',
            createdAt: Date.now(),
          });
          setTimeout(() => scrollToBottom(), 100);
          return;
        }
        try {
          const task = await api.createSupervisionTask(currentProject.id, {
            title,
            description: '',
          });
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Task created: **${task.title}** (${task.status})`,
            createdAt: Date.now(),
          });
          // Refresh task list in the card strip (no session created yet)
          useSupervisionStore.getState().upsertTask(currentProject.id, task);
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to create task: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }

      if (command === '/status') {
        try {
          const tasks = await api.getSupervisionTasks(currentProject.id);
          const agentData = await api.getSupervisionAgent(currentProject.id);
          const lines: string[] = [];
          lines.push(`**Agent**: ${agentData?.phase ?? 'unknown'} | Trust: ${agentData?.config.trustLevel ?? '?'} | Concurrent: ${agentData?.config.maxConcurrentTasks ?? '?'}`);
          if (tasks.length === 0) {
            lines.push('\nNo tasks yet. Use `/create-task <title>` to add one.');
          } else {
            const grouped: Record<string, typeof tasks> = {};
            for (const t of tasks) {
              (grouped[t.status] ??= []).push(t);
            }
            for (const [status, items] of Object.entries(grouped)) {
              lines.push(`\n**${status}** (${items.length})`);
              for (const t of items) {
                lines.push(`- ${t.title}${t.priority > 0 ? ` [P${t.priority}]` : ''}`);
              }
            }
          }
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: lines.join('\n'),
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to get status: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }

      if (command === '/pause') {
        try {
          await api.updateSupervisionAgentAction(currentProject.id, 'pause');
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: 'Supervision agent paused.',
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to pause: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }

      if (command === '/resume') {
        try {
          await api.updateSupervisionAgentAction(currentProject.id, 'resume');
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: 'Supervision agent resumed.',
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to resume: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
    }

    // Handle /create-worktree locally — create a new worktree and switch to it
    if (command === '/create-worktree') {
      if (isForcedPlanSession) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Worktree is locked during Supervisor planning mode.',
          createdAt: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
      if (!currentProject?.id) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'No project associated with this session.',
          createdAt: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const branch = parts[0]; // optional — auto-generated if omitted
      const wtPath = parts[1]; // optional
      try {
        const wt = await api.createProjectWorktree(currentProject.id, branch || '', wtPath);
        await handleWorktreeChange(wt.path);
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Worktree created and activated:\n- **Branch:** \`${wt.branch}\`\n- **Path:** \`${wt.path}\``,
          createdAt: Date.now(),
        });
      } catch (err) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Failed to create worktree: ${(err as Error).message}`,
          createdAt: Date.now(),
        });
      }
      setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // Provider commands should be passed directly to Claude SDK (they are Claude CLI built-ins).
    // Also treat all unrecognized commands (no matching commandDef) as pass-through to Claude,
    // since the input may not be an actual command (e.g. a path like /some/file/path).
    // Plugin commands (source === 'plugin') fall through to api.executeCommand() instead.
    if (commandDef?.source === 'provider' || !commandDef) {
      const commandText = args ? `${command} ${args}` : command;
      const clientMessageId = crypto.randomUUID();
      addMessage(sessionId, {
        id: clientMessageId,
        clientMessageId,
        sessionId,
        role: 'user',
        content: commandText,
        createdAt: Date.now(),
      });

      await startRun({
        type: 'run_start',
        clientRequestId: clientMessageId,
        sessionId,
        input: commandText,
        mode: mode || undefined,
        model: modelOverride || undefined,
        workingDirectory: currentSession?.workingDirectory || undefined,
      });
      return;
    }

    // Parse args into array
    const argsArray = args.trim() ? args.trim().split(/\s+/) : [];

    // Build context for command execution
    const context = {
      projectPath: currentProject?.rootPath,
      projectName: currentProject?.name,
      sessionId,
      provider: currentSession?.providerId || currentProject?.providerId || 'claude',
      model: modelOverride || 'default'
    };

    try {
      // First, try to execute via the commands API
      const result = await api.executeCommand({
        commandName: command,
        commandPath: commandDef?.filePath,
        args: argsArray,
        context,
      });

      if (result.type === 'builtin') {
        // Handle built-in command locally
        handleBuiltInCommand(result);
      } else if (result.type === 'custom' && result.content) {
        // Custom command - send processed content to Claude
        const clientMessageId = crypto.randomUUID();
        addMessage(sessionId, {
          id: clientMessageId,
          clientMessageId,
          sessionId,
          role: 'user',
          content: `${command} ${args}`.trim(),
          createdAt: Date.now(),
        });

        await startRun({
          type: 'run_start',
          clientRequestId: clientMessageId,
          sessionId,
          input: result.content,
          mode: mode || undefined,
          model: modelOverride || undefined,
          workingDirectory: currentSession?.workingDirectory || undefined,
        });
      }
    } catch (error) {
      console.error('Command execution error:', error);

      // Unknown command error
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`,
        createdAt: Date.now(),
      });
    }
  }, [sessionId, addMessage, commands, currentSession, currentProject, handleBuiltInCommand, handleWorktreeChange, scrollToBottom, mode, modelOverride, isForcedPlanSession, startRun]);

  const handleCancelRun = () => {
    // Restore last sent message to input
    if (lastSentMessage) {
      setRestoreMessage(lastSentMessage);
      setLastSentMessage(null);
    }

    if (!sessionRunId) {
      console.warn('[ChatInterface] No active run for this session');
      return;
    }

    wsSendMessage({
      type: 'run_cancel',
      runId: sessionRunId,
    });
  };

  // Cancel current run and send queued message (triggered by "Send Now" button)
  const handleSendNow = () => {
    if (!sessionRunId) return;
    // Don't restore lastSentMessage — queued message takes priority
    setLastSentMessage(null);
    wsSendMessage({ type: 'run_cancel', runId: sessionRunId });
    // queuedMessage stays in state; useEffect will auto-send when isLoading→false
  };

  // Dismiss queued message and restore text to input
  const handleDismissQueue = () => {
    const msg = queuedMessage;
    setQueuedMessage(null);
    if (msg) {
      setRestoreMessage({ content: msg.content, attachments: msg.attachments });
    }
  };

  // Session action bar handlers
  const handleSessionRename = async () => {
    const newName = renameValue.trim();
    setIsRenamingSession(false);
    if (!newName || !isConnected) return;
    try {
      await api.updateSession(sessionId, { name: newName });
      useProjectStore.getState().updateSession(sessionId, { name: newName });
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  };

  const handleExportSession = async () => {
    try {
      const { markdown, sessionName } = await api.exportSession(sessionId);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sessionName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export session:', error);
    }
  };

  const handleArchiveSession = async () => {
    if (!isConnected) return;
    try {
      await api.archiveSessions([sessionId]);
      useProjectStore.getState().deleteSession(sessionId);
    } catch (error) {
      console.error('Failed to archive session:', error);
    }
  };

  const handlePopOut = async () => {
    if (!isDesktopTauri) return;
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { getBaseUrl, getAuthHeaders } = await import('../../services/api');

      const label = `session-chat-${Date.now()}`;
      const serverUrl = getBaseUrl();
      const authToken = (getAuthHeaders() as Record<string, string>)['Authorization'] || '';

      const urlParams = new URLSearchParams({
        sessionWindow: sessionId,
        projectId: currentSession?.projectId || '',
        serverUrl,
        authToken,
      });

      const winUrl = `${window.location.origin}${window.location.pathname}?${urlParams}`;

      new WebviewWindow(label, {
        url: winUrl,
        title: currentSession?.name || 'Session',
        width: 900,
        height: 700,
        center: true,
        dragDropEnabled: false,
      });

      addPoppedOutSession(sessionId, label);

      // When the standalone window closes, remove the popped-out state
      const win = await WebviewWindow.getByLabel(label);
      if (win) {
        const unlisten = await win.onCloseRequested(() => {
          removePoppedOutSession(sessionId);
          unlisten();
        });
      }
    } catch (err) {
      console.error('[ChatInterface] Pop out failed:', err);
    }
  };

  const handleFocusPoppedOutWindow = async (windowLabel: string) => {
    if (!isDesktopTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('focus_window', { label: windowLabel });
    } catch (err) {
      console.error('[ChatInterface] Focus popped-out window failed:', err);
    }
  };

  const handleBringBackHere = async (windowLabel: string) => {
    if (!isDesktopTauri) {
      removePoppedOutSession(sessionId);
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('close_window', { label: windowLabel });
    } catch (err) {
      console.error('[ChatInterface] Close popped-out window failed:', err);
    }
    removePoppedOutSession(sessionId);
  };

  const poppedOutLabel = poppedOutSessions.get(sessionId);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Popped-out placeholder: session is open in a standalone window */}
      {poppedOutLabel && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground">
          <ExternalLink size={32} className="opacity-40" />
          <p className="text-sm">This session is open in a separate window</p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await handleFocusPoppedOutWindow(poppedOutLabel);
              }}
              className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary transition-colors"
            >
              Focus window
            </button>
            <button
              onClick={async () => {
                await handleBringBackHere(poppedOutLabel);
              }}
              className="px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              Bring back here
            </button>
          </div>
        </div>
      )}
      {!poppedOutLabel && <>
      {/* Task card strip for supervisor main session */}
      {currentSession?.projectRole === 'main' && currentProject?.id && (
        <TaskCardStrip projectId={currentProject.id} />
      )}

      {/* Interrupted session banner */}
      {currentSession?.lastRunStatus === 'interrupted' && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-sm text-red-400">Session was interrupted by app restart.</span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={async () => {
                await startRun({
                  type: 'run_start',
                  clientRequestId: crypto.randomUUID(),
                  sessionId,
                  input: 'continue',
                  mode: mode || undefined,
                  workingDirectory: currentSession?.workingDirectory || undefined,
                });
              }}
              className="text-xs px-3 py-1 rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
            >
              Resume
            </button>
            <button
              onClick={async () => {
                try {
                  await clearInterruptedStatus();
                } catch {}
              }}
              className="text-xs px-3 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Session action bar */}
      {currentSession && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/50">
          {/* Back button for background sessions */}
          {currentSession.type === 'background' && onReturnToDashboard && currentSession.projectId && (
            <button
              onClick={() => onReturnToDashboard(currentSession.projectId)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Back to dashboard"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          {/* Session name — click to rename (disabled for background sessions) */}
          {currentSession.type === 'background' ? (
            <span className="flex-1 min-w-0 text-sm text-foreground truncate">
              {currentSession.name || 'Untitled Session'}
            </span>
          ) : isRenamingSession ? (
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSessionRename();
                if (e.key === 'Escape') setIsRenamingSession(false);
              }}
              onBlur={handleSessionRename}
              className="flex-1 min-w-0 px-2 py-0.5 text-sm bg-muted/60 border-0 rounded-lg shadow-apple-sm focus:ring-1 focus:ring-primary/50 focus:outline-none text-foreground"
            />
          ) : (
            <button
              onClick={() => {
                setRenameValue(currentSession.name || '');
                setIsRenamingSession(true);
              }}
              className="flex-1 min-w-0 text-left text-sm text-foreground truncate hover:text-primary transition-colors"
              title="Click to rename"
            >
              {currentSession.name || 'Untitled Session'}
            </button>
          )}
          {/* Provider badge */}
          {(() => {
            const pid = currentSession.providerId || currentProject?.providerId;
            const prov = pid ? providers.find(p => p.id === pid) : undefined;
            const name = prov?.name || prov?.type || 'Claude';
            return (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted-foreground/10 text-muted-foreground/60 shrink-0">
                {name}
              </span>
            );
          })()}
          {/* Actions (hidden for background sessions) */}
          {currentSession.type !== 'background' && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleResetProviderSession}
                disabled={isLoading}
                className={`p-1 rounded transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed text-muted-foreground' : 'hover:bg-secondary text-muted-foreground hover:text-foreground'}`}
                title="Reset underlying provider session"
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={handleExportSession}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Export as Markdown"
              >
                <Download size={14} />
              </button>
              <button
                onClick={handleArchiveSession}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Archive session"
              >
                <Archive size={14} />
              </button>
              {isDesktopTauri && !isMobile && !isStandaloneSessionWindow && (
                <button
                  onClick={handlePopOut}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Open in new window"
                >
                  <ExternalLink size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Plan status indicator for task sessions (session-level, shown above messages) */}
      {currentSession?.projectRole === 'task' && currentSession.planStatus === 'planning' && (
        <div className="px-2 md:px-4 pt-2 md:pt-3">
          <div className="px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-3 text-sm text-blue-500">
            <ClipboardList size={14} className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Planning mode — iterate with Start/Continue Plan.</div>
              <div className="text-xs text-blue-500/90 mt-0.5">
                {planStatusLoading
                  ? 'Checking plan document status...'
                  : taskPlanStatus?.ready
                    ? `Plan ready to submit (score ${taskPlanStatus.score}).`
                    : taskPlanStatus?.exists
                      ? `Plan not ready: missing ${taskPlanStatus.missing.join(', ')}`
                      : 'No plan document found yet. Create .supervision/plans/task-<taskId>.plan.md'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const taskId = currentSession?.taskId;
                  if (!taskId || discardPlanLoading) return;
                  const ok = window.confirm('Discard current plan and cancel this task?');
                  if (!ok) return;
                  try {
                    setDiscardPlanLoading(true);
                    const task = await api.cancelTask(taskId);
                    if (currentProject?.id) {
                      useSupervisionStore.getState().upsertTask(currentProject.id, task);
                    }
                    useProjectStore.getState().updateSession(sessionId, {
                      isReadOnly: false,
                      planStatus: undefined,
                    });
                    addMessage(sessionId, {
                      id: crypto.randomUUID(),
                      sessionId,
                      role: 'system',
                      content: 'Plan discarded. Task has been cancelled.',
                      createdAt: Date.now(),
                    });
                    setTimeout(() => scrollToBottom(), 100);
                  } catch (err) {
                    addMessage(sessionId, {
                      id: crypto.randomUUID(),
                      sessionId,
                      role: 'system',
                      content: `Failed to discard plan: ${(err as Error).message}`,
                      createdAt: Date.now(),
                    });
                    setTimeout(() => scrollToBottom(), 100);
                  } finally {
                    setDiscardPlanLoading(false);
                  }
                }}
                disabled={discardPlanLoading || submitPlanLoading || isLoading}
                className="px-3 py-1.5 rounded-md text-xs border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {discardPlanLoading ? 'Discarding...' : 'Discard Plan'}
              </button>
              <button
                onClick={async () => {
                  const taskId = currentSession?.taskId;
                  if (!taskId || submitPlanLoading) return;
                  try {
                    setSubmitPlanLoading(true);
                    const result = await api.submitTaskPlan(taskId);
                    useProjectStore.getState().updateSession(sessionId, {
                      isReadOnly: true,
                      planStatus: 'planned',
                    });
                    if (currentProject?.id) {
                      useSupervisionStore.getState().upsertTask(currentProject.id, result.task);
                    }
                    addMessage(sessionId, {
                      id: crypto.randomUUID(),
                      sessionId,
                      role: 'system',
                      content: 'Plan submitted to Supervisor. Waiting for execution.',
                      createdAt: Date.now(),
                    });
                    setTimeout(() => scrollToBottom(), 100);
                  } catch (err) {
                    addMessage(sessionId, {
                      id: crypto.randomUUID(),
                      sessionId,
                      role: 'system',
                      content: `Failed to submit plan: ${(err as Error).message}`,
                      createdAt: Date.now(),
                    });
                    setTimeout(() => scrollToBottom(), 100);
                  } finally {
                    setSubmitPlanLoading(false);
                  }
                }}
                disabled={!taskPlanStatus?.ready || submitPlanLoading || discardPlanLoading || isLoading}
                className="px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
              >
                {submitPlanLoading ? 'Submitting...' : 'Submit Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden pl-2 pr-3 py-2 md:p-4 relative min-h-0"
        onScroll={handleScroll}
        onWheel={(e) => handleMessageWheel(e.deltaY)}
      >
        {/* Load more indicator */}
        {sessionPagination?.hasMore && (
          <div className="text-center py-2 mb-2">
            {sessionPagination?.isLoadingMore ? (
              <span className="text-muted-foreground text-sm">Loading older messages...</span>
            ) : (
              <button
                onClick={loadMoreMessages}
                className="text-primary hover:text-primary/80 text-sm"
              >
                Load older messages
              </button>
            )}
          </div>
        )}

        {/* Initial load placeholder (also covers first switch with no local snapshot yet) */}
        {isInitialMessageLoading && (
          <div className="py-8 px-2 md:px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Loader2 size={16} className="animate-spin" />
              <span>Loading messages...</span>
            </div>
            <div className="space-y-3 animate-pulse">
              <div className="h-8 w-2/3 rounded-md bg-secondary/70" />
              <div className="h-20 w-4/5 rounded-lg bg-secondary/60" />
              <div className="h-6 w-1/2 rounded-md bg-secondary/70" />
            </div>
          </div>
        )}

        {/* Message load error */}
        {loadError && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <AlertTriangle size={40} strokeWidth={1.5} className="text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">{loadError}</p>
            <button
              onClick={() => { setLoadError(null); setInitialLoadDone(false); loadMessages(); }}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 rounded transition-colors"
            >
              Retry
            </button>
          </div>
        )}


        <MessageList
          messages={sessionMessages}
          streamingContentBlocks={useStreamingSegmented ? sessionContentBlocks : undefined}
          streamingToolCalls={useStreamingSegmented ? sessionToolCallHistory : undefined}
          scrollTop={scrollMetrics.scrollTop}
          viewportHeight={scrollMetrics.viewportHeight}
          resendTargetMessageId={resendTargetMessage?.id}
          resendDisabled={!resendText || resendChecking}
          onResendTarget={handleResendLastMessage}
        />

        {/* Loading indicator (shown while waiting for response) */}
        <LoadingIndicator
          isLoading={isLoading}
          health={sessionHealth?.health}
          loopPattern={sessionHealth?.loopPattern}
          startedAt={sessionHealth?.startedAt}
          lastActivityAt={sessionHealth?.lastActivityAt}
          onCancel={handleCancelRun}
        />

        {/* Active tool calls (shown during streaming — hidden when inline in segmented view) */}
        {!useStreamingSegmented && sessionToolCalls.length > 0 && (
          <div className="mt-4 max-w-full md:max-w-3xl">
            <ToolCallList toolCalls={sessionToolCalls} />
          </div>
        )}

        {/* Inline permission requests for this session */}
        {permissionRequests.length > 0 && (
          <div className="mt-4 space-y-3 max-w-full md:max-w-3xl">
            {permissionRequests.map(req => (
              <InlinePermissionRequest
                key={req.requestId}
                request={req}
                onDecision={handlePermissionDecision}
              />
            ))}
          </div>
        )}

        {/* Inline ask-user-question requests for this session */}
        {askUserRequests.length > 0 && (
          <div className="mt-4 space-y-3 max-w-full md:max-w-3xl">
            {askUserRequests.map(req => (
              <InlineAskUserQuestion
                key={req.requestId}
                request={req}
                onAnswer={handleAskUserAnswer}
              />
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* Scroll to bottom button — sticky inside scroll container */}
        {showScrollToBottom && (
          <button
            onClick={jumpToBottomInstant}
            className="sticky bottom-4 float-right mr-2 z-10 w-9 h-9 rounded-full bg-muted/90 border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="Scroll to bottom"
          >
            <ArrowDown size={16} strokeWidth={1.5} className="text-foreground" />
          </button>
        )}
      </div>

      {/* Background Tasks Panel - shows above bottom panel when there are tasks */}
      <BackgroundTaskPanel sessionId={sessionId} />

      {/* Bottom panel (file viewer + terminal with tab switching) */}
      <BottomPanel
        projectId={currentSession?.projectId}
        projectRoot={fileReferenceRoot}
        workingDirectory={currentSession?.workingDirectory}
      />

      {/* Queued message banner */}
      {queuedMessage && (
        <div className="mx-2 md:mx-4 mt-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-sm flex items-center gap-2">
          <span className="text-primary font-medium flex-shrink-0">Queued</span>
          <span className="text-foreground truncate flex-1 text-xs">
            {queuedMessage.content.slice(0, 80)}{queuedMessage.content.length > 80 ? '...' : ''}
          </span>
          <button
            onClick={handleSendNow}
            className="text-xs font-medium text-primary hover:text-primary/80 px-2 py-1 bg-primary/10 rounded flex-shrink-0"
          >
            Send Now
          </button>
          <button
            onClick={handleDismissQueue}
            className="text-muted-foreground hover:text-foreground flex-shrink-0 p-0.5"
            title="Dismiss queued message"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="mx-2 md:mx-4 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
          <AlertTriangle size={16} strokeWidth={2} className="flex-shrink-0" />
          <span className="flex-1">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="text-destructive hover:text-destructive/80 font-medium">Dismiss</button>
        </div>
      )}

      {/* Input — read-only mode for task sessions or normal input */}
      {currentSession?.isReadOnly ? (
        <div className="border-t border-border p-3 md:p-4 safe-bottom-pad flex-shrink-0">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-secondary/50 border border-border rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock size={14} />
              <span>
                {currentSession.type === 'background'
                  ? 'Background session — read-only'
                  : currentSession.planStatus === 'planned'
                  ? 'Plan submitted — waiting for Supervisor to execute'
                  : currentSession.planStatus === 'executing'
                  ? 'Task executing — controlled by Supervisor'
                  : 'This session is read-only'}
              </span>
            </div>
            {currentSession.type === 'background' ? (
              isLoading && sessionRunId ? (
                <button
                  onClick={handleCancelRun}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-md transition-colors"
                >
                  <X size={14} />
                  Cancel
                </button>
              ) : null
            ) : (
              <button
                onClick={async () => {
                  try {
                    const updated = await api.unlockSession(sessionId);
                    useProjectStore.getState().updateSession(sessionId, {
                      isReadOnly: updated.isReadOnly,
                      planStatus: updated.planStatus,
                    });
                  } catch (err) {
                    console.error('Failed to unlock session:', err);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors"
              >
                <Unlock size={14} />
                Unlock
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="border-t border-border p-2 md:p-4 safe-bottom-pad overflow-visible flex-shrink-0">
          {/* Toolbar */}
          <div className="mb-1.5 md:mb-2 flex items-center gap-1 md:gap-2">
            <ModeSelector
              capabilities={capabilities}
              value={isForcedPlanSession ? 'plan' : mode}
              onChange={(modeId: string) => {
                if (isForcedPlanSession) return;
                setMode(sessionId, modeId);
              }}
              disabled={isLoading}
              locked={isForcedPlanSession}
              lockReason={isForcedPlanSession ? 'Locked by Supervisor planning mode' : undefined}
            />
            <ModelSelector
              capabilities={capabilities}
              value={modelOverride}
              onChange={(model: string) => setModelOverride(sessionId, model)}
              disabled={isLoading}
            />
            <PermissionSelector
              value={permissionOverride}
              onChange={(policy) => setPermissionOverride(sessionId, policy)}
              projectPolicy={(currentProject?.agentPermissionOverride as AgentPermissionPolicy) ?? null}
              disabled={isLoading}
            />
            {currentProject?.id && currentProject?.rootPath && (
              <WorktreeSelector
                projectId={currentProject.id}
                projectRootPath={currentProject.rootPath}
                currentWorktree={currentSession?.workingDirectory || ''}
                onChange={handleWorktreeChange}
                disabled={isLoading}
                locked={isForcedPlanSession}
                lockReason={isForcedPlanSession ? 'Locked by Supervisor planning mode' : undefined}
              />
            )}
            {/* Hidden on mobile - can tap to view details */}
            <div className="hidden md:block">
              <TokenUsageDisplay
                latestInputTokens={currentUsage.latestInputTokens}
                latestOutputTokens={currentUsage.latestOutputTokens}
                inputTokens={currentUsage.inputTokens}
                outputTokens={currentUsage.outputTokens}
                contextWindow={currentUsage.contextWindow}
              />
            </div>
            <div className="flex-1 min-w-[8px]" />
            {/* Desktop: show buttons directly */}
            {!isMobile && currentProject?.rootPath && (
              <button
                onClick={() => {
                  if (fileViewerOpen && bottomPanelTab === 'file') {
                    useFileViewerStore.getState().close();
                  } else if (fileViewerOpen) {
                    setBottomPanelTab('file');
                  } else {
                    const store = useFileViewerStore.getState();
                    store.togglePanel();
                    store.setSearchOpen(true);
                    setBottomPanelTab('file');
                  }
                }}
                className={`p-1.5 rounded hover:bg-secondary ${fileViewerOpen && bottomPanelTab === 'file' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title={fileViewerOpen && bottomPanelTab === 'file' ? 'Close file viewer' : 'Open file viewer (Cmd+P)'}
              >
                <FileText size={16} strokeWidth={1.75} />
              </button>
            )}
            {!isMobile && useServerStore.getState().activeServerSupports('remoteTerminal') && currentSession?.projectId && (() => {
              const pid = currentSession.projectId;
              const isOpen = !!drawerOpen[pid];
              return (
                <button
                  onClick={() => {
                    if (isOpen && bottomPanelTab === 'terminal') {
                      setDrawerOpen(pid, false);
                    } else if (isOpen) {
                      setBottomPanelTab('terminal');
                    } else {
                      const store = useTerminalStore.getState();
                      if (!store.terminals[pid]) {
                        store.openTerminal(pid);
                      }
                      setDrawerOpen(pid, true);
                      setBottomPanelTab('terminal');
                    }
                  }}
                  className={`p-1.5 rounded hover:bg-secondary ${isOpen && bottomPanelTab === 'terminal' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  title={isOpen && bottomPanelTab === 'terminal' ? 'Hide terminal (Ctrl+`)' : 'Open terminal (Ctrl+`)'}
                >
                  <TerminalIcon size={16} strokeWidth={1.75} />
                </button>
              );
            })()}

            {/* Mobile: show more menu with File and Terminal options */}
            {isMobile && (
              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="More options"
                >
                  <MoreHorizontal size={16} strokeWidth={1.75} />
                </button>
                {showMoreMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                    <div className="absolute bottom-full right-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                      {currentProject?.rootPath && (
                        <button
                          onClick={() => {
                            if (fileViewerOpen && bottomPanelTab === 'file') {
                              useFileViewerStore.getState().close();
                            } else if (fileViewerOpen) {
                              setBottomPanelTab('file');
                            } else {
                              const store = useFileViewerStore.getState();
                              store.togglePanel();
                              store.setSearchOpen(true);
                              setBottomPanelTab('file');
                            }
                            setShowMoreMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                            fileViewerOpen && bottomPanelTab === 'file'
                              ? 'bg-primary/10 text-primary'
                              : 'text-foreground hover:bg-muted'
                          }`}
                        >
                          <FileText size={14} />
                          {fileViewerOpen && bottomPanelTab === 'file' ? 'Close File Viewer' : 'File Viewer'}
                        </button>
                      )}
                      {useServerStore.getState().activeServerSupports('remoteTerminal') && currentSession?.projectId && (() => {
                        const pid = currentSession.projectId;
                        const isOpen = !!drawerOpen[pid];
                        return (
                          <button
                            onClick={() => {
                              if (isOpen && bottomPanelTab === 'terminal') {
                                setDrawerOpen(pid, false);
                              } else if (isOpen) {
                                setBottomPanelTab('terminal');
                              } else {
                                const store = useTerminalStore.getState();
                                if (!store.terminals[pid]) {
                                  store.openTerminal(pid);
                                }
                                setDrawerOpen(pid, true);
                                setBottomPanelTab('terminal');
                              }
                              setShowMoreMenu(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                              isOpen && bottomPanelTab === 'terminal'
                                ? 'bg-primary/10 text-primary'
                                : 'text-foreground hover:bg-muted'
                            }`}
                          >
                            <TerminalIcon size={14} />
                            {isOpen && bottomPanelTab === 'terminal' ? 'Close Terminal' : 'Terminal'}
                          </button>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}

            {!isMobile && (
              <button
                onClick={() => setAdvancedInput(!advancedInput)}
                className={`p-1.5 rounded hover:bg-secondary ${advancedInput ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title={advancedInput ? 'Normal input' : 'Advanced input (Enter to newline)'}
              >
                {advancedInput ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronUp size={16} strokeWidth={2} />}
              </button>
            )}
            <SystemInfoButton
              systemInfo={currentSystemInfo}
              sessionInfo={currentSession ? {
                id: currentSession.id,
                name: currentSession.name || undefined,
                projectName: currentProject?.name || undefined,
              } : null}
            />
          </div>
          <MessageInput
            key={sessionId}
            sessionId={sessionId}
            onSend={handleSendMessage}
            onCancel={handleCancelRun}
            onCommand={handleCommand}
            commands={commands}
            projectRoot={fileReferenceRoot}
            disabled={!isConnected}
            isLoading={isLoading}
            initialValue={restoreMessage?.content ?? initialDraft}
            initialAttachments={restoreMessage?.attachments}
            advancedMode={advancedInput}
            onDraftOpen={() => openDraftEditor(sessionId)}
            hasDraft={draftExists}
            placeholder={
              !isConnected
                ? 'Connecting...'
                : isLoading && queuedMessage
                ? 'Message queued — waiting for response...'
                : isLoading
                ? 'Type next message to queue...'
                : mode === 'plan'
                ? 'Plan Mode: Analyze and plan (no code changes)...'
                : advancedInput
                ? 'Type a message... (Cmd+Enter to send)'
                : 'Type a message... (Enter to send)'
            }
          />
        </div>
      )}
      </>}

      {/* Draft Editor Modal */}
      {(draftEditorOpen || draftShowLockPrompt) && (
        <DraftEditorModal onFinishDraft={(content) => handleSendMessage(content)} />
      )}
    </div>
  );
}
