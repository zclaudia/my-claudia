import { useRef, useEffect, useCallback, useState } from 'react';
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
import { TokenUsageDisplay } from './TokenUsageDisplay';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useAskUserQuestionStore } from '../../stores/askUserQuestionStore';
import { useConnection } from '../../contexts/ConnectionContext';
import * as api from '../../services/api';
import { uploadFile } from '../../services/fileUpload';
import type { CommandExecuteResponse, Message, MessageAttachment, MessageInput as MessageInputData, ProviderCapabilities } from '@my-claudia/shared';
import type { MessageWithToolCalls } from '../../stores/chatStore';

// Restore tool calls from persisted metadata when loading messages from the server
function restoreToolCalls(messages: Message[]): MessageWithToolCalls[] {
  return messages.map(msg => {
    if (msg.metadata?.toolCalls && msg.metadata.toolCalls.length > 0) {
      return {
        ...msg,
        toolCalls: msg.metadata.toolCalls.map((tc, i) => ({
          id: `persisted-${msg.id}-${i}`,
          toolName: tc.name,
          toolInput: tc.input,
          status: tc.isError ? 'error' as const : 'completed' as const,
          result: tc.output,
          isError: tc.isError,
        })),
      };
    }
    return msg;
  });
}

interface ChatInterfaceProps {
  sessionId: string;
}

const MESSAGES_PER_PAGE = 50;

