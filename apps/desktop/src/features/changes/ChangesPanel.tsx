import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Terminal as TerminalIcon } from 'lucide-react';
import { useSelectionStore } from '../../stores/selectionStore';
import { useChangesPanelStore } from '../../stores/changesPanelStore';
import { SinceSelector } from '../../components/changes/SinceSelector';
import { ChangeListItem } from '../../components/changes/ChangeListItem';
import { TurnSummaryCard } from '../../components/changes/TurnSummaryCard';
import { SummarySection } from './SummarySection';
import {
  isTurnEmpty,
  useChangesData,
  useUserMessageOptions,
} from '../../components/changes/useSessionChanges';

interface ChangesPanelProps {
  projectId?: string;
  projectRoot?: string;
}

export function ChangesPanel({ projectId, projectRoot }: ChangesPanelProps) {
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
  // Turn cards summarize counts only — useful at a glance but space-heavy.
  // Default collapsed; expand on demand via the section header.
  const [turnsCollapsed, setTurnsCollapsed] = useState(true);
  // Lifted from SinceSelector so we can gate option computation behind the
  // dropdown being open — JSON-parsing all user messages is O(N) per render.
  const [sinceOpen, setSinceOpen] = useState(false);

  const { result, effectiveSinceId, effectiveSinceOption } = useChangesData(
    selectedSessionId,
    pickedSince,
    projectRoot,
  );
  const { modified, affected, turns } = result;
  // Newest turn first so the user's latest context is at the top of the panel.
  // Empty turns (no Done activity, no Open issues) are hidden — they add noise
  // for slash commands / quick `git status` invocations that produced nothing.
  const { visibleTurns, hiddenCount } = useMemo(() => {
    const visible: typeof turns = [];
    let hidden = 0;
    // iterate newest-first
    for (let i = turns.length - 1; i >= 0; i--) {
      if (isTurnEmpty(turns[i])) hidden += 1;
      else visible.push(turns[i]);
    }
    return { visibleTurns: visible, hiddenCount: hidden };
  }, [turns]);

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

  const sinceLabel = effectiveSinceOption?.preview ?? 'session start';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border flex-shrink-0">
        <SinceSelector
          options={userMessageOptions}
          selectedId={effectiveSinceId}
          selectedOption={effectiveSinceOption}
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

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {/* AI-generated summary covers a single turn — only shown when the
            user has anchored "since" to a specific user message (i.e. the
            view is scoped to one or more turns rooted at that turn).
            "Entire session" picks span all turns — skip until merge UI is built. */}
        {effectiveSinceId && (() => {
          const summaryTurn = turns.find((t) => t.userMessageId === effectiveSinceId) ?? null;
          return (
            <SummarySection
              sessionId={selectedSessionId}
              projectId={projectId}
              turn={summaryTurn}
              latestMessageIdInTurn={summaryTurn?.lastMessageId ?? null}
            />
          );
        })()}
        {modified.length === 0 && affected.length === 0 && turns.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs text-center px-4">
            {effectiveSinceId
              ? `No file changes since "${sinceLabel}"`
              : 'No file changes in this session'}
          </div>
        ) : (
          <>
            {visibleTurns.length > 0 && (
              <section className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setTurnsCollapsed((v) => !v)}
                  className="w-full flex items-center gap-1 px-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground"
                >
                  {turnsCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  <span>Turns ({visibleTurns.length})</span>
                  {hiddenCount > 0 && (
                    <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                      · {hiddenCount} empty hidden
                    </span>
                  )}
                </button>
                {!turnsCollapsed && (
                  <div className="space-y-1.5">
                    {visibleTurns.map((turn) => (
                      <TurnSummaryCard key={turn.userMessageId} turn={turn} />
                    ))}
                  </div>
                )}
              </section>
            )}

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
