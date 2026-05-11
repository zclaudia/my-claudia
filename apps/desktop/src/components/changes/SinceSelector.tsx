import { useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { timeAgo } from '../../utils/timeAgo';
import type { UserMessageOption } from './useSessionChanges';

interface SinceSelectorProps {
  options: UserMessageOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Controlled: parent owns `open` so it can gate option computation behind it.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SinceSelector({ options, selectedId, onSelect, open, onOpenChange }: SinceSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, onOpenChange]);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const buttonLabel = selected
    ? `Since: "${selected.preview}" · ${timeAgo(selected.timestamp)}`
    : selectedId === null
      ? 'Entire session'
      : 'Since: this turn';

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="w-full flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-background hover:bg-secondary/50 text-xs text-left"
        title={buttonLabel}
      >
        <span className="truncate flex-1 min-w-0">{buttonLabel}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-popover border border-border rounded-md shadow-md z-20">
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              onOpenChange(false);
            }}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-secondary text-left"
          >
            <span className="w-3 h-3 flex-shrink-0">
              {selectedId === null && <Check className="w-3 h-3 text-primary" />}
            </span>
            <span className="italic text-muted-foreground">Entire session</span>
          </button>
          <div className="h-px bg-border" />
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs italic text-muted-foreground">
              No user messages yet
            </div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onSelect(opt.id);
                  onOpenChange(false);
                }}
                className="w-full flex items-start gap-1.5 px-2 py-1.5 text-xs hover:bg-secondary text-left"
                title={opt.preview}
              >
                <span className="w-3 h-3 flex-shrink-0 mt-0.5">
                  {selectedId === opt.id && <Check className="w-3 h-3 text-primary" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{opt.preview || '(empty)'}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {timeAgo(opt.timestamp)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
