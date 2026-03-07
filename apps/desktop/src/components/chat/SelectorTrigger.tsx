import type { ReactNode } from 'react';

interface SelectorTriggerProps {
  onClick: () => void;
  disabled?: boolean;
  locked?: boolean;
  lockReason?: string;
  title?: string;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

export function SelectorTrigger({
  onClick,
  disabled,
  locked,
  lockReason,
  title,
  ariaLabel,
  className = '',
  children,
}: SelectorTriggerProps) {
  const effectiveDisabled = !!(disabled || locked);
  const effectiveTitle = locked ? (lockReason || title || 'Locked') : title;
  const stateClass = (disabled && !locked)
    ? 'opacity-50 cursor-not-allowed text-muted-foreground'
    : locked
      ? 'cursor-not-allowed text-amber-600 bg-amber-500/10 border border-amber-500/30 dark:text-amber-400'
      : 'hover:bg-muted active:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground';

  return (
    <button
      onClick={onClick}
      disabled={effectiveDisabled}
      title={effectiveTitle}
      aria-label={ariaLabel}
      className={[
        'flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors h-7',
        stateClass,
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
