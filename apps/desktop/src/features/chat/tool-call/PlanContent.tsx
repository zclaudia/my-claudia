import { useState } from 'react';
import { Play } from 'lucide-react';
import { useChatStore, type ToolCallState } from '../../../stores/chatStore';
import { useSelectionStore } from '../../../stores/selectionStore';

// Plan content with lightweight markdown rendering
const PLAN_PREVIEW_LINES = 20;

function PlanContent({ content }: { content: string }) {
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const lines = content.split('\n');
  const needsCollapse = lines.length > PLAN_PREVIEW_LINES;
  const displayLines = needsCollapse && !isFullyExpanded
    ? lines.slice(0, PLAN_PREVIEW_LINES)
    : lines;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 bg-primary/5 text-xs space-y-0.5">
        {displayLines.map((line, i) => {
          const trimmed = line.trimStart();
          // Headings
          if (trimmed.startsWith('### '))
            return <div key={i} className="font-semibold text-foreground mt-2 mb-0.5">{trimmed.slice(4)}</div>;
          if (trimmed.startsWith('## '))
            return <div key={i} className="font-bold text-foreground mt-3 mb-0.5 text-sm">{trimmed.slice(3)}</div>;
          if (trimmed.startsWith('# '))
            return <div key={i} className="font-bold text-foreground mt-3 mb-1 text-base">{trimmed.slice(2)}</div>;
          // List items
          if (trimmed.startsWith('- ') || trimmed.startsWith('* '))
            return <div key={i} className="ml-3 text-foreground">• {trimmed.slice(2)}</div>;
          if (/^\d+\.\s/.test(trimmed)) {
            const match = trimmed.match(/^(\d+\.)\s(.*)$/);
            return <div key={i} className="ml-3 text-foreground"><span className="text-muted-foreground">{match?.[1]}</span> {match?.[2]}</div>;
          }
          // Code blocks (inline indicator)
          if (trimmed.startsWith('```'))
            return <div key={i} className="text-muted-foreground font-mono">{trimmed}</div>;
          // Bold text
          if (trimmed.includes('**')) {
            const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
            return (
              <div key={i} className="text-foreground">
                {parts.map((part, j) =>
                  part.startsWith('**') && part.endsWith('**')
                    ? <strong key={j}>{part.slice(2, -2)}</strong>
                    : part
                )}
              </div>
            );
          }
          // Empty line
          if (!trimmed) return <div key={i} className="h-1" />;
          // Regular text
          return <div key={i} className="text-foreground">{line}</div>;
        })}
      </div>
      {needsCollapse && (
        <button
          onClick={() => setIsFullyExpanded(!isFullyExpanded)}
          className="w-full px-3 py-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-muted active:bg-muted/80 transition-colors text-center border-t border-border"
        >
          {isFullyExpanded ? 'Collapse' : `Show full plan (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
}

// Default follow-up text inserted into the chat input when the user clicks
// "Execute plan". Kept short and editable — the input is focused so the user
// can tweak it before sending.
const EXECUTE_PLAN_PREFILL = 'Proceed with the plan above.';

// Inline "Execute plan" action shown under a non-blocking plan proposal
// (cursor's `createPlan`). Hidden for the Claude / MCP flows because by the
// time the tool reaches `completed`, the runtime has already transitioned the
// session out of plan mode — so the mode filter naturally excludes them.
function PlanProposalActions({ status }: { status: ToolCallState['status'] }) {
  const sessionId = useSelectionStore((s) => s.selectedSessionId);
  const sessionMode = useChatStore((s) =>
    sessionId ? s.modeOverrides[sessionId] || s.runtimeModes[sessionId] || '' : '',
  );
  const setMode = useChatStore((s) => s.setMode);
  const setPendingPrefill = useChatStore((s) => s.setPendingPrefill);

  if (!sessionId) return null;
  if (status !== 'completed') return null;
  if (sessionMode !== 'plan') return null;

  const handleExecute = () => {
    setMode(sessionId, 'default');
    setPendingPrefill(sessionId, EXECUTE_PLAN_PREFILL);
  };

  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={handleExecute}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
      >
        <Play size={11} strokeWidth={2.2} />
        Execute plan
      </button>
    </div>
  );
}

export { PlanContent, PlanProposalActions, PLAN_PREVIEW_LINES, EXECUTE_PLAN_PREFILL };
