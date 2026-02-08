import { useState, useRef, useEffect } from 'react';

interface ModelOption {
  id: string;
  label: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: '', label: 'Default' },
  { id: 'claude-opus-4-6', label: 'Opus' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku' },
];

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLabel = MODEL_OPTIONS.find(m => m.id === value)?.label || 'Default';

  // Close dropdown on outside click
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium
          border transition-colors min-h-[36px]
          ${disabled
            ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
            : 'border-border hover:border-primary/50 active:bg-muted cursor-pointer text-foreground'
          }
        `}
      >
        <span>🧠 Model: {currentLabel}</span>
        <span className="text-[10px] text-muted-foreground">&#9662;</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[120px]">
          {MODEL_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                onChange(option.id);
                setIsOpen(false);
              }}
              className={`
                w-full text-left px-3 py-2.5 text-sm transition-colors min-h-[44px]
                ${value === option.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-muted active:bg-muted'
                }
              `}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
