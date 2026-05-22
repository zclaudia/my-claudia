import { useMemo } from 'react';
import { ChevronRight, ChevronDown, ExternalLink, FileText } from 'lucide-react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { timeAgo } from '../../utils/timeAgo';
import { FragmentDiffBlock } from './FragmentDiffBlock';
import { activatePanel } from '../../utils/openPanel';
import type { ModifiedEntry } from './useSessionChanges';

interface ChangeListItemProps {
  entry: ModifiedEntry;
  projectRoot: string | undefined;
  expanded: boolean;
  onToggle: () => void;
}

export function ChangeListItem({ entry, projectRoot, expanded, onToggle }: ChangeListItemProps) {
  const openFile = useFileViewerStore((s) => s.openFile);

  const toolChips = useMemo(
    () =>
      Object.entries(entry.toolCounts)
        .filter(([, n]) => n > 0)
        .map(([tool, n]) => `${tool}${n > 1 ? ` ×${n}` : ''}`),
    [entry.toolCounts],
  );

  const handleOpenInViewer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectRoot) return;
    openFile(projectRoot, entry.path);
    activatePanel('file-viewer');
  };

  return (
    <div className="border border-border rounded-md overflow-hidden bg-card">
      <div className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-secondary/50 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          title={entry.absolutePath}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-mono truncate flex-1 min-w-0">
            {entry.path}
          </span>
        </button>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1 flex-shrink-0">
          {toolChips.map((chip) => (
            <span key={chip} className="px-1.5 py-0.5 rounded bg-secondary/70">
              {chip}
            </span>
          ))}
        </div>
        {projectRoot && (
          <button
            type="button"
            onClick={handleOpenInViewer}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Open in File Viewer"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-2 py-2 space-y-3 border-t border-border bg-background/40">
          {entry.groups.map((group, groupIdx) => {
            const showSeparator = entry.groups.length > 1;
            return (
              <div key={`${group.sinceUserMessageId}-${groupIdx}`} className="space-y-2">
                {showSeparator && (
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <div className="flex-1 h-px bg-border" />
                    <span className="truncate max-w-[260px]">
                      since "{group.sinceUserMessagePreview}" · {timeAgo(group.sinceUserMessageTimestamp)}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <div className="space-y-2">
                  {group.fragments.map((fragment, fragIdx) => (
                    <FragmentDiffBlock
                      key={`${fragment.toolCallId}-${fragIdx}`}
                      fragment={fragment}
                      index={fragIdx + 1}
                      filePath={entry.path}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
