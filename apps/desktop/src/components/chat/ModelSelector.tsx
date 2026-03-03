import { useState, useRef, useEffect } from 'react';
import type { ProviderCapabilities } from '@my-claudia/shared';

interface ModelSelectorProps {
  capabilities: ProviderCapabilities | null;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}

/** Sparkle / model icon */
function ModelIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
      />
    </svg>
  );
}

export function ModelSelector({ capabilities, value, onChange, disabled }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click — must be before any conditional return
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Hide entirely when no capabilities or no models
  if (!capabilities || capabilities.models.length === 0) return null;

  const options = capabilities.models;
  const currentLabel = options.find(m => m.id === value)?.label || options[0]?.label || 'Default';

  // Group models if they have group field
  const hasGroups = options.some(m => m.group);

  // Build grouped options for rendering
  const renderOptions = () => {
    if (!hasGroups) {
      return options.map((option) => (
        <button
          key={option.id}
          onClick={() => {
            onChange(option.id);
            setIsOpen(false);
          }}
          className={`
            w-full text-left px-3 py-1.5 text-[13px] transition-colors
            ${value === option.id
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-foreground hover:bg-muted active:bg-muted'
            }
          `}
        >
          {option.label}
        </button>
      ));
    }

    // Group by group field
    const groups = new Map<string, typeof options>();
    for (const opt of options) {
      const g = opt.group || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(opt);
    }

    const elements: JSX.Element[] = [];
    let idx = 0;
    for (const [groupName, groupOptions] of groups) {
      if (groupName) {
        if (idx > 0) {
          elements.push(
            <div key={`sep-${idx}`} className="my-1 border-t border-border" />
          );
        }
        elements.push(
          <div key={`group-${idx}`} className="px-3 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider select-none">
            {groupName}
          </div>
        );
      }
      for (const option of groupOptions) {
        elements.push(
          <button
            key={option.id}
            onClick={() => {
              onChange(option.id);
              setIsOpen(false);
            }}
            className={`
              w-full text-left px-3 py-1.5 text-[13px] transition-colors
              ${groupName ? 'pl-4' : ''}
              ${value === option.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:bg-muted active:bg-muted'
              }
            `}
          >
            {option.label}
          </button>
        );
      }
      idx++;
    }
    return elements;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium
          transition-colors h-7
          ${disabled
            ? 'opacity-50 cursor-not-allowed text-muted-foreground'
            : 'hover:bg-muted active:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground'
          }
        `}
        title={currentLabel}
      >
        <ModelIcon />
        <span className="hidden sm:inline truncate max-w-[80px] lg:max-w-[120px] xl:max-w-none">{currentLabel}</span>
        <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[140px] max-h-[300px] overflow-y-auto">
          {renderOptions()}
        </div>
      )}
    </div>
  );
}
