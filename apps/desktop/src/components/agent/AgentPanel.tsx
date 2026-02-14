import { useRef, useEffect, useCallback, useState } from 'react';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { ToolCallList } from '../chat/ToolCallItem';
import { LoadingIndicator } from '../chat/LoadingIndicator';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { useAgentStore } from '../../stores/agentStore';
import { useChatStore } from '../../stores/chatStore';
import { useConnection } from '../../contexts/ConnectionContext';
import * as api from '../../services/api';
import type { Message, SlashCommand, ProviderConfig } from '@my-claudia/shared';
import type { MessageWithToolCalls } from '../../stores/chatStore';

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

// Desktop: floating card. Mobile: full-screen.
const PANEL_CLASS_DESKTOP = 'w-[400px] h-[600px] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden';
const PANEL_CLASS_MOBILE = 'w-full h-full bg-card flex flex-col overflow-hidden';

interface AgentPanelProps {
  isMobile?: boolean;
}

export function AgentPanel({ isMobile = false }: AgentPanelProps) {
  const { agentSessionId, setExpanded, isLoading, showSettings, setShowSettings, interceptionCount, selectedProviderId, setSelectedProviderId } = useAgentStore();
  const { messages, setMessages, addMessage, isSessionLoading, getSessionRunId, getSessionToolCalls } = useChatStore();
  const { sendMessage: wsSendMessage, isConnected } = useConnection();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);

  const panelClass = isMobile ? PANEL_CLASS_MOBILE : PANEL_CLASS_DESKTOP;

  const sessionId = agentSessionId;
  const sessionMessages = sessionId ? messages[sessionId] || [] : [];
  const loading = sessionId ? isSessionLoading(sessionId) : false;
  const sessionRunId = sessionId ? getSessionRunId(sessionId) : null;
  const sessionToolCalls = sessionId ? getSessionToolCalls(sessionId) : [];

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  }, []);

  // Load messages when agent session is available
  useEffect(() => {
    if (!sessionId || !isConnected) return;

    setInitialLoadDone(false);
    api.getSessionMessages(sessionId, { limit: 50 })
      .then(result => {
        setMessages(sessionId, restoreToolCalls(result.messages), result.pagination);
        setInitialLoadDone(true);
        setTimeout(() => scrollToBottom(true), 0);
      })
      .catch(err => {
        console.error('[AgentPanel] Failed to load messages:', err);
        setMessages(sessionId, [], { total: 0, hasMore: false });
        setInitialLoadDone(true);
      });
  }, [sessionId, isConnected, setMessages, scrollToBottom]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (initialLoadDone && sessionMessages.length > 0) {
      const container = messagesContainerRef.current;
      if (!container) return;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) scrollToBottom();
    }
  }, [sessionMessages.length, initialLoadDone, scrollToBottom]);

  // Auto-scroll on tool calls update
  useEffect(() => {
    if (initialLoadDone && sessionToolCalls.length > 0) {
      const container = messagesContainerRef.current;
      if (!container) return;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) scrollToBottom();
    }
  }, [sessionToolCalls, initialLoadDone, scrollToBottom]);

  // Load providers
  useEffect(() => {
    if (!isConnected) return;
    api.getProviders()
      .then(list => {
        setProviders(list);
        // Auto-select default provider if none selected
        if (!selectedProviderId && list.length > 0) {
          const defaultProvider = list.find(p => p.isDefault) || list[0];
          setSelectedProviderId(defaultProvider.id);
        }
      })
      .catch(err => console.error('[AgentPanel] Failed to load providers:', err));
  }, [isConnected, selectedProviderId, setSelectedProviderId]);

  const selectedProvider = providers.find(p => p.id === selectedProviderId);

  // Load slash commands based on selected provider type
  useEffect(() => {
    if (!isConnected) return;
    const providerType = selectedProvider?.type || 'claude';
    api.getProviderTypeCommands(providerType)
      .then(setCommands)
      .catch(err => console.error('[AgentPanel] Failed to load commands:', err));
  }, [isConnected, selectedProvider?.type]);

  const sendAgentRun = useCallback((input: string, displayContent?: string) => {
    if (!sessionId || !isConnected) return;

    addMessage(sessionId, {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: displayContent || input,
      createdAt: Date.now(),
    });

    const clientRequestId = `agent_${crypto.randomUUID()}`;
    wsSendMessage({
      type: 'run_start',
      clientRequestId,
      sessionId,
      input,
      ...(selectedProviderId && { providerId: selectedProviderId }),
    });

    setTimeout(() => scrollToBottom(), 100);
  }, [sessionId, isConnected, selectedProviderId, addMessage, wsSendMessage, scrollToBottom]);

  const handleSend = useCallback((content: string) => {
    if (!content.trim()) return;
    sendAgentRun(content);
  }, [sendAgentRun]);

  const handleCommand = useCallback(async (command: string, args: string) => {
    if (!sessionId) return;

    const commandDef = commands.find(c => c.command === command);

    // Plugin/provider commands — send directly as input
    if (commandDef?.source === 'plugin' || commandDef?.source === 'provider') {
      const commandText = args ? `${command} ${args}` : command;
      sendAgentRun(commandText);
      return;
    }

    // Built-in and custom commands — execute via API
    const argsArray = args.trim() ? args.trim().split(/\s+/) : [];
    try {
      const result = await api.executeCommand({
        commandName: command,
        commandPath: commandDef?.filePath,
        args: argsArray,
        context: { sessionId, provider: 'claude', model: 'default' },
      });

      if (result.type === 'builtin') {
        // Show built-in result as system message
        const data = result.data as Record<string, unknown>;
        const text = (data?.content || data?.message || JSON.stringify(data)) as string;
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: text,
          createdAt: Date.now(),
        });
      } else if (result.type === 'custom' && result.content) {
        // Custom command — send processed markdown content as AI input
        sendAgentRun(result.content, `${command} ${args}`.trim());
      }
    } catch (error) {
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`,
        createdAt: Date.now(),
      });
    }
  }, [sessionId, commands, addMessage, sendAgentRun]);

  const handleCancel = useCallback(() => {
    if (!sessionRunId) return;
    wsSendMessage({
      type: 'run_cancel',
      runId: sessionRunId,
    });
  }, [sessionRunId, wsSendMessage]);

  // Settings view
  if (showSettings) {
    return (
      <div className={panelClass}>
        <AgentSettingsPanel onClose={() => setShowSettings(false)} />
      </div>
    );
  }

  return (
    <div className={panelClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🤖</span>
          <span className="font-semibold text-sm">Agent</span>
          {providers.length > 1 && (
            <select
              value={selectedProviderId || ''}
              onChange={(e) => setSelectedProviderId(e.target.value || null)}
              className="text-xs bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground max-w-[100px] truncate"
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {providers.length <= 1 && selectedProvider && (
            <span className="text-xs text-muted-foreground">{selectedProvider.name}</span>
          )}
          {interceptionCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 font-medium">
              {interceptionCount} auto
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Permission settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-3"
      >
        {sessionMessages.length === 0 && initialLoadDone && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <div className="text-center">
              <p className="mb-1">Hi! I'm your Agent Assistant.</p>
              <p className="text-xs text-muted-foreground/70">
                I can manage projects, sessions, and providers.
              </p>
            </div>
          </div>
        )}

        <MessageList messages={sessionMessages} />

        <LoadingIndicator isLoading={loading || isLoading} />

        {sessionToolCalls.length > 0 && (
          <div className="mt-2 px-2">
            <ToolCallList toolCalls={sessionToolCalls} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex-shrink-0">
        <MessageInput
          onSend={handleSend}
          onCommand={handleCommand}
          commands={commands}
          onCancel={loading ? handleCancel : undefined}
          disabled={!isConnected || !sessionId}
          isLoading={loading || isLoading}
          placeholder={
            !isConnected
              ? 'Connecting...'
              : !sessionId
              ? 'Setting up...'
              : loading
              ? 'Working...'
              : 'Ask me anything...'
          }
        />
      </div>
    </div>
  );
}
