import { useEffect } from 'react';
import { useUpdateStore } from '../stores/updateStore';
import { checkForUpdates, downloadAndInstallApk } from '../hooks/useAutoUpdate';

export function UpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const availableVersion = useUpdateStore((s) => s.availableVersion);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);
  const error = useUpdateStore((s) => s.error);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const manual = useUpdateStore((s) => s.manual);
  const dismiss = useUpdateStore((s) => s.dismiss);

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (status === 'error' && manual) {
      const id = setTimeout(() => {
        const s = useUpdateStore.getState();
        if (s.status === 'error') s.setStatus('idle');
      }, 5000);
      return () => clearTimeout(id);
    }
  }, [status, manual]);

  // Don't show banner when dismissed or idle
  if (dismissed && status !== 'up-to-date') return null;
  if (status === 'idle') return null;

  // For automatic checks, only show actionable states
  if (!manual && status === 'checking') return null;
  if (!manual && status === 'up-to-date') return null;
  if (!manual && status === 'error') return null;

  const handleRestart = async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      console.error('[UpdateBanner] Relaunch failed:', err);
    }
  };

  // Color scheme based on status
  const isError = status === 'error';
  const bgClass = isError
    ? 'bg-destructive/10 border-destructive/20'
    : 'bg-primary/10 border-primary/20';
  const iconColor = isError ? 'text-destructive' : 'text-primary';

  return (
    <div className={`flex items-center justify-between px-4 py-1.5 border-b text-sm flex-shrink-0 ${bgClass}`}>
      <div className="flex items-center gap-2 min-w-0">
        {/* Update icon */}
        <svg className={`w-4 h-4 flex-shrink-0 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isError ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          )}
        </svg>

        <span className="text-foreground truncate">
          {status === 'checking' && 'Checking for updates...'}
          {status === 'available' && `Update v${availableVersion} is available.`}
          {status === 'downloading' && `Downloading update v${availableVersion}... ${downloadProgress}%`}
          {status === 'ready' && `Update v${availableVersion} is ready.`}
          {status === 'up-to-date' && `You're up to date (v${currentVersion})`}
          {status === 'error' && (error || 'Update check failed')}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Android: download APK button */}
        {status === 'available' && (
          <button
            onClick={downloadAndInstallApk}
            className="px-3 py-0.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded transition-colors"
          >
            Download & Install
          </button>
        )}
        {/* Desktop: restart button */}
        {status === 'ready' && !navigator.userAgent.includes('Android') && (
          <button
            onClick={handleRestart}
            className="px-3 py-0.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded transition-colors"
          >
            Restart to Update
          </button>
        )}
        {(status === 'available' || status === 'ready' || status === 'downloading' || status === 'error') && (
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            aria-label="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/** Button to manually trigger an update check. Use in settings or header. */
export function CheckForUpdatesButton() {
  const status = useUpdateStore((s) => s.status);
  const isChecking = status === 'checking';

  return (
    <button
      onClick={() => checkForUpdates(true)}
      disabled={isChecking || status === 'downloading' || status === 'ready'}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      title="Check for updates"
    >
      {isChecking ? 'Checking...' : 'Check for Updates'}
    </button>
  );
}
