import { useRef, useEffect, useCallback, useState } from 'react';
import { useChatStore, type MessageWithToolCalls } from '../../stores/chatStore';
import { useFilePushStore } from '../../stores/filePushStore';
import { useUIStore } from '../../stores/uiStore';
import * as api from '../../services/api';
import type { Message } from '@my-claudia/shared';

const MESSAGES_PER_PAGE = 50;
const BOTTOM_REFRESH_LIMIT = 12;
const BOTTOM_REFRESH_COOLDOWN_MS = 2500;
const SUPPRESS_LOAD_MORE_MS = 1200;

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

interface UseMessagePaginationParams {
  sessionId: string;
  isConnected: boolean;
  isMobile: boolean;
}

export function useMessagePagination({
  sessionId,
  isConnected,
  isMobile,
}: UseMessagePaginationParams) {
  const pagination = useChatStore((s) => s.pagination);
  const setMessages = useChatStore((s) => s.setMessages);
  const prependMessages = useChatStore((s) => s.prependMessages);
  const appendMessages = useChatStore((s) => s.appendMessages);
  const setLoadingMore = useChatStore((s) => s.setLoadingMore);
  const sessionMessages = useChatStore((s) => s.messages[sessionId]);

  const {
    forceScrollToBottomSessionId,
    consumeForceScrollToBottom,
    pendingMessageJump,
    clearMessageJump,
  } = useUIStore();

  const sessionPagination = pagination[sessionId];

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRefreshRef = useRef<{ lastAt: number; inFlight: boolean }>({ lastAt: 0, inFlight: false });
  const lastScrollTopRef = useRef(0);
  const suppressLoadMoreUntilRef = useRef<number>(0);
  const messageJumpTimeoutRef = useRef<number | null>(null);

  // State
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, viewportHeight: 0 });
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollToBottom = useCallback((instant = false) => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: instant || isMobile ? 'auto' : 'smooth',
      });
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: instant || isMobile ? 'auto' : 'smooth' });
  }, [isMobile]);

  const jumpToBottomInstant = useCallback(() => {
    suppressLoadMoreUntilRef.current = Date.now() + SUPPRESS_LOAD_MORE_MS;
    scrollToBottom(true);
  }, [scrollToBottom]);

  const scrollToMessage = useCallback((messageId: string) => {
    const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(messageId) : messageId;
    const target = document.querySelector(`[data-message-id="${escapedId}"]`);
    if (!(target instanceof HTMLElement)) return false;

    target.scrollIntoView({ block: 'center', behavior: isMobile ? 'auto' : 'smooth' });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 2500);
    return true;
  }, [isMobile]);

  const positionViewportForMessageJump = useCallback((messageId: string) => {
    const container = messagesContainerRef.current;
    const msgs = sessionMessages || [];
    if (!container || msgs.length === 0) return false;

    const messageIndex = msgs.findIndex((message) => message.id === messageId);
    if (messageIndex === -1) return false;

    const progress = msgs.length <= 1
      ? 0
      : messageIndex / (msgs.length - 1);
    const targetTop = Math.max(
      0,
      (container.scrollHeight * progress) - (container.clientHeight / 2),
    );

    suppressLoadMoreUntilRef.current = Date.now() + SUPPRESS_LOAD_MORE_MS;
    container.scrollTo({ top: targetTop, behavior: 'auto' });
    return true;
  }, [sessionMessages]);

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
          autoDownload: false,
        });
      }
    }
  }, []);

  // Load messages with pagination (all via HTTP)
  const loadMessages = useCallback(async (before?: number, signal?: AbortSignal) => {
    try {
      if (before) {
        // Load more (older messages)
        setLoadingMore(sessionId, true);

        const result = await api.getSessionMessages(sessionId, {
          limit: MESSAGES_PER_PAGE,
          before,
          signal,
        });

        const restoredOlder = restoreToolCalls(result.messages);
        prependMessages(sessionId, restoredOlder, result.pagination);
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
        const result = await api.getSessionMessages(
          sessionId,
          pendingMessageJump?.sessionId === sessionId
            ? { limit: MESSAGES_PER_PAGE, aroundMessageId: pendingMessageJump.messageId, signal }
            : { limit: MESSAGES_PER_PAGE, signal }
        );

        const restoredMessages = restoreToolCalls(result.messages);
        setMessages(sessionId, restoredMessages, result.pagination);
        syncFilePushMessages(restoredMessages);

        // Restore active run state (fixes loading state lost after page refresh)
        if (result.activeRun) {
          const chatState = useChatStore.getState();
          if (!chatState.activeRuns[result.activeRun.runId]) {
            chatState.startRun(result.activeRun.runId, sessionId);
          }
        }

        setInitialLoadDone(true);
        setTimeout(() => {
          if (pendingMessageJump?.sessionId === sessionId) {
            return;
          }
          scrollToBottom(true);
        }, 0);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('Failed to load messages:', error);
      setLoadingMore(sessionId, false);
      if (!before) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
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
  }, [sessionId, setLoadingMore, prependMessages, setMessages, scrollToBottom, isConnected, syncFilePushMessages, pendingMessageJump]);

  // Load initial messages when session changes
  useEffect(() => {
    setInitialLoadDone(false);
    const controller = new AbortController();
    loadMessages(undefined, controller.signal);
    return () => controller.abort();
  }, [sessionId, loadMessages]);

  // Message jump effect
  useEffect(() => {
    if (pendingMessageJump?.sessionId !== sessionId) return;
    if (!initialLoadDone) return;

    const { messageId } = pendingMessageJump;
    if (messageJumpTimeoutRef.current != null) {
      window.clearTimeout(messageJumpTimeoutRef.current);
      messageJumpTimeoutRef.current = null;
    }

    let cancelled = false;
    let attempts = 0;

    const tryJump = () => {
      if (cancelled) return;
      if (scrollToMessage(messageId)) {
        clearMessageJump(sessionId, messageId);
        messageJumpTimeoutRef.current = null;
        return;
      }

      if (attempts === 0) {
        positionViewportForMessageJump(messageId);
      }

      attempts += 1;
      if (attempts >= 4) {
        clearMessageJump(sessionId, messageId);
        messageJumpTimeoutRef.current = null;
        return;
      }

      messageJumpTimeoutRef.current = window.setTimeout(tryJump, 80);
    };

    tryJump();

    return () => {
      cancelled = true;
      if (messageJumpTimeoutRef.current != null) {
        window.clearTimeout(messageJumpTimeoutRef.current);
        messageJumpTimeoutRef.current = null;
      }
    };
  }, [pendingMessageJump, sessionId, initialLoadDone, clearMessageJump, scrollToMessage, positionViewportForMessageJump]);

  // One-shot jump: when entering from Active Sessions, force scroll to latest content
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

  // Fallback sync: fetch latest when user is at bottom
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

    // If scrolled near top (within 100px), load more messages
    const suppressLoadMore = Date.now() < suppressLoadMoreUntilRef.current;
    if (!suppressLoadMore && currentScrollTop < 100 && sessionPagination?.hasMore && !sessionPagination?.isLoadingMore) {
      loadMoreMessages();
    }

    // Show scroll-to-bottom button when not near the bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 300);
    // Mobile-safe fallback: touch scrolling won't fire wheel events
    if (wasScrollingDown && distanceFromBottom <= 24) {
      void refreshLatestMessagesFromBottom();
    }
  }, [loadMoreMessages, refreshLatestMessagesFromBottom, sessionPagination]);

  // Scroll metrics resize listener
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

  // Retry initial load (e.g., after error)
  const retryLoad = useCallback(() => {
    setLoadError(null);
    setInitialLoadDone(false);
    loadMessages();
  }, [loadMessages]);

  // Reset refs when session changes
  const resetRefs = useCallback(() => {
    bottomRefreshRef.current = { lastAt: 0, inFlight: false };
    lastScrollTopRef.current = 0;
    if (messageJumpTimeoutRef.current != null) {
      window.clearTimeout(messageJumpTimeoutRef.current);
      messageJumpTimeoutRef.current = null;
    }
    setScrollMetrics({ scrollTop: 0, viewportHeight: 0 });
    setLoadError(null);
  }, []);

  return {
    // Refs (for JSX binding)
    messagesEndRef,
    messagesContainerRef,
    // State
    initialLoadDone,
    showScrollToBottom,
    scrollMetrics,
    highlightedMessageId,
    loadError,
    setLoadError,
    sessionPagination,
    // Actions
    scrollToBottom,
    jumpToBottomInstant,
    scrollToMessage,
    loadMoreMessages,
    handleScroll,
    handleMessageWheel,
    retryLoad,
    resetRefs,
  };
}
