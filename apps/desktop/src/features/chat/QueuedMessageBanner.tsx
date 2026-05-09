import { X } from 'lucide-react';

interface QueuedMessageBannerProps {
  content: string;
  onSendNow: () => void;
  onDismiss: () => void;
}

export function QueuedMessageBanner({ content, onSendNow, onDismiss }: QueuedMessageBannerProps) {
  return (
    <div className="mx-2 md:mx-4 mt-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-sm flex items-center gap-2">
      <span className="text-primary font-medium flex-shrink-0">Queued</span>
      <span className="text-foreground truncate flex-1 text-xs">
        {content.slice(0, 80)}{content.length > 80 ? '...' : ''}
      </span>
      <button
        onClick={onSendNow}
        className="text-xs font-medium text-primary hover:text-primary/80 px-2 py-1 bg-primary/10 rounded-md flex-shrink-0"
      >
        Send Now
      </button>
      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground flex-shrink-0 p-0.5"
        title="Dismiss queued message"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
