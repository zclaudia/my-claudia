import { useState, useRef, useEffect } from 'react';
import type { AgentPermissionPolicy } from '@my-claudia/shared';

interface PermissionSelectorProps {
  value: Partial<AgentPermissionPolicy> | null;
  onChange: (policy: Partial<AgentPermissionPolicy> | null) => void;
  projectPolicy: AgentPermissionPolicy | null;
  disabled?: boolean;
}

/** Shield icon */
function ShieldIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

const TRUST_LEVELS = [
  { id: 'conservative', label: '🛡️ Conservative', description: 'Read-only + sensitive file guard' },
  { id: 'moderate', label: '⚖️ Moderate', description: '+ File edits + workspace guard' },
  { id: 'aggressive', label: '🚀 Aggressive', description: '+ Safe bash + network guard' },
  { id: 'full_trust', label: '🔓 Full Trust', description: 'Everything except dangerous bash' },
];

export function PermissionSelector({ value, onChange, projectPolicy, disabled }: PermissionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  // Determine current label
  const getCurrentLabel = () => {
    if (!value) {
      // Using project default
      return projectPolicy?.enabled
        ? TRUST_LEVELS.find(l => l.id === projectPolicy.trustLevel)?.label || 'Project Default'
        : '🛡️ Project Default';
    }
    return TRUST_LEVELS.find(l => l.id === value.trustLevel)?.label || 'Custom';
  };

  const currentLabel = getCurrentLabel();
  const hasOverride = value !== null;

  const handleSelect = (trustLevel: string | null) => {
    if (trustLevel === null) {
      // Clear override - use project default
      onChange(null);
    } else {
      // Set session override
      onChange({
        enabled: true,
        trustLevel: trustLevel as AgentPermissionPolicy['trustLevel'],
        customRules: [],
        escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
      });
    }
    setIsOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium
          border transition-colors min-h-[36px]
          ${disabled
            ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
            : 'border-border hover:border-primary/50 active:bg-muted cursor-pointer text-foreground'
          }
          ${hasOverride ? 'ring-2 ring-primary/30' : ''}
        `}
        title={currentLabel}
      >
        <ShieldIcon />
        <span className="hidden md:inline truncate max-w-[80px] lg:max-w-none">{currentLabel}</span>
        <span className="text-[10px] text-muted-foreground">&#9662;</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[240px] max-h-[300px] overflow-y-auto">
          {/* Header */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider border-b border-border">
            Session Permission Override
          </div>

          {/* Project Default option */}
          <button
            onClick={() => handleSelect(null)}
            className={`
              w-full text-left px-3 py-1.5 transition-colors
              ${!hasOverride
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:bg-muted active:bg-muted'
              }
            `}
          >
            <div className="text-[13px]">⚙️ Project Default</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {projectPolicy?.enabled
                ? `Use project setting (${projectPolicy.trustLevel})`
                : 'Ask for all permissions'}
            </div>
          </button>

          <div className="my-1 border-t border-border" />

          {/* Trust level options */}
          {TRUST_LEVELS.map((level) => (
            <button
              key={level.id}
              onClick={() => handleSelect(level.id)}
              className={`
                w-full text-left px-3 py-1.5 transition-colors
                ${value?.trustLevel === level.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-muted active:bg-muted'
                }
              `}
            >
              <div className="text-[13px]">{level.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {level.description}
              </div>
            </button>
          ))}

          {/* Info footer */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border mt-1">
            💡 Session override is temporary and will be cleared on page refresh
          </div>
        </div>
      )}
    </div>
  );
}
