import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Loader2, AlertTriangle, ClipboardList, ArrowDown, X, ExternalLink } from 'lucide-react';
import { MessageList } from './MessageList';
import { type Attachment } from './MessageInput';
import { ToolCallList } from './ToolCallItem';
import { LoadingIndicator } from './LoadingIndicator';
import { InlinePermissionRequest } from './InlinePermissionRequest';
import { InlineAskUserQuestion } from './InlineAskUserQuestion';
import { SessionHeader } from './SessionHeader';
import { ChatInputArea } from './ChatInputArea';
import { BottomPanel } from '../BottomPanel';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useUIStore } from '../../stores/uiStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { usePluginStore } from '../../stores/pluginStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useAskUserQuestionStore } from '../../stores/askUserQuestionStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useCommandHandler } from '../../hooks/chat/useCommandHandler';
import { useMessagePagination } from '../../hooks/chat/useMessagePagination';
import { useSessionActions } from '../../hooks/chat/useSessionActions';
import { usePlanStatus } from '../../hooks/chat/usePlanStatus';
import * as api from '../../services/api';
import { uploadFile } from '../../services/fileUpload';
import { TaskCardStrip } from '../supervision/TaskCardStrip';
import { BackgroundTaskPanel } from '../BackgroundTaskPanel';
import { DraftLockPrompt } from '../draft/DraftLockPrompt';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import type { AgentPermissionPolicy, MessageAttachment, MessageInput as MessageInputData, ProviderCapabilities, SlashCommand } from '@my-claudia/shared';
import type { MessageWithToolCalls } from '../../stores/chatStore';

interface ChatInterfaceProps {
  sessionId: string;
  onReturnToDashboard?: (projectId: string) => void;
  onOpenSidebar?: () => void;
}

const EMPTY_MESSAGES: MessageWithToolCalls[] = [];
const EMPTY_TOOL_CALLS: import('../../stores/chatStore').ToolCallState[] = [];
const EMPTY_CONTENT_BLOCKS: import('@my-claudia/shared').ContentBlock[] = [];
const ATTACHMENT_PLACEHOLDER = '[Attachments]';

