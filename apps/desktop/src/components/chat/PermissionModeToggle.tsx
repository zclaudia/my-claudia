import { useState, useRef, useEffect } from 'react';
import type { PermissionMode } from '@my-claudia/shared';
import { ICONS } from '../../config/icons';

interface PermissionModeToggleProps {
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

const MODE_OPTIONS: { value: PermissionMode; label: string; description: string; icon: string }[] = [
  {
    value: 'default',
    label: 'Default',
    description: 'Standard mode - requires confirmation for tool calls',
    icon: ICONS.permissionModes.default,
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Planning mode - Claude creates a plan before executing',
    icon: ICONS.permissionModes.plan,
  },
  {
    value: 'acceptEdits',
    label: 'Auto-Edit',
    description: 'Auto-approve file edits only',
    icon: ICONS.permissionModes.acceptEdits,
  },
  {
    value: 'bypassPermissions',
    label: 'Bypass',
    description: 'Skip all permission checks (use with caution)',
    icon: ICONS.permissionModes.bypassPermissions,
  },
];

function getModeButtonStyle(mode: PermissionMode): string {
  switch (mode) {
    case 'plan':
      return 'border-primary/50 text-primary';
    case 'bypassPermissions':
      return 'border-destructive/50 text-destructive';
    case 'acceptEdits':
      return 'border-warning/50 text-warning';
    default:
      return 'border-border text-foreground';
  }
}

function getModeItemStyle(value: PermissionMode, isSelected: boolean): string {
  if (!isSelected) return 'text-foreground hover:bg-muted active:bg-muted';
  switch (value) {
    case 'plan':
      return 'bg-primary/10 text-primary font-medium';
    case 'bypassPermissions':
      return 'bg-destructive/10 text-destructive font-medium';
    case 'acceptEdits':
      return 'bg-warning/10 text-warning font-medium';
    default:
      return 'bg-muted text-foreground font-medium';
  }
}

export function PermissionModeToggle({ mode, onModeChange, disabled }: PermissionModeToggleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = MODE_OPTIONS.find(m => m.value === mode) || MODE_OPTIONS[0];

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
        title={current.description}
        className={`
          flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium
          border transition-colors min-h-[36px]
          ${disabled
            ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
            : `hover:border-primary/50 active:bg-muted cursor-pointer ${getModeButtonStyle(mode)}`
          }
        `}
      >
        <span>{current.icon}</span>
        <span>Mode: {current.label}</span>
        <span className="text-[10px] text-muted-foreground">&#9662;</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onModeChange(option.value);
                setIsOpen(false);
              }}
              title={option.description}
              className={`
                w-full text-left px-3 py-2.5 text-sm transition-colors min-h-[44px]
                flex items-center gap-2
                ${getModeItemStyle(option.value, mode === option.value)}
              `}
            >
              <span>{option.icon}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
