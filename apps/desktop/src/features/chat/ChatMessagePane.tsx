import { useRef, useEffect, useCallback, useMemo, memo, type RefObject } from 'react';
import { Loader2, AlertTriangle, ArrowDown } from 'lucide-react';
import { MessageList } from './MessageList';
import { ToolCallList } from './tool-call/ToolCallList';
import { LoadingIndicator } from './LoadingIndicator';
import { InlinePermissionRequest } from './InlinePermissionRequest';
import { InteractionItem } from './InteractionItem';
import type { MessageWithToolCalls, ToolCallState, RunHealth } from '../../stores/chatStore';
import type { PermissionRequest } from '../../stores/permissionStore';
import type { ContentBlock } from '@my-claudia/shared';
import type { PaginationInfo } from '../../stores/chatStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { isPlanProposalTool } from './tool-call/toolClassifiers';

const AUTO_STICK_BOTTOM_THRESHOLD_PX = 200;

interface ChatMessagePaneProps {
  sessionId: string;
  // Pagination / scroll refs & state
  messagesEndRef: RefObject<HTMLDivElement>;
  messagesContainerRef: RefObject<HTMLDivElement>;
  initialLoadDone: boolean;
  showScrollToBottom: boolean;
  scrollMetrics: { scrollTop: number; viewportHeight: number };
  highlightedMessageId: string | null;
  loadError: string | null;
  sessionPagination: PaginationInfo | undefined;
  scrollToBottom: (instant?: boolean) => void;
  jumpToBottomInstant: () => void;
  loadMoreMessages: () => Promise<void>;
  handleScroll: () => void;
  handleMessageWheel: (deltaY: number) => void;
  retryLoad: () => void;

  // Message / streaming data
  sessionMessages: MessageWithToolCalls[];
  lastSessionMessage: MessageWithToolCalls | null;
  lastStreamingBlock: ContentBlock | null;
  streamingContentSignature: string;
  useStreamingSegmented: boolean;
  sessionContentBlocks: ContentBlock[];
  sessionToolCallHistory: ToolCallState[];
  sessionToolCalls: ToolCallState[];
  sessionHealth: RunHealth | null;
  isLoading: boolean;

  // Resend
  resendTargetMessageId: string | undefined;
  resendDisabled: boolean;
  onResendTarget: () => void;
  onCancelRun: () => void;

  // Permission / ask-user
  permissionRequests: PermissionRequest[];
  onPermissionDecision: (requestId: string, allow: boolean, remember?: boolean, credential?: string, feedback?: string) => Promise<void>;

  // File reference resolution context
  fileReferenceRoot?: string;
  fileReferenceBackendId?: string | null;
}