export function ChatInterface({ sessionId, onReturnToDashboard, onOpenSidebar }: ChatInterfaceProps) {
  const messages = useChatStore((s) => s.messages);
  const activeRuns = useChatStore((s) => s.activeRuns);
  const backgroundRunIds = useChatStore((s) => s.backgroundRunIds);
  const runHealth = useChatStore((s) => s.runHealth);
  const activeToolCalls = useChatStore((s) => s.activeToolCalls);
  const runContentBlocks = useChatStore((s) => s.runContentBlocks);
  const toolCallsHistory = useChatStore((s) => s.toolCallsHistory);
  const addMessage = useChatStore((s) => s.addMessage);
  const clearMessages = useChatStore((s) => s.clearMessages);
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
  const {
    projects,
    sessions,
    providers,
    providerCommands,
    providerCapabilities,
    setProviderCapabilities,
    dataServerId,
  } = useProjectStore();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const { setDrawerOpen } = useTerminalStore();
  const { setActiveTab: setBottomPanelTab } = useBottomPanelStore();
  const {
    advancedInput,
    poppedOutSessions,
  } = useUIStore();
  const { sendMessage: wsSendMessage, isConnected, handlePermissionDecision, handleAskUserAnswer } = useConnection();
  const isMobile = useIsMobile();
  const [showSessionMenu, setShowSessionMenu] = useState(false);

  // Draft editor state
  const draftShowLockPrompt = useDraftEditorStore((s) => s.showLockPrompt);
  const draftExists = useDraftEditorStore((s) => s.draftExists[sessionId] ?? false);
  const checkDraftExists = useDraftEditorStore((s) => s.checkDraftExists);

  // Check draft existence when entering session
  useEffect(() => {
    checkDraftExists(sessionId);
  }, [sessionId, checkDraftExists]);

  // Mobile: keep chat pinned to the visible viewport when soft keyboard opens.
  // Android Tauri WebView uses adjustResize, so window.innerHeight already shrinks.
  // We only constrain height here. Applying visualViewport.offsetTop as `top`
  // adds unwanted blank space above the header on some Android keyboards.
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const el = chatRootRef.current;
      if (!el) return;
      // Use the smaller of innerHeight and visualViewport to avoid double-shrink
      const h = Math.min(window.innerHeight, vv.height);
      if (h < window.innerHeight) {
        // Fixed mode: pin to the top and only shrink height to the visible viewport.
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.right = '0';
        el.style.height = `${h}px`;
      } else {
        el.style.position = '';
        el.style.top = '';
        el.style.left = '';
        el.style.right = '';
        el.style.height = '';
      }
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      const el = chatRootRef.current;
      if (el) {
        el.style.position = '';
        el.style.top = '';
        el.style.left = '';
        el.style.right = '';
        el.style.height = '';
      }
    };
  }, [isMobile]);

  // Per-session pending permission/question requests
  // Also include requests without sessionId (backward compat with servers that haven't been updated)
  const permissionRequests = usePermissionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
  const askUserRequests = useAskUserQuestionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
  const chatRootRef = useRef<HTMLDivElement>(null);
  const [initialDraft, setInitialDraft] = useState<string | undefined>(undefined);

  // Message pagination & scroll management
  const {
    messagesEndRef,
    messagesContainerRef,
    initialLoadDone,
    showScrollToBottom,
    scrollMetrics,
    highlightedMessageId,
    loadError,
    sessionPagination,
    scrollToBottom,
    jumpToBottomInstant,
    loadMoreMessages,
    handleScroll,
    handleMessageWheel,
    retryLoad,
    resetRefs: resetPaginationRefs,
  } = useMessagePagination({ sessionId, isConnected, isMobile });

  // State for restoring message after cancel
  const [lastSentMessage, setLastSentMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resendChecking, setResendChecking] = useState(false);
  // Queued message: when user sends while a run is active, queue it for auto-send
  const [queuedMessage, setQueuedMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);

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
    setResendChecking(false);
    setQueuedMessage(null);
    setInitialDraft(useChatStore.getState().drafts[sessionId]);
    resetPaginationRefs();
    setIsRenamingSession(false);
    setRenameValue('');
  }, [sessionId, resetPaginationRefs]);

  // Task planning sessions are hard-locked to Plan mode.
  useEffect(() => {
    if (isForcedPlanSession && mode !== 'plan') {
      setMode(sessionId, 'plan');
    }
  }, [isForcedPlanSession, mode, sessionId, setMode]);

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
      if (e.ctrlKey && e.key === '`' && currentSession?.projectId && !usePluginStore.getState().disabledBuiltinPanels.includes('terminal')) {
        e.preventDefault();
        const store = useTerminalStore.getState();
        const bpStore = useBottomPanelStore.getState();
        const pid = currentSession.projectId;
        if (store.isDrawerOpen(pid) && bpStore.activeTab === 'terminal') {
          store.setDrawerOpen(pid, false);
        } else if (store.isDrawerOpen(pid)) {
          bpStore.setActiveTab('terminal');
        } else {
          if (!store.terminals[pid]) {
            store.openTerminal(pid);
          }
          store.setDrawerOpen(pid, true);
          bpStore.setActiveTab('terminal');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentSession?.projectId]);

  // Cmd+P / Ctrl+P keyboard shortcut to open file search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && currentProject?.rootPath && !usePluginStore.getState().disabledBuiltinPanels.includes('file-viewer')) {
        e.preventDefault();
        const store = useFileViewerStore.getState();
        if (!store.isOpen) {
          store.togglePanel();
        }
        store.setSearchOpen(true);
        useBottomPanelStore.getState().setActiveTab('file-viewer');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentProject?.rootPath]);

  // Derive provider ID and fetch capabilities when it changes
  const providerId = currentSession?.providerId || currentProject?.providerId;
  const isBackendDataReady = dataServerId != null && dataServerId === activeServerId;
  // Scope provider caches by active server/backend to avoid cross-backend contamination.
  const providerScopeKey = activeServerId || 'local';
  // Cache key: use providerId if set, otherwise '_default' for Claude defaults
  const capsCacheKey = `${providerScopeKey}:${providerId || '_default'}`;
  const commandsCacheKey = `${providerScopeKey}:${providerId || '_default'}`;

  // Fetch commands when provider or project changes (via HTTP)
  useEffect(() => {
    const projectRoot = currentProject?.rootPath;
    const controller = new AbortController();

    if (!isConnected || !isBackendDataReady) {
      return () => controller.abort();
    }

    if (providerId) {
      // Load commands for the specific provider
      api.getProviderCommands(providerId, projectRoot || undefined, { signal: controller.signal })
        .then(commands => {
          useProjectStore.getState().setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error('Failed to load provider commands:', err);
        });
    } else {
      // No provider configured — load default commands by type
      api.getProviderTypeCommands('claude', projectRoot || undefined, { signal: controller.signal })
        .then(commands => {
          useProjectStore.getState().setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error('Failed to load default commands:', err);
        });
    }

    return () => controller.abort();
  }, [currentSession?.providerId, currentProject?.providerId, currentProject?.rootPath, isConnected, isBackendDataReady, commandsCacheKey]);

  useEffect(() => {
    const controller = new AbortController();
    if (!isConnected || !isBackendDataReady) return () => controller.abort();
    // Skip if already cached
    if (providerCapabilities[capsCacheKey]) return () => controller.abort();

    const fetchCaps = providerId
      ? api.getProviderCapabilities(providerId, { signal: controller.signal })
      : api.getProviderTypeCapabilities('claude', { signal: controller.signal });

    fetchCaps
      .then(caps => {
        setProviderCapabilities(capsCacheKey, caps);
        // Set default mode for this session if not already set
        if (caps.defaultModeId && !useChatStore.getState().getMode(sessionId)) {
          useChatStore.getState().setMode(sessionId, caps.defaultModeId);
        }
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load provider capabilities:', err);
      });
    return () => controller.abort();
  }, [capsCacheKey, providerId, isConnected, isBackendDataReady, providerCapabilities, setProviderCapabilities, sessionId]);

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

  const { handleCommand, handleResetProviderSession, handleWorktreeChange } = useCommandHandler({
    sessionId,
    commands,
    currentSession,
    currentProject,
    isForcedPlanSession,
    mode,
    modelOverride,
    addMessage,
    clearMessages,
    scrollToBottom,
    startRun,
    providerId,
    commandsCacheKey,
    setDrawerOpen,
    setBottomPanelTab,
  });

  const {
    taskPlanStatus,
    planStatusLoading,
    submitPlanLoading,
    discardPlanLoading,
    handleRestorePlan,
    handleDiscardPlan,
    handleSubmitPlan,
  } = usePlanStatus({
    sessionId,
    isConnected,
    isForcedPlanSession,
    currentSession,
    currentProjectId: currentProject?.id,
    messagesLength: sessionMessages.length,
    addMessage,
    scrollToBottom,
    handleSendMessage,
  });

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
  const {
    handleSessionRename,
    handleExportSession,
    handleArchiveSession,
    handlePopOut,
    handleFocusPoppedOutWindow,
    handleBringBackHere,
  } = useSessionActions({
    sessionId,
    isConnected,
    currentSession,
    currentProject,
    activeServerId,
    renameValue,
    setIsRenamingSession,
  });

  const poppedOutLabel = poppedOutSessions.get(sessionId);

  return (
    <div ref={chatRootRef} className="flex flex-col h-full bg-background">
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
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] z-20 flex items-center gap-3 rounded-xl border border-red-500/20 bg-background/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:static sm:inset-auto sm:bottom-auto sm:z-auto sm:rounded-none sm:border-x-0 sm:border-t-0 sm:bg-red-500/10 sm:px-4 sm:py-2 sm:shadow-none sm:backdrop-blur-0">
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
        <SessionHeader
          currentSession={currentSession}
          currentProject={currentProject}
          providers={providers}
          isMobile={isMobile}
          isLoading={isLoading}
          isRenamingSession={isRenamingSession}
          renameValue={renameValue}
          showSessionMenu={showSessionMenu}
          onOpenSidebar={onOpenSidebar}
          onReturnToDashboard={onReturnToDashboard}
          onRenameStart={(name) => { setRenameValue(name); setIsRenamingSession(true); }}
          onRenameChange={setRenameValue}
          onRenameConfirm={handleSessionRename}
          onRenameCancel={() => setIsRenamingSession(false)}
          onResetProviderSession={handleResetProviderSession}
          onExport={handleExportSession}
          onArchive={handleArchiveSession}
          onPopOut={handlePopOut}
          onToggleSessionMenu={() => setShowSessionMenu(!showSessionMenu)}
        />
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
              {/* Restore Plan: re-read existing plan file after app restart */}
              {taskPlanStatus?.exists && !isLoading && (
                <button
                  onClick={handleRestorePlan}
                  className="px-3 py-1.5 rounded-md text-xs border border-blue-500/40 text-blue-500 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Restore Plan
                </button>
              )}
              <button
                onClick={handleDiscardPlan}
                disabled={discardPlanLoading || submitPlanLoading || isLoading}
                className="px-3 py-1.5 rounded-md text-xs border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {discardPlanLoading ? 'Discarding...' : 'Discard Plan'}
              </button>
              <button
                onClick={handleSubmitPlan}
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
              onClick={retryLoad}
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
          highlightedMessageId={highlightedMessageId}
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
          <div className="mt-4 max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
            <ToolCallList toolCalls={sessionToolCalls} />
          </div>
        )}

        {/* Inline permission requests for this session */}
        {permissionRequests.length > 0 && (
          <div className="mt-4 space-y-3 max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
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
          <div className="mt-4 space-y-3 max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
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
      <BackgroundTaskPanel sessionId={sessionId} onStopTask={(task) => {
        // Send targeted stop — server will use SDK stopTask() if run is active,
        // or fall back to process cleanup if the run has already ended
        wsSendMessage({
          type: 'stop_background_task',
          sessionId,
          taskId: task.id,
          cliPid: task.cliPid,
          taskRootPid: task.taskRootPid,
          taskCommand: task.taskCommand,
        });
      }} />

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

      {/* Input area */}
      {currentSession && (
        <ChatInputArea
          sessionId={sessionId}
          currentSession={currentSession}
          currentProject={currentProject}
          isMobile={isMobile}
          isLoading={isLoading}
          isConnected={isConnected}
          isForcedPlanSession={isForcedPlanSession}
          mode={mode}
          modelOverride={modelOverride}
          permissionOverride={permissionOverride}
          capabilities={capabilities}
          commands={commands}
          fileReferenceRoot={fileReferenceRoot}
          sessionRunId={sessionRunId}
          currentUsage={currentUsage}
          currentSystemInfo={currentSystemInfo}
          advancedInput={advancedInput}
          restoreMessage={restoreMessage}
          initialDraft={initialDraft}
          queuedMessage={queuedMessage}
          draftExists={draftExists}
          onSetMode={setMode}
          onSetModelOverride={setModelOverride}
          onSetPermissionOverride={setPermissionOverride}
          onWorktreeChange={handleWorktreeChange}
          onSendMessage={handleSendMessage}
          onCancelRun={handleCancelRun}
          onCommand={handleCommand}
        />
      )}
      </>}

      {/* Draft lock conflict dialog */}
      {draftShowLockPrompt && <DraftLockPrompt />}
    </div>
  );
}
