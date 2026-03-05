import { useState, useRef, useEffect } from 'react';
import { Shield, Scale, Rocket, LockOpen, Settings, Lightbulb, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgentPermissionPolicy } from '@my-claudia/shared';

interface PermissionSelectorProps {
  value: Partial<AgentPermissionPolicy> | null;
  onChange: (policy: Partial<AgentPermissionPolicy> | null) => void;
  projectPolicy: AgentPermissionPolicy | null;
  disabled?: boolean;
}

const TRUST_LEVELS: { id: string; label: string; icon: LucideIcon; description: string }[] = [
  { id: 'conservative', label: 'Conservative', icon: Shield, description: 'Read-only + sensitive file guard' },
  { id: 'moderate', label: 'Moderate', icon: Scale, description: '+ File edits + workspace guard' },
  { id: 'aggressive', label: 'Aggressive', icon: Rocket, description: '+ Safe bash + network guard' },
  { id: 'full_trust', label: 'Full Trust', icon: LockOpen, description: 'Everything except dangerous bash' },
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

  // Determine current label for trigger button
  const getTriggerLabel = () => {
    if (!value) {
      if (projectPolicy?.enabled) {
        const level = TRUST_LEVELS.find(l => l.id === projectPolicy.trustLevel);
        return level ? level.label : 'Project Default';
      }
      return 'Project Default';
    }
    const level = TRUST_LEVELS.find(l => l.id === value.trustLevel);
    return level ? level.label : 'Custom';
  };

  const triggerLabel = getTriggerLabel();
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
          flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium
          transition-colors h-7
          ${disabled
            ? 'opacity-50 cursor-not-allowed text-muted-foreground'
            : hasOverride
            ? 'hover:bg-muted active:bg-muted/80 cursor-pointer text-primary'
            : 'hover:bg-muted active:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground'
          }
        `}
        title={triggerLabel}
      >
        <Shield size={14} strokeWidth={1.75} />
        <span className="hidden md:inline truncate max-w-[80px] lg:max-w-none">{triggerLabel}</span>
        <ChevronDown size={12} className="text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl py-1 min-w-[240px] max-h-[300px] overflow-y-auto animate-apple-fade-in">
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
            <div className="flex items-center gap-1.5 text-[13px]"><Settings size={13} strokeWidth={1.75} /> Project Default</div>
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
              <div className="flex items-center gap-1.5 text-[13px]"><level.icon size={13} strokeWidth={1.75} /> {level.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {level.description}
              </div>
            </button>
          ))}

          {/* Info footer */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border mt-1">
            <span className="flex items-center gap-1"><Lightbulb size={10} strokeWidth={1.75} /> Session override is temporary and will be cleared on page refresh</span>
          </div>
        </div>
      )}
    </div>
  );
}