export const ChatMessagePane = memo(function ChatMessagePane({
  sessionId,
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
  sessionMessages,
  lastSessionMessage,
  lastStreamingBlock,
  streamingContentSignature,
  useStreamingSegmented,
  sessionContentBlocks,
  sessionToolCallHistory,
  sessionToolCalls,
  sessionHealth,
  isLoading,
  resendTargetMessageId,
  resendDisabled,
  onResendTarget,
  onCancelRun,
  permissionRequests,
  onPermissionDecision,
  fileReferenceRoot,
  fileReferenceBackendId,
}: ChatMessagePaneProps) {
  const interactionsMap = useInteractionStore((state) => state.interactions);
  const promptInteractions = useMemo(() => {
    const inlinePromptInteractionIds = new Set(
      [...sessionToolCallHistory, ...sessionToolCalls]
        .filter((toolCall) => toolCall.toolName === 'AskUserQuestion')
        .map((toolCall) => toolCall.id),
    );

    return Object.values(interactionsMap)
      .filter((interaction) =>
        interaction.sessionId === sessionId
        && interaction.type === 'interaction_prompt'
        && interaction.source === 'provider_native'
        && !inlinePromptInteractionIds.has(interaction.interactionId)
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  },
    [interactionsMap, sessionId, sessionToolCallHistory, sessionToolCalls],
  );
  const planReviewInteractions = useMemo(() => {
    const toolCalls = [...sessionToolCallHistory, ...sessionToolCalls];
    const hasPlanProposalTool = toolCalls.some((toolCall) =>
      isPlanProposalTool(toolCall.toolName, toolCall.semantic)
    );
    if (hasPlanProposalTool) return [];

    return Object.values(interactionsMap)
      .filter((interaction) =>
        interaction.sessionId === sessionId
        && interaction.type === 'interaction_plan_review'
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [interactionsMap, sessionId, sessionToolCallHistory, sessionToolCalls]);
  const shouldStickToBottomRef = useRef(true);
  const lastObservedScrollTopRef = useRef(0);
  const prevMessageCountRef = useRef<number | null>(null);
  const prevStreamingSignatureRef = useRef<string | null>(null);
  const prevToolCallCountRef = useRef<number | null>(null);

  // Reset sticky-to-bottom on session switch so the new session always scrolls to bottom
  useEffect(() => {
    shouldStickToBottomRef.current = true;
    lastObservedScrollTopRef.current = 0;
    prevMessageCountRef.current = null;
    prevStreamingSignatureRef.current = null;
    prevToolCallCountRef.current = null;
  }, [sessionId]);

  const hasSessionSnapshot = !!sessionPagination;
  const isInitialMessageLoading = !loadError && (!initialLoadDone || !hasSessionSnapshot);

  const updateStickToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < AUTO_STICK_BOTTOM_THRESHOLD_PX;
  }, [messagesContainerRef]);

  const scrollToBottomIfSticky = useCallback((instant = false) => {
    if (!shouldStickToBottomRef.current) return;
    scrollToBottom(instant);
  }, [scrollToBottom]);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      const currentScrollTop = container.scrollTop;
      const distanceFromBottom = container.scrollHeight - currentScrollTop - container.clientHeight;
      const isScrollingUp = currentScrollTop < lastObservedScrollTopRef.current;

      if (isScrollingUp && distanceFromBottom > 0) {
        // Any explicit upward scroll should disengage auto-stick immediately,
        // otherwise streaming updates can yank the viewport back to the bottom.
        shouldStickToBottomRef.current = false;
      } else {
        updateStickToBottom();
      }

      lastObservedScrollTopRef.current = currentScrollTop;
    }
    handleScroll();
  }, [handleScroll, messagesContainerRef, updateStickToBottom]);

  const handleJumpToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    jumpToBottomInstant();
  }, [jumpToBottomInstant]);

  // Scroll to bottom when new messages arrive (but not when loading history)
  useEffect(() => {
    if (!initialLoadDone || sessionMessages.length === 0) return;
    if (prevMessageCountRef.current == null) {
      prevMessageCountRef.current = sessionMessages.length;
      return;
    }
    if (prevMessageCountRef.current !== sessionMessages.length) {
      scrollToBottomIfSticky();
    }
    prevMessageCountRef.current = sessionMessages.length;
  }, [sessionMessages.length, initialLoadDone, scrollToBottomIfSticky]);

  // Keep the viewport pinned when the last message keeps growing during streaming.
  useEffect(() => {
    if (!initialLoadDone) return;
    if (!lastSessionMessage && !lastStreamingBlock) return;
    const currentStreamingSignature = [
      lastSessionMessage?.id ?? '',
      lastSessionMessage?.content ?? '',
      lastStreamingBlock?.type ?? '',
      streamingContentSignature,
    ].join('::');
    if (prevStreamingSignatureRef.current == null) {
      prevStreamingSignatureRef.current = currentStreamingSignature;
      return;
    }
    if (prevStreamingSignatureRef.current === currentStreamingSignature) return;
    prevStreamingSignatureRef.current = currentStreamingSignature;
    scrollToBottomIfSticky();
  }, [
    initialLoadDone,
    lastSessionMessage?.id,
    lastSessionMessage?.content,
    lastStreamingBlock?.type,
    streamingContentSignature,
    scrollToBottomIfSticky,
  ]);

  // Scroll to bottom when tool calls are updated (during streaming)
  useEffect(() => {
    if (!initialLoadDone || sessionToolCalls.length === 0) return;
    if (prevToolCallCountRef.current == null) {
      prevToolCallCountRef.current = sessionToolCalls.length;
      return;
    }
    if (prevToolCallCountRef.current !== sessionToolCalls.length) {
      scrollToBottomIfSticky();
    }
    prevToolCallCountRef.current = sessionToolCalls.length;
  }, [sessionToolCalls, initialLoadDone, scrollToBottomIfSticky]);

  // Force scroll to bottom when permission requests arrive — these need immediate attention
  useEffect(() => {
    if (initialLoadDone && permissionRequests.length > 0) {
      scrollToBottom();
    }
  }, [permissionRequests.length, initialLoadDone, scrollToBottom]);

  useEffect(() => {
    if (initialLoadDone && (promptInteractions.length > 0 || planReviewInteractions.length > 0)) {
      scrollToBottom();
    }
  }, [promptInteractions.length, planReviewInteractions.length, initialLoadDone, scrollToBottom]);

  return (
    <div
      ref={messagesContainerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden pl-2 pr-3 py-2 md:p-4 relative min-h-0"
      onScroll={handleMessagesScroll}
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
            className="mt-2 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 rounded-md transition-colors"
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
        resendTargetMessageId={resendTargetMessageId}
        highlightedMessageId={highlightedMessageId}
        resendDisabled={resendDisabled}
        onResendTarget={onResendTarget}
        fileReferenceRoot={fileReferenceRoot}
        fileReferenceBackendId={fileReferenceBackendId}
      />

      <LoadingIndicator
        isLoading={isLoading}
        health={sessionHealth?.health}
        loopPattern={sessionHealth?.loopPattern}
        startedAt={sessionHealth?.startedAt}
        lastActivityAt={sessionHealth?.lastActivityAt}
        onCancel={onCancelRun}
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
              onDecision={onPermissionDecision}
            />
          ))}
        </div>
      )}

      {promptInteractions.length > 0 && (
        <div className="mt-4 space-y-3 max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
          {promptInteractions.map((interaction) => (
            <InteractionItem key={interaction.interactionId} interaction={interaction} />
          ))}
        </div>
      )}

      {planReviewInteractions.length > 0 && (
        <div className="mt-4 space-y-3 max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
          {planReviewInteractions.map((interaction) => (
            <InteractionItem key={interaction.interactionId} interaction={interaction} />
          ))}
        </div>
      )}

      <div ref={messagesEndRef} />

      {showScrollToBottom && (
        <button
          onClick={handleJumpToBottom}
          className="sticky bottom-4 float-right mr-2 z-10 w-9 h-9 rounded-full bg-muted/90 border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={16} strokeWidth={1.5} className="text-foreground" />
        </button>
      )}
    </div>
  );
});
