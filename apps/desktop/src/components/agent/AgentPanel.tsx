import { useRef, useEffect, useCallback, useState } from 'react';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { ToolCallList } from '../chat/ToolCallItem';
import { LoadingIndicator } from '../chat/LoadingIndicator';
import { useAgentStore } from '../../stores/agentStore';
import type { BackgroundSessionInfo } from '../../stores/agentStore';
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
  const { agentSessionId, setExpanded, isLoading, interceptionCount, selectedProviderId, backgroundSessions, removeBackgroundPermission } = useAgentStore();
  const { messages, setMessages, addMessage, isSessionLoading, getSessionRunId, getSessionToolCalls } = useChatStore();
  const { sendMessage: wsSendMessage, isConnected } = useConnection();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [bgTasksExpanded, setBgTasksExpanded] = useState(false);

  const bgSessionList = Object.values(backgroundSessions);
  const hasPending = bgSessionList.some(s => s.pendingPermissions.length > 0);

  const handlePermissionDecision = useCallback((requestId: string, sessionId: string, allow: boolean) => {
    wsSendMessage({
      type: 'permission_decision',
      requestId,
      allow,
    });
    removeBackgroundPermission(sessionId, requestId);
  }, [wsSendMessage, removeBackgroundPermission]);

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

  // Load provider name and slash commands based on selected provider
  useEffect(() => {
    if (!isConnected) return;
    api.getProviders()
      .then((list: ProviderConfig[]) => {
        const selected = list.find(p => p.id === selectedProviderId);
        setProviderName(selected?.name || list.find(p => p.isDefault)?.name || null);
        const providerType = selected?.type || 'claude';
        return api.getProviderTypeCommands(providerType);
      })
      .then(setCommands)
      .catch(err => console.error('[AgentPanel] Failed to load provider info:', err));
  }, [isConnected, selectedProviderId]);

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

  return (
    <div className={panelClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🤖</span>
          <span className="font-semibold text-sm">Agent</span>
          {providerName && (
            <span className="text-xs text-muted-foreground">{providerName}</span>
          )}
          {interceptionCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 font-medium">
              {interceptionCount} auto
            </span>
          )}
        </div>
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

      {/* Background Tasks */}
      {bgSessionList.length > 0 && (
        <BackgroundTasksBar
          sessions={bgSessionList}
          expanded={bgTasksExpanded}
          hasPending={hasPending}
          onToggle={() => setBgTasksExpanded(!bgTasksExpanded)}
          onPermissionDecision={handlePermissionDecision}
        />
      )}

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

// ============================================
// Background Tasks Bar
// ============================================

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  running: { color: 'bg-blue-500', label: 'Running' },
  paused: { color: 'bg-amber-500', label: 'Paused' },
  completed: { color: 'bg-green-500', label: 'Done' },
  failed: { color: 'bg-red-500', label: 'Failed' },
};

function BackgroundTasksBar({
  sessions,
  expanded,
  hasPending,
  onToggle,
  onPermissionDecision,
}: {
  sessions: BackgroundSessionInfo[];
  expanded: boolean;
  hasPending: boolean;
  onToggle: () => void;
  onPermissionDecision: (requestId: string, sessionId: string, allow: boolean) => void;
}) {
  const totalPending = sessions.reduce((sum, s) => sum + s.pendingPermissions.length, 0);

  return (
    <div className="border-b border-border flex-shrink-0">
      {/* Collapsed bar */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <svg
            className={`w-3 h-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-muted-foreground font-medium">
            Background Tasks ({sessions.length})
          </span>
        </div>
        {totalPending > 0 && (
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
            hasPending ? 'bg-amber-500/15 text-amber-500 animate-pulse' : 'bg-muted text-muted-foreground'
          }`}>
            {totalPending} pending
          </span>
        )}
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 max-h-[200px] overflow-y-auto">
          {sessions.map(session => {
            const badge = STATUS_BADGE[session.status] || STATUS_BADGE.running;
            return (
              <div key={session.sessionId} className="rounded-lg border border-border p-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium truncate">
                    {session.name || session.sessionId.slice(0, 8)}
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${badge.color}`} />
                    <span className="text-muted-foreground">{badge.label}</span>
                  </span>
                </div>

                {/* Pending permissions */}
                {session.pendingPermissions.length > 0 && (
                  <div className="space-y-1 mt-1.5">
                    {session.pendingPermissions.map(perm => (
                      <div key={perm.requestId} className="flex items-start gap-2 p-1.5 rounded bg-amber-500/5 border border-amber-500/20">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-amber-600 dark:text-amber-400">
                            {perm.toolName}
                          </p>
                          <p className="text-muted-foreground truncate" title={perm.detail}>
                            {perm.detail}
                          </p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => onPermissionDecision(perm.requestId, session.sessionId, true)}
                            className="px-2 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 font-medium"
                          >
                            Allow
                          </button>
                          <button
                            onClick={() => onPermissionDecision(perm.requestId, session.sessionId, false)}
                            className="px-2 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25 font-medium"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
