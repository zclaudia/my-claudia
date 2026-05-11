import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Terminal as TerminalIcon } from 'lucide-react';
import { useSelectionStore } from '../../stores/selectionStore';
import { useChangesPanelStore } from '../../stores/changesPanelStore';
import { SinceSelector } from './SinceSelector';
import { ChangeListItem } from './ChangeListItem';
import { useChangesData, useUserMessageOptions } from './useSessionChanges';

interface ChangesPanelProps {
  projectRoot?: string;
}

export function ChangesPanel({ projectRoot }: ChangesPanelProps) {
  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);

  // Per-session "since" cursor is persisted in changesPanelStore so the user's
  // pick survives panel close/reopen, session switches, and app restarts.
  // Missing key (never picked) → fall back to the latest user message ("this turn").
  const pickedSinceBySession = useChangesPanelStore((s) => s.pickedSinceBySession);
  const setPickedSince = useChangesPanelStore((s) => s.setPickedSince);

  const pickedSince = selectedSessionId && selectedSessionId in pickedSinceBySession
    ? pickedSinceBySession[selectedSessionId]
    : undefined;

  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [bashCollapsed, setBashCollapsed] = useState(true);
  // Lifted from SinceSelector so we can gate option computation behind the
  // dropdown being open — JSON-parsing all user messages is O(N) per render.
  const [sinceOpen, setSinceOpen] = useState(false);

  const { result, latestUserMessageId } = useChangesData(
    selectedSessionId,
    pickedSince !== undefined ? pickedSince : null,
    projectRoot,
  );
  const effectiveSinceId = pickedSince !== undefined ? pickedSince : latestUserMessageId;
  const { modified, affected } = result;

  const userMessageOptions = useUserMessageOptions(selectedSessionId, sinceOpen);

  const allExpanded = useMemo(
    () => modified.length > 0 && modified.every((m) => expandedById[m.absolutePath]),
    [modified, expandedById],
  );

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedById({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const m of modified) next[m.absolutePath] = true;
    setExpandedById(next);
  };

  const handleSelectSince = (id: string | null) => {
    if (!selectedSessionId) return;
    setPickedSince(selectedSessionId, id);
  };

  if (!selectedSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
        Select a session to view changes
      </div>
    );
  }

  const sinceLabel = effectiveSinceId
    ? userMessageOptions.find((o) => o.id === effectiveSinceId)?.preview ?? ''
    : 'session start';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border flex-shrink-0">
        <SinceSelector
          options={userMessageOptions}
          selectedId={effectiveSinceId}
          onSelect={handleSelectSince}
          open={sinceOpen}
          onOpenChange={setSinceOpen}
        />
        <button
          type="button"
          onClick={toggleAll}
          disabled={modified.length === 0}
          className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          title={allExpanded ? 'Collapse all' : 'Expand all'}
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {modified.length === 0 && affected.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs text-center px-4">
            {effectiveSinceId
              ? `No file changes since "${sinceLabel}"`
              : 'No file changes in this session'}
          </div>
        ) : (
          <>
            {modified.length > 0 && (
              <section className="space-y-1.5">
                <div className="px-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Modified files ({modified.length})
                </div>
                <div className="space-y-1.5">
                  {modified.map((entry) => (
                    <ChangeListItem
                      key={entry.absolutePath}
                      entry={entry}
                      projectRoot={projectRoot}
                      expanded={!!expandedById[entry.absolutePath]}
                      onToggle={() =>
                        setExpandedById((prev) => ({
                          ...prev,
                          [entry.absolutePath]: !prev[entry.absolutePath],
                        }))
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {affected.length > 0 && (
              <section className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setBashCollapsed((v) => !v)}
                  className="w-full flex items-center gap-1 px-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground"
                >
                  {bashCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  Possibly affected (Bash) ({affected.length})
                </button>
                {!bashCollapsed && (
                  <div className="space-y-1">
                    {affected.map((a, idx) => (
                      <div
                        key={`${a.toolCallId}-${idx}`}
                        className="border border-border rounded-md px-2 py-1.5 bg-card flex items-start gap-1.5"
                      >
                        <TerminalIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          {a.path && (
                            <div className="text-xs font-mono truncate" title={a.path}>
                              {a.path}
                            </div>
                          )}
                          <div className="text-[10px] font-mono text-muted-foreground truncate" title={a.command}>
                            $ {a.command.length > 80 ? `${a.command.slice(0, 79)}…` : a.command}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
