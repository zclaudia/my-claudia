import { useState } from 'react';
import { Cpu, Package, Shield, Key, Folder, Wrench, Monitor, Users, ChevronDown, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SystemInfo } from '@my-claudia/shared';

interface SystemInfoPanelProps {
  systemInfo: SystemInfo;
}

export function SystemInfoPanel({ systemInfo }: SystemInfoPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const hasAnyInfo =
    systemInfo.model ||
    systemInfo.claudeCodeVersion ||
    systemInfo.cwd ||
    systemInfo.permissionMode ||
    systemInfo.apiKeySource ||
    (systemInfo.tools && systemInfo.tools.length > 0) ||
    (systemInfo.mcpServers && systemInfo.mcpServers.length > 0) ||
    (systemInfo.slashCommands && systemInfo.slashCommands.length > 0) ||
    (systemInfo.agents && systemInfo.agents.length > 0);

  if (!hasAnyInfo) return null;

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg mx-4 mb-4 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-primary/10 transition-colors"
      >
        <span className="text-primary text-sm">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="text-sm font-medium text-primary">
          System Info
        </span>
        {systemInfo.model && (
          <span className="text-xs text-primary/70 ml-auto">
            {systemInfo.model}
          </span>
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-3 space-y-2">
          {/* Primary info row */}
          <div className="flex flex-wrap gap-3 text-xs">
            {systemInfo.model && (
              <InfoBadge icon={Cpu} label="Model" value={systemInfo.model} />
            )}
            {systemInfo.claudeCodeVersion && (
              <InfoBadge icon={Package} label="Version" value={systemInfo.claudeCodeVersion} />
            )}
            {systemInfo.permissionMode && (
              <InfoBadge icon={Shield} label="Permission" value={systemInfo.permissionMode} />
            )}
            {systemInfo.apiKeySource && (
              <InfoBadge icon={Key} label="API Key" value={systemInfo.apiKeySource} />
            )}
          </div>

          {/* Working directory */}
          {systemInfo.cwd && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Folder size={12} strokeWidth={1.75} />
              <span className="font-mono truncate" title={systemInfo.cwd}>
                {systemInfo.cwd}
              </span>
            </div>
          )}

          {/* Tools */}
          {systemInfo.tools && systemInfo.tools.length > 0 && (
            <CollapsibleList
              icon={Wrench}
              label="Tools"
              items={systemInfo.tools}
              maxVisible={5}
            />
          )}

          {/* MCP Servers */}
          {systemInfo.mcpServers && systemInfo.mcpServers.length > 0 && (
            <CollapsibleList
              icon={Monitor}
              label="MCP Servers"
              items={systemInfo.mcpServers}
              maxVisible={3}
            />
          )}

          {/* Agents */}
          {systemInfo.agents && systemInfo.agents.length > 0 && (
            <CollapsibleList
              icon={Users}
              label="Agents"
              items={systemInfo.agents}
              maxVisible={3}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface InfoBadgeProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

function InfoBadge({ icon: IconComponent, label, value }: InfoBadgeProps) {
  return (
    <div className="flex items-center gap-1.5 bg-card/60 px-2 py-1 rounded-md">
      <IconComponent size={12} strokeWidth={1.75} className="text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

interface CollapsibleListProps {
  icon: LucideIcon;
  label: string;
  items: (string | { name: string; status?: string })[];
  maxVisible: number;
}

function CollapsibleList({ icon: IconComponent, label, items, maxVisible }: CollapsibleListProps) {
  const [showAll, setShowAll] = useState(false);
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
            className="bg-muted text-foreground px-1.5 py-0.5 rounded text-[10px] font-mono"
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
