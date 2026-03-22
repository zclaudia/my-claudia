import { useRef, useEffect, useCallback } from 'react';
import { MessageInput } from '../chat/MessageInput';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { fetchApi, getBaseUrl, getAuthHeaders } from '../../services/api';
import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore, isGatewayTarget } from '../../stores/gatewayStore';
import { TaskCard } from './TaskCard';
import { InlineResponse } from './InlineResponse';
import type { ClaudiaTask, InlineResponse as InlineResponseType } from '../../stores/claudiaStore';

interface UserBubble {
  kind: 'user';
  id: string;
  text: string;
  createdAt: number;
}

interface TaskEntry {
  kind: 'task';
  task: ClaudiaTask;
  createdAt: number;
}

interface InlineEntry {
  kind: 'inline';
  response: InlineResponseType;
  createdAt: number;
}

type FeedItem = UserBubble | TaskEntry | InlineEntry;

interface ClaudiaChatProps {
  isMobile?: boolean;
}

export function ClaudiaChat({ isMobile = false }: ClaudiaChatProps) {
  const { sendMessage: wsSendMessage, isConnected } = useConnection();
  const { selectedSessionId, selectedProjectId, sessions, projects } = useProjectStore();
  const tasks = useClaudiaStore((s) => s.tasks);
  const addTask = useClaudiaStore((s) => s.addTask);
  const inlineResponses = useClaudiaStore((s) => s.inlineResponses);
  const startInline = useClaudiaStore((s) => s.startInline);
  const continueTaskId = useClaudiaStore((s) => s.continueTaskId);
  const setContinueTaskId = useClaudiaStore((s) => s.setContinueTaskId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const setTasks = useClaudiaStore((s) => s.setTasks);
  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  // Resolve project: prefer session's project, fall back to selected project
  const currentProject = (currentSession ? projects.find((p) => p.id === currentSession.projectId) : null)
    ?? (selectedProjectId ? projects.find((p) => p.id === selectedProjectId) : null)
    ?? projects[0] ?? null;

  // Hydrate tasks from server on mount / project change
  const hydratedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isConnected) {
      hydratedProjectRef.current = null;
      return;
    }
    if (!isConnected || !currentProject) return;
    if (hydratedProjectRef.current === currentProject.id) return;

    fetchApi<{ tasks: ClaudiaTask[] }>(`/api/claudia/tasks?projectId=${encodeURIComponent(currentProject.id)}`)
      .then((res) => {
        if (res.success && res.data?.tasks) {
          hydratedProjectRef.current = currentProject.id;
          setTasks(res.data.tasks);
        }
      })
      .catch(() => {
        hydratedProjectRef.current = null;
      });
  }, [isConnected, currentProject?.id, setTasks]);

  // Build feed items — merge tasks + inline responses sorted by createdAt
  const feedItems: FeedItem[] = [];

  // Add tasks (oldest first for chronological display)
  for (const task of [...tasks].reverse()) {
    feedItems.push({ kind: 'user', id: `input-${task.id}`, text: task.input, createdAt: task.createdAt });
    feedItems.push({ kind: 'task', task, createdAt: task.createdAt });
  }

  // Add inline responses (that haven't been promoted — promoted ones become tasks)
  for (const response of inlineResponses) {
    if (response.status === 'promoted') continue; // TaskCard handles promoted
    feedItems.push({ kind: 'user', id: `input-${response.clientRequestId}`, text: response.input, createdAt: response.createdAt });
    feedItems.push({ kind: 'inline', response, createdAt: response.createdAt });
  }

  feedItems.sort((a, b) => a.createdAt - b.createdAt);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (feedItems.length > 0) scrollToBottom();
  }, [feedItems.length, scrollToBottom]);

  const continueTask = continueTaskId ? tasks.find((t) => t.id === continueTaskId) : null;

  const handleSend = useCallback((content: string) => {
    if (!content.trim() || !isConnected || !currentProject) return;

    const clientRequestId = crypto.randomUUID();

    if (continueTask?.sessionId) {
      // Continue by spawning a follow-up task linked to the original one.
      const title = content.replace(/\s+/g, ' ').trim().slice(0, 80);
      addTask({
        id: clientRequestId, // temporary — server will send real ID
        sessionId: null,
        input: content,
        title,
        status: 'queued',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      wsSendMessage({
        type: 'claudia_task_continue',
        clientRequestId,
        taskId: continueTask.id,
        sessionId: continueTask.sessionId,
        input: content,
      });
      setContinueTaskId(null);
    } else {
      // Start inline — may auto-promote to background task
      startInline(clientRequestId, content);

      wsSendMessage({
        type: 'claudia_message',
        clientRequestId,
        input: content,
        projectId: currentProject.id,
      });
    }

  }, [addTask, startInline, currentProject, continueTask, isConnected, setContinueTaskId, wsSendMessage]);

  const handleViewDetails = useCallback((task: ClaudiaTask) => {
    if (!task.sessionId) return;
    (async () => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const label = `claudia-task-${Date.now()}`;
        const serverUrl = getBaseUrl();
        const authToken = (getAuthHeaders() as Record<string, string>)['Authorization'] || '';
        const activeServerId = useServerStore.getState().activeServerId;
        const activeServer = useServerStore.getState().getActiveServer();
        const serverName = activeServer?.name || '';
        const gatewayState = useGatewayStore.getState();

        const urlParams = new URLSearchParams({
          sessionWindow: task.sessionId!,
          projectId: currentProject?.id || '',
          serverUrl,
          authToken,
          ...(activeServerId ? { serverId: activeServerId } : {}),
          ...(serverName ? { serverName } : {}),
        });
        if (isGatewayTarget(activeServerId) && gatewayState.gatewayUrl && gatewayState.gatewaySecret) {
          urlParams.set('gatewayUrl', gatewayState.gatewayUrl);
          urlParams.set('gatewaySecret', gatewayState.gatewaySecret);
        }

        const winUrl = `${window.location.origin}${window.location.pathname}?${urlParams}`;
        new WebviewWindow(label, {
          url: winUrl,
          title: `Claudia: ${task.title}`,
          width: 900,
          height: 700,
          center: true,
          dragDropEnabled: false,
        });
      } catch {
        // Not on desktop Tauri — ignore
      }
    })();
  }, [currentProject?.id]);

  const handleContinue = useCallback((task: ClaudiaTask) => {
    setContinueTaskId(task.id);
  }, [setContinueTaskId]);

  const handleCancel = useCallback((task: ClaudiaTask) => {
    if (!task.sessionId) return;
    wsSendMessage({
      type: 'agent_cancel',
      sessionId: task.sessionId,
    });
  }, [wsSendMessage]);

  const hasRunningTask = tasks.some((t) => t.status === 'running');
  const hasStreaming = inlineResponses.some((r) => r.status === 'streaming');

  const placeholder = continueTask
    ? `Continue: ${continueTask.title}...`
    : hasRunningTask || hasStreaming
      ? 'Working... send another request'
      : 'Ask Claudia...';

  return (
    <div className={isMobile
      ? 'w-full h-full bg-card flex flex-col overflow-hidden safe-top-pad safe-bottom-pad'
      : 'flex flex-col h-full bg-card overflow-hidden'
    }>
      {/* Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3">
        {/* Empty state */}
        {feedItems.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-xs">
              <p className="text-sm text-muted-foreground mb-1">Hi! I'm Claudia, your personal assistant.</p>
              <p className="text-xs text-muted-foreground/60">
                Send me a task and I'll work on it in the background. You can keep working while I handle things.
              </p>
            </div>
          </div>
        )}

        {(() => {
          // Find last response item index — only the latest conversation pair is expanded
          const lastResponseIdx = feedItems.reduce((acc, item, idx) =>
            item.kind !== 'user' ? idx : acc, -1);

          return feedItems.map((item, idx) => {
            // A response and its preceding user bubble are "latest" if the response is the last one
            const isLatest = idx >= lastResponseIdx - 1;
            const shouldCollapse = !isLatest && feedItems.length > 3;

            if (item.kind === 'user') {
              if (shouldCollapse) {
                return (
                  <div key={item.id} className="flex justify-end">
                    <p className="text-[11px] text-muted-foreground/60 truncate max-w-[85%]">{item.text}</p>
                  </div>
                );
              }
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2">
                    <p className="text-sm whitespace-pre-wrap">{item.text}</p>
                  </div>
                </div>
              );
            }
            if (item.kind === 'inline') {
              return <InlineResponse key={item.response.clientRequestId} response={item.response} collapsed={shouldCollapse} />;
            }
            return (
              <TaskCard
                key={item.task.id}
                task={item.task}
                collapsed={shouldCollapse}
                onViewDetails={handleViewDetails}
                onContinue={handleContinue}
                onCancel={handleCancel}
              />
            );
          });
        })()}

        <div ref={endRef} />
      </div>

      {/* Continue mode indicator */}
      {continueTask && (
        <div className="px-3 py-1.5 bg-primary/5 border-t border-border/30 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Continuing: <span className="font-medium text-foreground">{continueTask.title}</span>
          </span>
          <button
            onClick={() => setContinueTaskId(null)}
            className="text-[11px] text-muted-foreground hover:text-foreground ml-auto"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Input */}
      <div className={`border-t border-border flex-shrink-0 ${isMobile ? 'p-3 safe-bottom-pad' : 'p-2 md:p-4'}`}>
        <MessageInput
          sessionId="claudia-input"
          onSend={handleSend}
          isLoading={false}
          disabled={!isConnected || !currentProject}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
