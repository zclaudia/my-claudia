import { ExternalLink } from 'lucide-react';

interface PoppedOutPlaceholderProps {
  label: string;
  onFocus: (label: string) => Promise<void>;
  onBringBack: (label: string) => Promise<void>;
}

export function PoppedOutPlaceholder({ label, onFocus, onBringBack }: PoppedOutPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground">
      <ExternalLink size={32} className="opacity-40" />
      <p className="text-sm">This session is open in a separate window</p>
      <div className="flex gap-2">
        <button
          onClick={() => onFocus(label)}
          className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary transition-colors"
        >
          Focus window
        </button>
        <button
          onClick={() => onBringBack(label)}
          className="px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:bg-muted transition-colors"
        >
          Bring back here
        </button>
      </div>
    </div>
  );
}
