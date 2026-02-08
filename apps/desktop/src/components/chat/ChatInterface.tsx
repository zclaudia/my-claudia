import { useRef, useEffect, useCallback, useState } from 'react';
import { MessageList } from './MessageList';
import { MessageInput, type Attachment } from './MessageInput';
import { ToolCallList } from './ToolCallItem';
import { LoadingIndicator } from './LoadingIndicator';
import { PermissionModeToggle } from './PermissionModeToggle';
import { FontSizeSelector } from './FontSizeSelector';
import { SystemInfoButton } from './SystemInfoButton';
import { ModelSelector } from './ModelSelector';
import { TokenUsageDisplay } from './TokenUsageDisplay';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConnection } from '../../contexts/ConnectionContext';
import * as api from '../../services/api';
import { uploadFile } from '../../services/fileUpload';
import type { CommandExecuteResponse, Message, MessageAttachment, MessageInput as MessageInputData } from '@my-claudia/shared';
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
    isLoading,
    currentRunId,
    activeToolCalls,
    currentSystemInfo,
    permissionMode,
    setPermissionMode,
    sessionUsage,
    modelOverride,
    setModelOverride,
  } = useChatStore();
  const { projects, sessions, providerCommands } = useProjectStore();
  const { sendMessage: wsSendMessage, isConnected } = useConnection();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const sessionMessages = messages[sessionId] || [];
  const sessionPagination = pagination[sessionId];
  const currentUsage = sessionUsage[sessionId] || { inputTokens: 0, outputTokens: 0 };

  // Get current session and project to determine provider
  const currentSession = sessions.find(s => s.id === sessionId);
  const currentProject = currentSession
    ? projects.find(p => p.id === currentSession.projectId)
    : null;

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

        const result = await api.getSessionMessages(sessionId, {
          limit: MESSAGES_PER_PAGE
        });

        setMessages(sessionId, restoreToolCalls(result.messages), result.pagination);
        setInitialLoadDone(true);
        // Scroll to bottom on initial load - use instant to avoid visible scroll animation
        setTimeout(() => scrollToBottom(true), 0);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      setLoadingMore(sessionId, false);
      // On error, set empty messages to prevent undefined
      if (!before) {
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

  // Handle scroll to detect when user scrolls near top
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // If scrolled near top (within 100px), load more messages
    if (container.scrollTop < 100 && sessionPagination?.hasMore && !sessionPagination?.isLoadingMore) {
      loadMoreMessages();
    }
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

  // Get commands for current provider (fallback to _default)
  const providerId = currentSession?.providerId || currentProject?.providerId;
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

  const handleSendMessage = async (content: string, attachments?: Attachment[]) => {
    if ((!content.trim() && !attachments?.length) || !isConnected) return;

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
        // TODO: Show error notification to user
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
      permissionMode,
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

      default:
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Command ${cmdName} executed.`,
          createdAt: Date.now(),
        });
    }
  }, [sessionId, clearMessages, addMessage]);

  const handleCommand = useCallback(async (command: string, args: string) => {
    // Find the command definition to check its source
    const commandDef = commands.find(c => c.command === command);

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
        permissionMode,
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
      provider: currentSession?.providerId || currentProject?.providerId,
      model: 'claude', // Could be enhanced to get actual model
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
          permissionMode,
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
  }, [sessionId, addMessage, wsSendMessage, commands, currentSession, currentProject, handleBuiltInCommand, permissionMode, modelOverride]);

  const handleCancelRun = () => {
    if (!currentRunId) return;

    wsSendMessage({
      type: 'run_cancel',
      runId: currentRunId,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-2 md:p-4"
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

        <MessageList messages={sessionMessages} />

        {/* Loading indicator (shown while waiting for response) */}
        <LoadingIndicator isLoading={isLoading} />

        {/* Active tool calls (shown during streaming) */}
        {Object.keys(activeToolCalls).length > 0 && (
          <div className="mt-4 px-4">
            <ToolCallList toolCalls={Object.values(activeToolCalls)} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-2 md:p-4">
        {/* Toolbar */}
        <div className="mb-2 md:mb-3 flex items-center gap-2 md:gap-3 flex-wrap">
          <PermissionModeToggle
            mode={permissionMode}
            onModeChange={setPermissionMode}
            disabled={isLoading}
          />
          <ModelSelector
            value={modelOverride}
            onChange={setModelOverride}
            disabled={isLoading}
          />
          <TokenUsageDisplay
            inputTokens={currentUsage.inputTokens}
            outputTokens={currentUsage.outputTokens}
          />
          <div className="flex-1" />
          <button
            onClick={() => handleCommand('/compact', '')}
            disabled={isLoading || !isConnected}
            className="px-2.5 py-1.5 rounded-full text-xs font-medium border border-border
              hover:border-primary/50 active:bg-muted transition-colors min-h-[36px]
              disabled:opacity-50 disabled:cursor-not-allowed text-muted-foreground"
            title="Compact conversation context"
          >
            Compact
          </button>
          <FontSizeSelector />
          <SystemInfoButton systemInfo={currentSystemInfo} />
        </div>
        <MessageInput
          onSend={handleSendMessage}
          onCancel={handleCancelRun}
          onCommand={handleCommand}
          commands={commands}
          projectRoot={currentProject?.rootPath}
          disabled={!isConnected}
          isLoading={isLoading}
          placeholder={
            !isConnected
              ? 'Connecting...'
              : isLoading
              ? 'Waiting for response...'
              : permissionMode === 'plan'
              ? 'Plan Mode: Ask Claude to analyze and plan (no code changes)...'
              : 'Type a message... (Enter to send)'
          }
        />
      </div>
    </div>
  );
}
