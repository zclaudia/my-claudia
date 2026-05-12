import { FolderOpen, Server } from 'lucide-react';

/** Compact context bar showing backend + project info for standalone windows */
export function WindowContextBar({ serverName, projectId }: { serverName?: string; projectId?: string }) {
  if (!serverName && !projectId) return null;
  return (
    <div
      className="flex items-center gap-3 px-3 py-1 border-b border-border bg-muted/50 flex-shrink-0 text-[11px] text-muted-foreground"
      data-tauri-drag-region
    >
      {serverName && (
        <span className="flex items-center gap-1">
          <Server size={11} className="flex-shrink-0" />
          <span className="truncate">{serverName}</span>
        </span>
      )}
      {projectId && (
        <span className="flex items-center gap-1">
          <FolderOpen size={11} className="flex-shrink-0" />
          <span className="truncate">{projectId}</span>
        </span>
      )}
    </div>
  );
}
