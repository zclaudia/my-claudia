import { useToastStore, type Toast } from '../stores/toastStore';

const TYPE_STYLES: Record<Toast['type'], { bg: string; icon: string }> = {
  success: { bg: 'bg-green-500/10 border-green-500/30', icon: '\u2713' },
  error: { bg: 'bg-red-500/10 border-red-500/30', icon: '\u2717' },
  info: { bg: 'bg-blue-500/10 border-blue-500/30', icon: '\u2139' },
};

function ToastCard({ toast }: { toast: Toast }) {
  const remove = useToastStore((s) => s.remove);
  const style = TYPE_STYLES[toast.type];

  return (
    <div
      onClick={() => {
        toast.onClick?.();
        remove(toast.id);
      }}
      className={`flex items-start gap-2 p-3 rounded-lg border shadow-lg backdrop-blur-sm cursor-pointer
        animate-in slide-in-from-bottom-2 fade-in duration-200
        ${style.bg} hover:opacity-90 transition-opacity max-w-[320px] pointer-events-auto`}
    >
      <span className="text-sm flex-shrink-0 mt-0.5">{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{toast.message}</p>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); remove(toast.id); }}
        className="text-muted-foreground hover:text-foreground text-xs flex-shrink-0 mt-0.5"
      >
        &times;
      </button>
    </div>
  );
}

export function ToastContainer({ className }: { className?: string }) {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="toast-container"
      className={className ?? 'fixed bottom-4 right-4 z-50 flex flex-col gap-2'}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
