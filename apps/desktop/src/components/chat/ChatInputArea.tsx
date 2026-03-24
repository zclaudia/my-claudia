import { useState, useRef, useEffect, useCallback } from 'react';
import { Lock, Unlock, X, FileText, FileEdit, Terminal as TerminalIcon, ChevronDown, ChevronUp, Plus, Activity } from 'lucide-react';
import { ModeSelector } from './ModeSelector';
import { SystemInfoButton } from './SystemInfoButton';
import { ModelSelector } from './ModelSelector';
import { PermissionSelector } from './PermissionSelector';
import { WorktreeSelector } from './WorktreeSelector';
import { TokenUsageDisplay } from './TokenUsageDisplay';
import { MessageInput, type Attachment } from './MessageInput';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useProjectStore } from '../../stores/projectStore';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useUIStore } from '../../stores/uiStore';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import * as api from '../../services/api';
import type { AgentPermissionPolicy, ProviderCapabilities, SlashCommand, Session, Project, SystemInfo } from '@my-claudia/shared';

interface ChatInputAreaProps {
  sessionId: string;
  currentSession: Session;
  currentProject: Project | null | undefined;
  isMobile: boolean;
  isLoading: boolean;
  isConnected: boolean;
  isForcedPlanSession: boolean;
  mode: string | null;
  modelOverride: string | null;
  permissionOverride: Partial<AgentPermissionPolicy> | null;
  capabilities: ProviderCapabilities | null;
  commands: SlashCommand[];
  fileReferenceRoot: string | undefined;
  sessionRunId: string | null;
  currentUsage: {
    inputTokens: number;
    outputTokens: number;
    latestInputTokens?: number;
    latestOutputTokens?: number;
    contextWindow?: number;
  };
  currentSystemInfo: SystemInfo | null;
  advancedInput: boolean;
  restoreMessage: { content: string; attachments?: Attachment[] } | null;
  initialDraft: string | undefined;
  queuedMessage: { content: string; attachments?: Attachment[] } | null;
  draftExists: boolean;
  onSetMode: (sessionId: string, modeId: string) => void;
  onSetModelOverride: (sessionId: string, model: string) => void;
  onSetPermissionOverride: (sessionId: string, policy: Partial<AgentPermissionPolicy> | null) => void;
  onWorktreeChange: (path: string) => Promise<void>;
  onSendMessage: (content: string, attachments?: Attachment[]) => void;
  onCancelRun: () => void;
  onCommand: (command: string, args: string) => Promise<void>;
}

