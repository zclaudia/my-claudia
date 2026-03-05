import { useState, useRef, useEffect } from 'react';
import { Info, FolderOpen, MessageSquare, Cpu, Package, Shield, Key, Folder, Wrench, Monitor, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SystemInfo } from '@my-claudia/shared';

interface SessionInfo {
  id: string;
  name?: string;
  projectName?: string;
}

interface SystemInfoButtonProps {
  systemInfo: SystemInfo | null;
  sessionInfo?: SessionInfo | null;
}

export function SystemInfoButton({ systemInfo, sessionInfo }: SystemInfoButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        buttonRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsExpanded(false);
      }
    }

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  const hasInfo = sessionInfo || (systemInfo && (
    systemInfo.model ||
    systemInfo.claudeCodeVersion ||
    systemInfo.cwd ||
    systemInfo.permissionMode ||
    systemInfo.apiKeySource ||
    (systemInfo.tools && systemInfo.tools.length > 0) ||
    (systemInfo.mcpServers && systemInfo.mcpServers.length > 0) ||
    (systemInfo.agents && systemInfo.agents.length > 0)
  ));

  // Don't show the button if no info available
  if (!hasInfo) {
    return null;
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all
          ${isExpanded
            ? 'bg-card text-foreground shadow-sm'
            : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
          }
        `}
        title="View system info"
      >
        <Info size={14} strokeWidth={1.75} />
        <span className="hidden sm:inline">Info</span>
      </button>

      {/* Expandable panel */}
      {isExpanded && (
        <div
          ref={panelRef}
          className="absolute bottom-full right-0 mb-2 w-80 max-w-[90vw] bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl z-50 overflow-hidden animate-apple-fade-in"
        >
          <div className="p-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium text-card-foreground">System Info</span>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
            {/* Session info */}
            {sessionInfo && (
              <div className="space-y-1">
                {sessionInfo.projectName && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FolderOpen size={12} strokeWidth={1.75} />
                    <span className="text-muted-foreground">Project:</span>
                    <span className="text-foreground">{sessionInfo.projectName}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquare size={12} strokeWidth={1.75} />
                  <span className="text-muted-foreground">Session:</span>
                  <span className="text-foreground truncate" title={sessionInfo.id}>
                    {sessionInfo.name || sessionInfo.id}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="ml-5 font-mono text-[10px] text-muted-foreground/70 select-all">{sessionInfo.id}</span>
                </div>
              </div>
            )}

            {/* Primary info */}
            <div className="flex flex-wrap gap-2">
              {systemInfo?.model && (
                <InfoBadge icon={Cpu} label="Model" value={systemInfo.model} />
              )}
              {systemInfo?.claudeCodeVersion && (
                <InfoBadge icon={Package} label="Version" value={systemInfo.claudeCodeVersion} />
              )}
              {systemInfo?.permissionMode && (
                <InfoBadge icon={Shield} label="Permission" value={systemInfo.permissionMode} />
              )}
              {systemInfo?.apiKeySource && (
                <InfoBadge icon={Key} label="API Key" value={systemInfo.apiKeySource} />
              )}
            </div>

            {/* Working directory */}
            {systemInfo?.cwd && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Folder size={12} strokeWidth={1.75} />
                <span className="font-mono truncate" title={systemInfo.cwd}>
                  {systemInfo.cwd}
                </span>
              </div>
            )}

            {/* Tools */}
            {systemInfo?.tools && systemInfo.tools.length > 0 && (
              <InfoList icon={Wrench} label="Tools" items={systemInfo.tools} />
            )}

            {/* MCP Servers */}
            {systemInfo?.mcpServers && systemInfo.mcpServers.length > 0 && (
              <InfoList icon={Monitor} label="MCP Servers" items={systemInfo.mcpServers} />
            )}

            {/* Agents */}
            {systemInfo?.agents && systemInfo.agents.length > 0 && (
              <InfoList icon={Users} label="Agents" items={systemInfo.agents} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBadge({ icon: IconComponent, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 bg-muted px-2 py-1 rounded text-xs">
      <IconComponent size={12} strokeWidth={1.75} className="text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function InfoList({ icon: IconComponent, label, items }: { icon: LucideIcon; label: string; items: (string | { name: string; status?: string })[] }) {
  const [showAll, setShowAll] = useState(false);
  const maxVisible = 5;
  const displayItems = showAll ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible;

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <IconComponent size={12} strokeWidth={1.75} />
        <span>{label}</span>
        <span className="text-muted-foreground/70">({items.length})</span>
      </div>
      <div className="flex flex-wrap gap-1 ml-5">
        {displayItems.map((item, index) => (
          <span
            key={index}
            className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded text-[10px] font-mono"
          >
            {typeof item === 'string' ? item : item.name}
          </span>
        ))}
        {hasMore && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-primary hover:underline text-[10px]"
          >
            {showAll ? 'show less' : `+${items.length - maxVisible} more`}
          </button>
        )}
      </div>
    </div>
  );
}
