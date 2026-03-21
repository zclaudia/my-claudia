import { useRef, useEffect, useCallback, useState } from 'react';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { LoadingIndicator } from '../chat/LoadingIndicator';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useChatStore } from '../../stores/chatStore';
import { useConnection } from '../../contexts/ConnectionContext';
import * as api from '../../services/api';

const QUICK_ACTIONS = [
  { icon: '\u{1F50D}', label: 'Search messages', prompt: 'Search messages across all sessions' },
  { icon: '\u{1F4CB}', label: 'List sessions', prompt: 'List all active sessions with their status' },
  { icon: '\u{1F4CA}', label: 'Summarize session', prompt: 'Summarize the current session\'s conversation' },
  { icon: '\u{1F5C2}', label: 'Browse files', prompt: 'List files in the current project' },
];

interface AgentPanelProps {
  isMobile?: boolean;
  showHeader?: boolean;
}

export function AgentPanel({ isMobile = false, showHeader = true }: AgentPanelProps) {
  const { setExpanded, clearRequestId } = useAgentStore();
  const { sendMessage: wsSendMessage, isConnected } = useConnection();
  const { selectedSessionId, sessions, projects, addSession, updateSession } = useProjectStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Agent session state
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  // Get messages and run state from chatStore (same as ChatInterface)
  const messages = useChatStore((s) => agentSessionId ? (s.messages[agentSessionId] || []) : []);
  const activeRuns = useChatStore((s) => s.activeRuns);
  const isLoading = agentSessionId ? Object.values(activeRuns).includes(agentSessionId) : false;
  const addMessage = useChatStore((s) => s.addMessage);

  // Current context for display
  const currentSession = sessions.find(s => s.id === selectedSessionId);
  const currentProject = currentSession ? projects.find(p => p.id === currentSession.projectId) : null;

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  }, []);

  // Initialize or restore agent session
  useEffect(() => {
    if (!isConnected || !currentProject || initializing || agentSessionId) return;

    setInitializing(true);

    // Look for existing agent session in this project
    const existingAgent = sessions.find(
      s => s.projectId === currentProject.id && s.type === 'agent' && !s.archivedAt
    );

    if (existingAgent) {
      setAgentSessionId(existingAgent.id);
      // Load existing messages
      api.getSessionMessages(existingAgent.id).then(response => {
        const store = useChatStore.getState();
        store.clearMessages(existingAgent.id);
        for (const msg of response.messages) {
          store.addMessage(existingAgent.id, msg);
        }
        setInitializing(false);
        setTimeout(() => scrollToBottom(true), 0);
      }).catch(() => setInitializing(false));
    } else {
      // Create a new agent session
      api.createSession({
        projectId: currentProject.id,
        name: 'Agent Assistant',
        type: 'agent',
      }).then(session => {
        setAgentSessionId(session.id);
        setInitializing(false);
      }).catch(() => setInitializing(false));
    }
  }, [isConnected, currentProject?.id, sessions]);

  // Listen for clear requests from header
  useEffect(() => {
    if (clearRequestId > 0 && agentSessionId) {
      const previousSessionId = agentSessionId;
      setInitializing(true);
      setAgentSessionId(null);

      (async () => {
        try {
          await api.archiveSessions([previousSessionId]);
          updateSession(previousSessionId, { archivedAt: Date.now() });
          useChatStore.getState().clearMessages(previousSessionId);

          if (!currentProject) return;

          const session = await api.createSession({
            projectId: currentProject.id,
            name: 'Agent Assistant',
            type: 'agent',
          });
          addSession(session);
          setAgentSessionId(session.id);
        } finally {
          setInitializing(false);
        }
      })();
    }
  }, [clearRequestId, agentSessionId, currentProject, addSession, updateSession]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      const container = messagesContainerRef.current;
      if (!container) return;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  const handleSend = useCallback((content: string) => {
    if (!content.trim() || !agentSessionId || !isConnected) return;

    const clientMessageId = crypto.randomUUID();

    // Add user message to chat store immediately (optimistic)
    addMessage(agentSessionId, {
      id: clientMessageId,
      clientMessageId,
      sessionId: agentSessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
    });

    // Send agent_start via WebSocket
    wsSendMessage({
      type: 'agent_start',
      clientRequestId: clientMessageId,
      sessionId: agentSessionId,
      input: content,
    });

    setTimeout(() => scrollToBottom(), 100);
  }, [agentSessionId, isConnected, addMessage, wsSendMessage, scrollToBottom]);

  const handleCancel = useCallback(() => {
    if (!agentSessionId) return;
    wsSendMessage({
      type: 'agent_cancel',
      sessionId: agentSessionId,
    });
  }, [agentSessionId, wsSendMessage]);

  const loading = isLoading || initializing;

  return (
    <div className={isMobile
      ? (showHeader ? 'w-full h-full bg-card flex flex-col overflow-hidden safe-top-pad safe-bottom-pad' : 'flex flex-col h-full')
      : 'flex flex-col h-full bg-card overflow-hidden'
    }>
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">{'\u{1F916}'}</span>
            <span className="font-semibold text-sm">Agent</span>
            <span className="text-xs text-muted-foreground">Server-side</span>
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
        {/* Empty state with quick actions */}
        {messages.length === 0 && !initializing && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-xs">
              <p className="text-sm text-muted-foreground mb-1">Hi! I'm your Agent Assistant.</p>
              <p className="text-xs text-muted-foreground/60 mb-5">
                Execute tasks, manage files, search conversations, and automate workflows.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action.label}
                    onClick={() => handleSend(action.prompt)}
                    className="flex items-center gap-2 border border-border rounded-lg px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all text-left"
                  >
                    <span className="text-sm flex-shrink-0">{action.icon}</span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <MessageList messages={messages} />

        <LoadingIndicator isLoading={loading} />

        <div ref={messagesEndRef} />
      </div>

      {/* Context line */}
      {currentProject && currentSession && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground/50 border-t border-border/30 truncate flex-shrink-0">
          Context: {currentProject.name} / {currentSession.name || 'Untitled'}
        </div>
      )}

      {/* Input */}
      <div className={`border-t border-border flex-shrink-0 ${showHeader ? 'p-3' : 'p-2 md:p-4 safe-bottom-pad'}`}>
        <MessageInput
          sessionId={agentSessionId || 'agent'}
          onSend={handleSend}
          onCancel={loading ? handleCancel : undefined}
          isLoading={loading}
          disabled={!isConnected || !agentSessionId}
          placeholder={initializing ? 'Initializing...' : loading ? 'Working...' : 'Ask me anything...'}
        />
      </div>
    </div>
  );
}
