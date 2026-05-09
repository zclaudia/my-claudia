import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Bot,
  SquareStack,
  Circle,
  Eye,
  EyeOff,
  File,
  FileEdit,
  Focus,
  LayoutPanelTop,
  MessageCircle,
  MessageSquare,
  Puzzle,
  RefreshCw,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface WindowInfo {
  label: string;
  title: string;
  visible: boolean;
  focused: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  pid: number;
}

interface WindowMeta {
  type: string;
  Icon: LucideIcon;
}

function classifyWindow(label: string): WindowMeta {
  if (label === 'main')                       return { type: 'Main Window',     Icon: SquareStack };
  if (label === 'claudia-ball')               return { type: 'Floating Ball',   Icon: Circle };
  if (label === 'claudia-chat')               return { type: 'Claudia Chat',    Icon: MessageCircle };
  if (label === 'notch')                      return { type: 'Notch Panel',     Icon: LayoutPanelTop };
  if (label.startsWith('session-chat-'))      return { type: 'Session Chat',    Icon: MessageSquare };
  if (label.startsWith('terminal-'))          return { type: 'Terminal',        Icon: Terminal };
  if (label.startsWith('draft-'))             return { type: 'Draft Editor',    Icon: FileEdit };
  if (label.startsWith('file-viewer-'))       return { type: 'File Viewer',     Icon: File };
  if (label.startsWith('workflow-editor-'))   return { type: 'Workflow Editor', Icon: Workflow };
  if (label.startsWith('automation-'))        return { type: 'Automation',      Icon: Bot };
  if (label.startsWith('plugin-'))            return { type: 'Plugin',          Icon: Puzzle };
  return { type: label, Icon: SquareStack };
}

// System windows that should never be force-closed
const PROTECTED_LABELS = new Set(['main', 'window-manager', 'claudia-ball', 'claudia-chat', 'notch']);

export function WindowManagerWindow() {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<WindowInfo[]>('list_windows');
      setWindows(list.filter(w => w.label !== 'window-manager'));
    } catch (e) {
      console.error('[WindowManager] list_windows failed:', e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const handleFocus = (label: string) => invoke('focus_window', { label });
  const handleClose = (label: string) => invoke('close_window', { label });

  const handleCloseAll = () => {
    windows
      .filter(w => !PROTECTED_LABELS.has(w.label))
      .forEach(w => void handleClose(w.label));
  };

  const pid = windows[0]?.pid;
  const closeableCount = windows.filter(w => !PROTECTED_LABELS.has(w.label)).length;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground select-none">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <SquareStack size={16} className="text-muted-foreground" />
          <span className="font-semibold text-sm">Windows</span>
          <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
            {windows.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {pid !== undefined && (
            <span className="text-xs text-muted-foreground font-mono">PID {pid}</span>
          )}
          <button
            onClick={() => void handleRefresh()}
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
          {closeableCount > 0 && (
            <button
              onClick={handleCloseAll}
              className="text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              title="Close all popup windows (session, terminal, file viewer, etc.)"
            >
              Close Popups
            </button>
          )}
        </div>
      </div>

      {/* Window list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {windows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No windows found
          </div>
        ) : (
          windows.map(win => {
            const { type, Icon } = classifyWindow(win.label);
            const isProtected = PROTECTED_LABELS.has(win.label);
            return (
              <div
                key={win.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  win.focused ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary/60'
                }`}
              >
                {/* Icon + info */}
                <div className={`flex-shrink-0 ${win.focused ? 'text-primary' : 'text-muted-foreground'}`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{type}</span>
                    {win.focused && (
                      <span className="text-[10px] px-1 py-0 rounded-md bg-primary/20 text-primary font-medium flex-shrink-0">
                        focused
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">{win.label}</div>
                  {win.title && win.title !== type && (
                    <div className="text-[11px] text-muted-foreground truncate">{win.title}</div>
                  )}
                </div>

                {/* Size */}
                <div className="text-[11px] text-muted-foreground font-mono flex-shrink-0 text-right hidden sm:block">
                  <div>{win.width}×{win.height}</div>
                  <div>{win.x},{win.y}</div>
                </div>

                {/* Visible badge */}
                <div className="flex-shrink-0">
                  {win.visible ? (
                    <Eye size={13} className="text-muted-foreground" />
                  ) : (
                    <EyeOff size={13} className="text-muted-foreground/40" />
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => void handleFocus(win.label)}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Focus window"
                  >
                    <Focus size={13} />
                  </button>
                  <button
                    onClick={() => void handleClose(win.label)}
                    disabled={isProtected}
                    className={`p-1.5 rounded-md transition-colors ${
                      isProtected
                        ? 'text-muted-foreground/20 cursor-not-allowed'
                        : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                    }`}
                    title={isProtected ? 'Cannot close main window' : 'Close window'}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