export function ChatInputArea({
  sessionId,
  currentSession,
  currentProject,
  isMobile,
  isLoading,
  isConnected,
  isForcedPlanSession,
  mode,
  modelOverride,
  permissionOverride,
  capabilities,
  commands,
  fileReferenceRoot,
  sessionRunId,
  currentUsage,
  currentSystemInfo,
  advancedInput,
  restoreMessage,
  initialDraft,
  queuedMessage,
  draftExists,
  onSetMode,
  onSetModelOverride,
  onSetPermissionOverride,
  onWorktreeChange,
  onSendMessage,
  onCancelRun,
  onCommand,
}: ChatInputAreaProps) {
  const { setDrawerOpen, drawerOpen } = useTerminalStore();
  const { activeTab: bottomPanelTab, setActiveTab: setBottomPanelTab } = useBottomPanelStore();
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const { isOpen: fileViewerOpen } = useFileViewerStore();
  const { setAdvancedInput } = useUIStore();
  const openDraftEditor = useDraftEditorStore((s) => s.openEditor);
  const setSendCallback = useDraftEditorStore((s) => s.setSendCallback);
  const unreadNotificationCount = useNotificationFeedStore((s) => s.unreadCount);


  // Mobile toolbar popover state
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const mobileToolsRef = useRef<HTMLDivElement>(null);

  // Close popover on outside tap
  useEffect(() => {
    if (!mobileToolsOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (mobileToolsRef.current && !mobileToolsRef.current.contains(e.target as Node)) {
        setMobileToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [mobileToolsOpen]);

  const closeMobileTools = useCallback(() => setMobileToolsOpen(false), []);
  const toggleNotificationsPanel = useCallback(() => {
    const pluginStore = usePluginStore.getState();
    const isActive = bottomPanelTab === 'notifications';
    const panel = pluginStore.panels.find((item) => item.id === 'notifications');
    const isVisible = !!panel?.visible;

    if (isVisible && isActive) {
      pluginStore.updatePanelVisibility('notifications', false);
      return;
    }

    pluginStore.updatePanelVisibility('notifications', true);
    setBottomPanelTab('notifications');
  }, [bottomPanelTab, setBottomPanelTab]);

  // Read-only mode
  if (currentSession.isReadOnly) {
    return (
      <div className="border-t border-border p-3 md:p-4 safe-bottom-pad flex-shrink-0">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-secondary/50 border border-border rounded-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock size={14} />
            <span>
              {currentSession.type === 'background'
                ? 'Background session — read-only'
                : currentSession.planStatus === 'planned'
                ? 'Plan submitted — waiting for Supervisor to execute'
                : currentSession.planStatus === 'executing'
                ? 'Task executing — controlled by Supervisor'
                : 'This session is read-only'}
            </span>
          </div>
          {currentSession.type === 'background' ? (
            isLoading && sessionRunId ? (
              <button
                onClick={onCancelRun}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-md transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
            ) : null
          ) : (
            <button
              onClick={async () => {
                try {
                  const updated = await api.unlockSession(sessionId);
                  useProjectStore.getState().updateSession(sessionId, {
                    isReadOnly: updated.isReadOnly,
                    planStatus: updated.planStatus,
                  });
                } catch (err) {
                  console.error('Failed to unlock session:', err);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors"
            >
              <Unlock size={14} />
              Unlock
            </button>
          )}
        </div>
      </div>
    );
  }

  // Normal input mode
  return (
    <div className="border-t border-border p-2 pb-3 md:p-4 safe-bottom-pad overflow-visible flex-shrink-0">
      {/* Toolbar */}
      <div className="mb-1.5 md:mb-2 flex items-center gap-1 md:gap-2">
        <ModeSelector
          capabilities={capabilities}
          value={isForcedPlanSession ? 'plan' : mode || ''}
          onChange={(modeId: string) => {
            if (isForcedPlanSession) return;
            onSetMode(sessionId, modeId);
          }}
          disabled={isLoading}
          locked={isForcedPlanSession}
          lockReason={isForcedPlanSession ? 'Locked by Supervisor planning mode' : undefined}
        />
        <ModelSelector
          capabilities={capabilities}
          value={modelOverride || ''}
          onChange={(model: string) => onSetModelOverride(sessionId, model)}
          disabled={isLoading}
        />
        <PermissionSelector
          value={permissionOverride}
          onChange={(policy) => onSetPermissionOverride(sessionId, policy)}
          projectPolicy={(currentProject?.agentPermissionOverride as AgentPermissionPolicy) ?? null}
          disabled={isLoading}
        />
        {currentProject?.id && currentProject?.rootPath && (
          <WorktreeSelector
            projectId={currentProject.id}
            projectRootPath={currentProject.rootPath}
            currentWorktree={currentSession?.workingDirectory || ''}
            onChange={onWorktreeChange}
            disabled={isLoading}
            locked={isForcedPlanSession}
            lockReason={isForcedPlanSession ? 'Locked by Supervisor planning mode' : undefined}
          />
        )}
        {/* Hidden on mobile - can tap to view details */}
        <div className="hidden md:block">
          <TokenUsageDisplay
            latestInputTokens={currentUsage.latestInputTokens}
            latestOutputTokens={currentUsage.latestOutputTokens}
            inputTokens={currentUsage.inputTokens}
            outputTokens={currentUsage.outputTokens}
            contextWindow={currentUsage.contextWindow}
          />
        </div>
        <div className="flex-1 min-w-[8px]" />
        {/* Desktop: Draft button */}
        {!isMobile && !disabledBuiltinPanels.includes('draft') && (() => {
          const isActive = bottomPanelTab === 'draft';
          return (
            <button
              onClick={() => {
                if (isActive) {
                  useDraftEditorStore.getState().closeEditor();
                } else {
                  setSendCallback((content: string) => onSendMessage(content));
                  openDraftEditor(sessionId);
                }
              }}
              className={`p-1.5 rounded hover:bg-secondary relative ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              title={isActive ? 'Close draft editor' : 'Open draft editor'}
            >
              <FileEdit size={16} strokeWidth={1.75} />
              {draftExists && !isActive && (
                <span className="absolute top-0 right-0 w-2 h-2 bg-primary rounded-full" />
              )}
            </button>
          );
        })()}
        {/* Desktop: File viewer button */}
        {!isMobile && currentProject?.rootPath && !disabledBuiltinPanels.includes('file-viewer') && (
          <button
            onClick={() => {
              if (fileViewerOpen && bottomPanelTab === 'file-viewer') {
                useFileViewerStore.getState().close();
              } else if (fileViewerOpen) {
                setBottomPanelTab('file-viewer');
              } else {
                const store = useFileViewerStore.getState();
                store.togglePanel();
                store.setSearchOpen(true);
                setBottomPanelTab('file-viewer');
              }
            }}
            className={`p-1.5 rounded hover:bg-secondary ${fileViewerOpen && bottomPanelTab === 'file-viewer' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            title={fileViewerOpen && bottomPanelTab === 'file-viewer' ? 'Close file viewer' : 'Open file viewer (Cmd+P)'}
          >
            <FileText size={16} strokeWidth={1.75} />
          </button>
        )}
        {/* Desktop: Terminal button */}
        {!isMobile && !disabledBuiltinPanels.includes('terminal') && useServerStore.getState().activeServerSupports('remoteTerminal') && currentSession?.projectId && (() => {
          const pid = currentSession.projectId;
          const isOpen = !!drawerOpen[pid];
          return (
            <button
              onClick={() => {
                if (isOpen && bottomPanelTab === 'terminal') {
                  setDrawerOpen(pid, false);
                } else if (isOpen) {
                  setBottomPanelTab('terminal');
                } else {
                  const store = useTerminalStore.getState();
                  if (!store.terminals[pid]) {
                    store.openTerminal(pid);
                  }
                  setDrawerOpen(pid, true);
                  setBottomPanelTab('terminal');
                }
              }}
              className={`p-1.5 rounded hover:bg-secondary ${isOpen && bottomPanelTab === 'terminal' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              title={isOpen && bottomPanelTab === 'terminal' ? 'Hide terminal (Ctrl+`)' : 'Open terminal (Ctrl+`)'}
            >
              <TerminalIcon size={16} strokeWidth={1.75} />
            </button>
          );
        })()}
        {!isMobile && (
          <button
            onClick={() => setAdvancedInput(!advancedInput)}
            className={`p-1.5 rounded hover:bg-secondary ${advancedInput ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            title={advancedInput ? 'Normal input' : 'Advanced input (Enter to newline)'}
          >
            {advancedInput ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronUp size={16} strokeWidth={2} />}
          </button>
        )}
        <SystemInfoButton
          systemInfo={currentSystemInfo}
          sessionInfo={currentSession ? {
            id: currentSession.id,
            name: currentSession.name || undefined,
            projectName: currentProject?.name || undefined,
          } : null}
        />
      </div>
      <MessageInput
        key={sessionId}
        sessionId={sessionId}
        onSend={onSendMessage}
        onCancel={onCancelRun}
        onCommand={onCommand}
        commands={commands}
        projectRoot={fileReferenceRoot}
        disabled={!isConnected}
        isLoading={isLoading}
        initialValue={restoreMessage?.content ?? initialDraft}
        initialAttachments={restoreMessage?.attachments}
        advancedMode={advancedInput}
        mobileToolbarSlot={isMobile ? (() => {
          const toolItems: Array<{ key: string; icon: React.ReactNode; label: string; isActive: boolean; hasBadge?: boolean; onClick: () => void }> = [];

          if (!disabledBuiltinPanels.includes('draft')) {
            const isActive = bottomPanelTab === 'draft';
            toolItems.push({
              key: 'draft',
              icon: <FileEdit size={18} strokeWidth={1.75} />,
              label: isActive ? 'Close Draft' : 'Draft Editor',
              isActive,
              hasBadge: draftExists && !isActive,
              onClick: () => {
                if (isActive) {
                  useDraftEditorStore.getState().closeEditor();
                } else {
                  setSendCallback((content: string) => onSendMessage(content));
                  openDraftEditor(sessionId);
                }
                closeMobileTools();
              },
            });
          }

          if (currentProject?.rootPath && !disabledBuiltinPanels.includes('file-viewer')) {
            const isActive = fileViewerOpen && bottomPanelTab === 'file-viewer';
            toolItems.push({
              key: 'file-viewer',
              icon: <FileText size={18} strokeWidth={1.75} />,
              label: isActive ? 'Close Files' : 'File Viewer',
              isActive,
              onClick: () => {
                if (fileViewerOpen && bottomPanelTab === 'file-viewer') {
                  useFileViewerStore.getState().close();
                } else if (fileViewerOpen) {
                  setBottomPanelTab('file-viewer');
                } else {
                  const store = useFileViewerStore.getState();
                  store.togglePanel();
                  store.setSearchOpen(true);
                  setBottomPanelTab('file-viewer');
                }
                closeMobileTools();
              },
            });
          }

          if (!disabledBuiltinPanels.includes('terminal') && useServerStore.getState().activeServerSupports('remoteTerminal') && currentSession?.projectId) {
            const pid = currentSession.projectId;
            const isOpen = !!drawerOpen[pid];
            const isActive = isOpen && bottomPanelTab === 'terminal';
            toolItems.push({
              key: 'terminal',
              icon: <TerminalIcon size={18} strokeWidth={1.75} />,
              label: isActive ? 'Hide Terminal' : 'Terminal',
              isActive,
              onClick: () => {
                if (isOpen && bottomPanelTab === 'terminal') {
                  setDrawerOpen(pid, false);
                } else if (isOpen) {
                  setBottomPanelTab('terminal');
                } else {
                  const store = useTerminalStore.getState();
                  if (!store.terminals[pid]) {
                    store.openTerminal(pid);
                  }
                  setDrawerOpen(pid, true);
                  setBottomPanelTab('terminal');
                }
                closeMobileTools();
              },
            });
          }

          if (!disabledBuiltinPanels.includes('notifications')) {
            const isActive = bottomPanelTab === 'notifications';
            toolItems.push({
              key: 'notifications',
              icon: <Activity size={18} strokeWidth={1.75} />,
              label: isActive ? 'Hide Feed' : 'Notifications',
              isActive,
              hasBadge: unreadNotificationCount > 0 && !isActive,
              onClick: () => {
                toggleNotificationsPanel();
                closeMobileTools();
              },
            });
          }

          if (toolItems.length === 0) return undefined;

          const hasActiveItem = toolItems.some(t => t.isActive);
          const hasBadge = toolItems.some(t => t.hasBadge);

          return (
            <div className="relative" ref={mobileToolsRef}>
              <button
                onClick={() => setMobileToolsOpen(v => !v)}
                className={`h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors relative ${hasActiveItem ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="More tools"
              >
                <Plus size={20} strokeWidth={1.75} className={`transition-transform duration-200 ${mobileToolsOpen ? 'rotate-45' : ''}`} />
                {hasBadge && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
                )}
              </button>
              {mobileToolsOpen && (
                <div className="absolute bottom-full left-0 mb-2 py-1 bg-popover border border-border rounded-lg shadow-lg min-w-[160px] z-50">
                  {toolItems.map((item) => (
                    <button
                      key={item.key}
                      onClick={item.onClick}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${item.isActive ? 'text-primary bg-primary/5' : 'text-foreground hover:bg-muted'}`}
                    >
                      <span className="relative flex-shrink-0">
                        {item.icon}
                        {item.hasBadge && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
                        )}
                      </span>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })() : undefined}
        placeholder={
          !isConnected
            ? 'Connecting...'
            : isLoading && queuedMessage
            ? 'Message queued — waiting for response...'
            : isLoading
            ? 'Type next message to queue...'
            : mode === 'plan'
            ? 'Plan Mode: Analyze and plan (no code changes)...'
            : advancedInput
            ? 'Type a message... (Cmd+Enter to send)'
            : 'Type a message... (Enter to send)'
        }
      />
    </div>
  );
}
