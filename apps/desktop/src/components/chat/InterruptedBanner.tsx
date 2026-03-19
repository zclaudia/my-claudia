import { AlertTriangle } from 'lucide-react';

interface InterruptedBannerProps {
  onResume: () => void;
  onDismiss: () => void;
}

export function InterruptedBanner({ onResume, onDismiss }: InterruptedBannerProps) {
  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] z-20 flex items-center gap-3 rounded-xl border border-red-500/20 bg-background/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:static sm:inset-auto sm:bottom-auto sm:z-auto sm:rounded-none sm:border-x-0 sm:border-t-0 sm:bg-red-500/10 sm:px-4 sm:py-2 sm:shadow-none sm:backdrop-blur-0">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
      <span className="text-sm text-red-400">Session was interrupted by app restart.</span>
      <div className="ml-auto flex gap-2">
        <button
          onClick={onResume}
          className="text-xs px-3 py-1 rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          Resume
        </button>
        <button
          onClick={onDismiss}
          className="text-xs px-3 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