export function ChatInterface({ sessionId }: ChatInterfaceProps) {
  const {
    messages,
    pagination,
    addMessage,
    setMessages,
    prependMessages,
    clearMessages,
    setLoadingMore,
    currentSystemInfo,
    mode,
    setMode,
    sessionUsage,
    setModelOverride,
    getModelOverride,
    isSessionLoading,
    getSessionRunId,
    getSessionToolCalls,
  } = useChatStore();
  // Only show loading/toolCalls for THIS session's active run
  const isLoading = isSessionLoading(sessionId);
  const sessionRunId = getSessionRunId(sessionId);
  const sessionToolCalls = getSessionToolCalls(sessionId);
  const modelOverride = getModelOverride(sessionId);
  const { projects, sessions, providerCommands, providerCapabilities, setProviderCapabilities } = useProjectStore();
  const { setDrawerOpen, drawerOpen } = useTerminalStore();
  const { sendMessage: wsSendMessage, isConnected, handlePermissionDecision, handleAskUserAnswer } = useConnection();

  // Per-session pending permission/question requests
  // Also include requests without sessionId (backward compat with servers that haven't been updated)
  const permissionRequests = usePermissionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
  const askUserRequests = useAskUserQuestionStore(state => state.pendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // State for restoring message after cancel
  const [lastSentMessage, setLastSentMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const sessionMessages = messages[sessionId] || [];
  const filePushItems = useFilePushStore((state) =>
    state.items.filter((i) => i.sessionId === sessionId)
  );
  const sessionPagination = pagination[sessionId];
  const currentUsage = sessionUsage[sessionId] || { inputTokens: 0, outputTokens: 0 };

  // Get current session and project to determine provider
  const currentSession = sessions.find(s => s.id === sessionId);
  const currentProject = currentSession
    ? projects.find(p => p.id === currentSession.projectId)
    : null;

  // Reset per-session ephemeral state when switching sessions
  useEffect(() => {
    setLastSentMessage(null);
    setRestoreMessage(null);
    setUploadError(null);
    setLoadError(null);
  }, [sessionId]);

  // Ctrl+` keyboard shortcut to toggle terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`' && currentSession?.projectId) {
        e.preventDefault();
        const store = useTerminalStore.getState();
        const pid = currentSession.projectId;
        if (store.isDrawerOpen(pid)) {
          store.setDrawerOpen(pid, false);
        } else {
          if (!store.terminals[pid]) {
            store.openTerminal(pid);
          }
          store.setDrawerOpen(pid, true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentSession?.projectId]);

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
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

        prependMessages(sessionId, restoreToolCalls(result.messages), result.pagination);
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

        setMessages(sessionId, restoreToolCalls(result.messages), result.pagination);

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
  }, [sessionId, setLoadingMore, prependMessages, setMessages, scrollToBottom, isConnected]);

  // Load initial messages when session changes
  useEffect(() => {
    setInitialLoadDone(false);
    loadMessages();
  }, [sessionId, loadMessages]);

  // Load more messages (older)
  const loadMoreMessages = useCallback(async () => {
    if (!sessionPagination?.hasMore || sessionPagination?.isLoadingMore) return;

    const oldestTimestamp = sessionPagination?.oldestTimestamp;
    if (!oldestTimestamp) return;

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

  // Handle scroll to detect when user scrolls near top or away from bottom
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // If scrolled near top (within 100px), load more messages
    if (container.scrollTop < 100 && sessionPagination?.hasMore && !sessionPagination?.isLoadingMore) {
      loadMoreMessages();
    }

    // Show scroll-to-bottom button when not near the bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 300);
  }, [loadMoreMessages, sessionPagination]);

  // Fetch commands when provider or project changes (via HTTP)
  useEffect(() => {
    const providerId = currentSession?.providerId || currentProject?.providerId;
    const projectRoot = currentProject?.rootPath;

    if (!isConnected) {
      return;
    }

    if (providerId) {
      // Load commands for the specific provider
      api.getProviderCommands(providerId, projectRoot || undefined)
        .then(commands => {
          useProjectStore.getState().setProviderCommands(providerId, commands);
        })
        .catch(err => {
          console.error('Failed to load provider commands:', err);
        });
    } else {
      // No provider configured — load default commands by type
      api.getProviderTypeCommands('claude', projectRoot || undefined)
        .then(commands => {
          useProjectStore.getState().setProviderCommands('_default', commands);
        })
        .catch(err => {
          console.error('Failed to load default commands:', err);
        });
    }
  }, [currentSession?.providerId, currentProject?.providerId, currentProject?.rootPath, isConnected]);

  // Derive provider ID and fetch capabilities when it changes
  const providerId = currentSession?.providerId || currentProject?.providerId;
  // Cache key: use providerId if set, otherwise '_default' for Claude defaults
  const capsCacheKey = providerId || '_default';

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
        // Set default mode if not already set
        if (caps.defaultModeId && !useChatStore.getState().mode) {
          useChatStore.getState().setMode(caps.defaultModeId);
        }
      })
      .catch(err => {
        console.error('Failed to load provider capabilities:', err);
      });
  }, [capsCacheKey, providerId, isConnected, providerCapabilities, setProviderCapabilities]);

  const capabilities: ProviderCapabilities | null = providerCapabilities[capsCacheKey] || null;

  // Get commands for current provider (fallback to _default)
  const commands = providerCommands[providerId || '_default'] || [];

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
    if ((!content.trim() && !attachments?.length) || !isConnected) return;

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

    // Add user message to local state
    addMessage(sessionId, {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: content || '[Attachments]',
      createdAt: Date.now(),
    });

    // Send to server via WebSocket
    wsSendMessage({
      type: 'run_start',
      clientRequestId: crypto.randomUUID(),
      sessionId,
      input: fullContent,
      mode: mode || undefined,
      model: modelOverride || undefined,
    });

    // Scroll to bottom after sending
    setTimeout(() => scrollToBottom(), 100);
  };

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
        api.getProviderCommands(providerId || '_default', currentProject?.rootPath || undefined)
          .then(cmds => {
            useProjectStore.getState().setProviderCommands(providerId || '_default', cmds);
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
  }, [sessionId, clearMessages, addMessage, scrollToBottom, providerId, currentProject?.rootPath]);

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

    // Plugin commands and provider commands should be passed directly to Claude SDK
    // They are handled by Claude CLI's plugin system or built-in CLI commands
    if (commandDef?.source === 'plugin' || commandDef?.source === 'provider') {
      const commandText = args ? `${command} ${args}` : command;
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'user',
        content: commandText,
        createdAt: Date.now(),
      });

      wsSendMessage({
        type: 'run_start',
        clientRequestId: crypto.randomUUID(),
        sessionId,
        input: commandText,
        mode: mode || undefined,
        model: modelOverride || undefined,
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
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'user',
          content: `${command} ${args}`.trim(),
          createdAt: Date.now(),
        });

        wsSendMessage({
          type: 'run_start',
          clientRequestId: crypto.randomUUID(),
          sessionId,
          input: result.content,
          mode: mode || undefined,
          model: modelOverride || undefined,
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
  }, [sessionId, addMessage, wsSendMessage, commands, currentSession, currentProject, handleBuiltInCommand, mode, modelOverride]);

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

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-4 relative min-h-0"
        onScroll={handleScroll}
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

        {/* Initial load spinner */}
        {!initialLoadDone && !loadError && (
          <div className="flex items-center justify-center py-12">
            <svg className="w-5 h-5 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-2 text-sm text-muted-foreground">Loading messages...</span>
          </div>
        )}

        {/* Message load error */}
        {loadError && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <svg className="w-10 h-10 text-muted-foreground/40 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M3.515 15.795l7.07-12.243a1.64 1.64 0 012.83 0l7.07 12.243A1.64 1.64 0 0119.07 18H4.93a1.64 1.64 0 01-1.415-2.205z" />
            </svg>
            <p className="text-sm text-muted-foreground mb-1">{loadError}</p>
            <button
              onClick={() => { setLoadError(null); setInitialLoadDone(false); loadMessages(); }}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 rounded transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        <MessageList messages={sessionMessages} filePushItems={filePushItems} />

        {/* Loading indicator (shown while waiting for response) */}
        <LoadingIndicator isLoading={isLoading} />

        {/* Active tool calls (shown during streaming) */}
        {sessionToolCalls.length > 0 && (
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
            onClick={() => scrollToBottom()}
            className="sticky bottom-4 float-right mr-2 z-10 w-9 h-9 rounded-full bg-muted/90 border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-foreground">
              <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Terminal panel (inline between messages and input) */}
      {currentSession?.projectId && (
        <TerminalPanel projectId={currentSession.projectId} />
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="mx-2 md:mx-4 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="flex-1">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="text-destructive hover:text-destructive/80 font-medium">Dismiss</button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-2 md:p-4 safe-bottom-pad overflow-visible flex-shrink-0">
        {/* Toolbar */}
        <div className="mb-2 md:mb-3 flex items-center gap-2 md:gap-3 flex-wrap">
          <ModeSelector
            capabilities={capabilities}
            value={mode}
            onChange={setMode}
            disabled={isLoading}
          />
          <ModelSelector
            capabilities={capabilities}
            value={modelOverride}
            onChange={(model: string) => setModelOverride(sessionId, model)}
            disabled={isLoading}
          />
          <TokenUsageDisplay
            inputTokens={currentUsage.inputTokens}
            outputTokens={currentUsage.outputTokens}
          />
          <div className="flex-1" />
          {useServerStore.getState().activeServerSupports('remoteTerminal') && currentSession?.projectId && (() => {
            const pid = currentSession.projectId;
            const isOpen = !!drawerOpen[pid];
            return (
              <button
                onClick={() => {
                  if (isOpen) {
                    setDrawerOpen(pid, false);
                  } else {
                    const store = useTerminalStore.getState();
                    if (!store.terminals[pid]) {
                      store.openTerminal(pid);
                    }
                    setDrawerOpen(pid, true);
                  }
                }}
                className={`p-1.5 rounded hover:bg-secondary ${isOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title={isOpen ? 'Hide terminal (Ctrl+`)' : 'Open terminal (Ctrl+`)'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            );
          })()}
          <SystemInfoButton systemInfo={currentSystemInfo} />
        </div>
        <MessageInput
          key={sessionId}
          onSend={handleSendMessage}
          onCancel={handleCancelRun}
          onCommand={handleCommand}
          commands={commands}
          projectRoot={currentProject?.rootPath}
          disabled={!isConnected}
          isLoading={isLoading}
          initialValue={restoreMessage?.content}
          initialAttachments={restoreMessage?.attachments}
          placeholder={
            !isConnected
              ? 'Connecting...'
              : isLoading
              ? 'Waiting for response...'
              : mode === 'plan'
              ? 'Plan Mode: Analyze and plan (no code changes)...'
              : 'Type a message... (Enter to send)'
          }
        />
      </div>
    </div>
  );
}
