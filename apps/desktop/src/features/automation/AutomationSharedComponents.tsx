import { useState } from 'react';
import { Loader2, Zap, ChevronDown } from 'lucide-react';
import type { AutomationBackendOption } from './useAutomationBackendOptions';

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

export function EmptyState({ message, subtitle }: { message: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Zap size={24} className="mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
      {subtitle && <p className="text-xs mt-1 opacity-60">{subtitle}</p>}
    </div>
  );
}

export function AutomationBackendSelector({
  options,
  selectedBackendId,
  onSelect,
}: {
  options: AutomationBackendOption[];
  selectedBackendId: string | null;
  onSelect: (backendId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.backendId === selectedBackendId) ?? options[0] ?? null;

  if (!selected) return null;

  const getStatusColor = (option: AutomationBackendOption) => {
    switch (option.status) {
      case 'ready':
        return 'bg-success';
      case 'transport_reconnecting':
      case 'backend_subscribing':
      case 'data_syncing':
      case 'session_syncing':
        return 'bg-warning animate-pulse';
      case 'error':
        return 'bg-destructive';
      default:
        return 'bg-muted-foreground';
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm hover:bg-muted transition-colors"
        data-testid="automation-backend-selector"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${getStatusColor(selected)}`} />
        <span className="max-w-[180px] truncate">{selected.name}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="absolute left-0 top-full z-[70] mt-2 w-72 rounded-xl border border-border bg-card p-1 shadow-xl">
            {options.map((option) => (
              <button
                key={option.backendId}
                type="button"
                onClick={() => {
                  onSelect(option.backendId);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  option.backendId === selected.backendId ? 'bg-secondary' : 'hover:bg-secondary/60'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${getStatusColor(option)}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{option.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {option.isLocal ? 'Local' : 'Remote'}
                    {option.latencyMs != null ? ` · ${option.latencyMs}ms` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="fixed inset-0 z-[65]" onClick={() => setIsOpen(false)} />
        </>
      )}
    </div>
  );
}
