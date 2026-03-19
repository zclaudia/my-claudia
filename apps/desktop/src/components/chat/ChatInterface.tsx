import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Loader2, AlertTriangle, ArrowDown } from 'lucide-react';
import { MessageList } from './MessageList';
import { type Attachment } from './MessageInput';
import { ToolCallList } from './ToolCallItem';
import { LoadingIndicator } from './LoadingIndicator';
import { InlinePermissionRequest } from './InlinePermissionRequest';
import { InlineAskUserQuestion } from './InlineAskUserQuestion';
import { SessionHeader } from './SessionHeader';
import { ChatInputArea } from './ChatInputArea';
import { PoppedOutPlaceholder } from './PoppedOutPlaceholder';
import { InterruptedBanner } from './InterruptedBanner';
import { PlanStatusBar } from './PlanStatusBar';
import { QueuedMessageBanner } from './QueuedMessageBanner';
import { BottomPanel } from '../BottomPanel';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useUIStore } from '../../stores/uiStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useAskUserQuestionStore } from '../../stores/askUserQuestionStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useCommandHandler } from '../../hooks/chat/useCommandHandler';
import { useMessagePagination } from '../../hooks/chat/useMessagePagination';
import { useSessionActions } from '../../hooks/chat/useSessionActions';
import { usePlanStatus } from '../../hooks/chat/usePlanStatus';
import { useProviderCapabilities } from '../../hooks/chat/useProviderCapabilities';
import { useKeyboardShortcuts } from '../../hooks/chat/useKeyboardShortcuts';
import { useMobileViewport } from '../../hooks/chat/useMobileViewport';
import * as api from '../../services/api';
import { uploadFile } from '../../services/fileUpload';
import { TaskCardStrip } from '../supervision/TaskCardStrip';
import { BackgroundTaskPanel } from '../BackgroundTaskPanel';
import { DraftLockPrompt } from '../draft/DraftLockPrompt';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import type { AgentPermissionPolicy, MessageAttachment, MessageInput as MessageInputData } from '@my-claudia/shared';
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

  useEffect(() => {
    checkDraftExists(sessionId);
  }, [sessionId, checkDraftExists]);

  // Mobile viewport management
  const chatRootRef = useRef<HTMLDivElement>(null);
  useMobileViewport(chatRootRef, isMobile);

  // Per-session pending permission/question requests
  const permissionRequests = usePermissionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
  const askUserRequests = useAskUserQuestionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
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

  // Provider capabilities & commands
  const { providerId, capabilities, commands, commandsCacheKey } = useProviderCapabilities({ sessionId, isConnected });

  // Keyboard shortcuts
  useKeyboardShortcuts({ projectId: currentSession?.projectId, projectRoot: currentProject?.rootPath });

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
      setTimeout(() => handleSendMessage(content, attachments), 0);
    }
  }, [isLoading, isConnected]);

  // Scroll to bottom when new messages arrive (but not when loading history)
  useEffect(() => {
    if (initialLoadDone && sessionMessages.length > 0) {
      const container = messagesContainerRef.current;
      if (!container) return;
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
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        scrollToBottom();
      }
    }
  }, [sessionToolCalls, initialLoadDone, scrollToBottom]);

  const handleSendMessage = async (content: string, attachments?: Attachment[]) => {
    if (!content.trim() && !attachments?.length) return;

    if (!isConnected) {
      setQueuedMessage({ content, attachments });
      return;
    }

    if (isLoading) {
      setQueuedMessage({ content, attachments });
      return;
    }

    setLastSentMessage({ content, attachments });
    setRestoreMessage(null);
    setUploadError(null);

    let uploadedAttachments: MessageAttachment[] = [];

    if (attachments && attachments.length > 0) {
      try {
        for (const attachment of attachments) {
          const blob = await (await fetch(attachment.data)).blob();
          const file = new File([blob], attachment.name, { type: attachment.mimeType });
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

    const messageInput: MessageInputData = {
      text: content,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined
    };

    const fullContent = JSON.stringify(messageInput);
    const clientMessageId = crypto.randomUUID();

    addMessage(sessionId, {
      id: clientMessageId,
      clientMessageId,
      sessionId,
      role: 'user',
      content: content || '[Attachments]',
      createdAt: Date.now(),
    });

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
    if (lastSentMessage) {
      setRestoreMessage(lastSentMessage);
      setLastSentMessage(null);
    }
    if (!sessionRunId) {
      console.warn('[ChatInterface] No active run for this session');
      return;
    }
    wsSendMessage({ type: 'run_cancel', runId: sessionRunId });
  };

  const handleSendNow = () => {
    if (!sessionRunId) return;
    setLastSentMessage(null);
    wsSendMessage({ type: 'run_cancel', runId: sessionRunId });
  };

  const handleDismissQueue = () => {
    const msg = queuedMessage;
    setQueuedMessage(null);
    if (msg) {
      setRestoreMessage({ content: msg.content, attachments: msg.attachments });
    }
  };

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
      {/* Popped-out placeholder */}
      {poppedOutLabel && (
        <PoppedOutPlaceholder
          label={poppedOutLabel}
          onFocus={handleFocusPoppedOutWindow}
          onBringBack={handleBringBackHere}
        />
      )}
      {!poppedOutLabel && <>
      {/* Task card strip for supervisor main session */}
      {currentSession?.projectRole === 'main' && currentProject?.id && (
        <TaskCardStrip projectId={currentProject.id} />
      )}

      {/* Interrupted session banner */}
      {currentSession?.lastRunStatus === 'interrupted' && (
        <InterruptedBanner
          onResume={async () => {
            await startRun({
              type: 'run_start',
              clientRequestId: crypto.randomUUID(),
              sessionId,
              input: 'continue',
              mode: mode || undefined,
              workingDirectory: currentSession?.workingDirectory || undefined,
            });
          }}
          onDismiss={async () => {
            try { await clearInterruptedStatus(); } catch {}
          }}
        />
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

      {/* Plan status indicator */}
      {currentSession?.projectRole === 'task' && currentSession.planStatus === 'planning' && (
        <PlanStatusBar
          taskPlanStatus={taskPlanStatus}
          planStatusLoading={planStatusLoading}
          submitPlanLoading={submitPlanLoading}
          discardPlanLoading={discardPlanLoading}
          isLoading={isLoading}
          onRestorePlan={handleRestorePlan}
          onDiscardPlan={handleDiscardPlan}
          onSubmitPlan={handleSubmitPlan}
        />
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

        {/* Initial load placeholder */}
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

        <LoadingIndicator
          isLoading={isLoading}
          health={sessionHealth?.health}
          loopPattern={sessionHealth?.loopPattern}
          startedAt={sessionHealth?.startedAt}
          lastActivityAt={sessionHealth?.lastActivityAt}
          onCancel={handleCancelRun}
        />

        {/* Active tool calls */}
        {!useStreamingSegmented && sessionToolCalls.length > 0 && (
          <div className="mt-4 max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
            <ToolCallList toolCalls={sessionToolCalls} />
          </div>
        )}

        {/* Inline permission requests */}
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

        {/* Inline ask-user-question requests */}
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

      {/* Background Tasks Panel */}
      <BackgroundTaskPanel sessionId={sessionId} onStopTask={(task) => {
        wsSendMessage({
          type: 'stop_background_task',
          sessionId,
          taskId: task.id,
          cliPid: task.cliPid,
          taskRootPid: task.taskRootPid,
          taskCommand: task.taskCommand,
        });
      }} />

      {/* Bottom panel */}
      <BottomPanel
        projectId={currentSession?.projectId}
        projectRoot={fileReferenceRoot}
        workingDirectory={currentSession?.workingDirectory}
      />

      {/* Queued message banner */}
      {queuedMessage && (
        <QueuedMessageBanner
          content={queuedMessage.content}
          onSendNow={handleSendNow}
          onDismiss={handleDismissQueue}
        />
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
