import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { LoadingIndicator } from '../chat/LoadingIndicator';
import { useAgentStore } from '../../stores/agentStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { getClientAIConfig } from '../../services/clientAI';
import type { ToolExecutionContext } from '../../services/agentTools';
import * as agentLoop from '../../services/agentLoop';
import type { MessageWithToolCalls } from '../../stores/chatStore';

interface AgentPanelProps {
  isMobile?: boolean;
  showHeader?: boolean;
}

export function AgentPanel({ isMobile = false, showHeader = true }: AgentPanelProps) {
  const { setExpanded, isLoading } = useAgentStore();
  const { sendMessage: wsSendMessage, isConnected } = useConnection();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Client-side AI state
  const [clientMessages, setClientMessages] = useState<MessageWithToolCalls[]>([]);
  const [clientLoading, setClientLoading] = useState(false);

  const config = getClientAIConfig();
  const modelName = config?.model || 'Agent AI';

  // Tool execution context for meta-agent tools (send_task_to_session, etc.)
  const toolContext: ToolExecutionContext = useMemo(() => ({
    sendWsMessage: wsSendMessage,
    isConnected,
  }), [wsSendMessage, isConnected]);

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  }, []);

  // Load messages from IndexedDB on mount
  useEffect(() => {
    agentLoop.initAgentLoop().then((msgs) => {
      const converted: MessageWithToolCalls[] = msgs
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map((m, i) => ({
          id: `client-${i}`,
          sessionId: 'client-agent',
          role: m.role as 'user' | 'assistant',
          content: m.content || '',
          createdAt: Date.now(),
        }));
      setClientMessages(converted);
      setInitialLoadDone(true);
      setTimeout(() => scrollToBottom(true), 0);
    });
  }, [scrollToBottom]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (initialLoadDone && clientMessages.length > 0) {
      const container = messagesContainerRef.current;
      if (!container) return;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) scrollToBottom();
    }
  }, [clientMessages.length, initialLoadDone, scrollToBottom]);

  const sendClientMessage = useCallback(async (input: string) => {
    const userMsg: MessageWithToolCalls = {
      id: `client-${Date.now()}`,
      sessionId: 'client-agent',
      role: 'user',
      content: input,
      createdAt: Date.now(),
    };
    setClientMessages(prev => [...prev, userMsg]);
    setClientLoading(true);

    const assistantId = `client-${Date.now() + 1}`;
    const assistantMsg: MessageWithToolCalls = {
      id: assistantId,
      sessionId: 'client-agent',
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    setClientMessages(prev => [...prev, assistantMsg]);

    setTimeout(() => scrollToBottom(), 100);

    await agentLoop.sendMessage(input, {
      onDelta: (content) => {
        setClientMessages(prev =>
          prev.map(m => m.id === assistantId
            ? { ...m, content: m.content + content }
            : m
          )
        );
      },
      onAssistantStart: () => {},
      onToolCallStart: () => {},
      onToolCallResult: () => {},
      onComplete: () => {
        setClientLoading(false);
      },
      onError: (error) => {
        setClientMessages(prev =>
          prev.map(m => m.id === assistantId
            ? { ...m, content: m.content + `\n\n**Error:** ${error}` }
            : m
          )
        );
        setClientLoading(false);
      },
    }, toolContext);
  }, [scrollToBottom]);

  const handleSend = useCallback((content: string) => {
    if (!content.trim()) return;
    sendClientMessage(content);
  }, [sendClientMessage]);

  const handleCancel = useCallback(() => {
    agentLoop.cancelAgentLoop();
    setClientLoading(false);
  }, []);

  const loading = clientLoading || isLoading;

  return (
    <div className={isMobile
      ? (showHeader ? 'w-full h-full bg-card flex flex-col overflow-hidden safe-top-pad safe-bottom-pad' : 'flex flex-col h-full')
      : 'flex flex-col h-full bg-card overflow-hidden'
    }>
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">🤖</span>
            <span className="font-semibold text-sm">Agent</span>
            <span className="text-xs text-muted-foreground">{modelName}</span>
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
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className={`flex-1 overflow-y-auto ${showHeader ? 'p-3' : 'p-2 md:p-4'}`}
      >
        {clientMessages.length === 0 && initialLoadDone && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <div className="text-center">
              <p className="mb-1">Hi! I'm your Meta-Agent.</p>
              <p className="text-xs text-muted-foreground/70">
                I can manage your projects, sessions, search conversations, and orchestrate tasks across backends.
              </p>
            </div>
          </div>
        )}

        <MessageList messages={clientMessages} />

        <LoadingIndicator isLoading={loading} />

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={`border-t border-border flex-shrink-0 ${showHeader ? 'p-3' : 'p-2 md:p-4 safe-bottom-pad'}`}>
        <MessageInput
          sessionId="agent"
          onSend={handleSend}
          onCancel={loading ? handleCancel : undefined}
          isLoading={loading}
          placeholder={loading ? 'Working...' : 'Ask me anything...'}
        />
      </div>
    </div>
  );
}
