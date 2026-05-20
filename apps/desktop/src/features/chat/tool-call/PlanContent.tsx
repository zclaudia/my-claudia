import { useState } from 'react';

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

export { PlanContent, PLAN_PREVIEW_LINES };
