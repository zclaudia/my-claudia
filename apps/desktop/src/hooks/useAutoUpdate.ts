import { useEffect, useRef } from 'react';
import { useUpdateStore } from '../stores/updateStore';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 5000; // 5 seconds after startup

function isDesktopTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    !navigator.userAgent.includes('Android')
  );
}

/**
 * Core update check + download logic. Shared by auto and manual triggers.
 * @param manual - If true, shows checking/up-to-date/error states in UI
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!isDesktopTauri()) return;

  const store = useUpdateStore.getState();
  // Don't re-check if already downloading or ready
  if (store.status === 'ready' || store.status === 'downloading') return;

  try {
    useUpdateStore.setState({ manual });
    store.setStatus('checking');

    // Dynamic import — these modules only exist in Tauri builds
    const { check } = await import('@tauri-apps/plugin-updater');
    const { getVersion } = await import('@tauri-apps/api/app');

    const currentVersion = await getVersion();
    useUpdateStore.setState({ currentVersion });

    const update = await check();

    if (!update) {
      // Already up to date
      if (manual) {
        store.setStatus('up-to-date');
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
          const s = useUpdateStore.getState();
          if (s.status === 'up-to-date') s.setStatus('idle');
        }, 3000);
      } else {
        store.setStatus('idle');
      }
      return;
    }

    // Update available — start background download
    store.setAvailableUpdate(update.version, update.body ?? null);

    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            const pct = Math.round((downloaded / contentLength) * 100);
            useUpdateStore.getState().setDownloadProgress(pct);
          }
          break;
        case 'Finished':
          break;
      }
    });

    // Download + install complete, ready for restart
    useUpdateStore.getState().setStatus('ready');
    useUpdateStore.getState().setDownloadProgress(100);
  } catch (err) {
    console.warn('[AutoUpdate] Check failed:', err);
    if (manual) {
      useUpdateStore.getState().setError(
        err instanceof Error ? err.message : 'Update check failed'
      );
    } else {
      // Silent failure for automatic checks
      useUpdateStore.getState().setStatus('idle');
    }
  }
}

/**
 * Hook that automatically checks for updates on startup and periodically.
 * Call once in the top-level App component.
 */
export function useAutoUpdate() {
  const started = useRef(false);

  useEffect(() => {
    if (!isDesktopTauri() || started.current) return;
    started.current = true;

    // Initial check after delay
    const timeoutId = setTimeout(() => checkForUpdates(false), INITIAL_DELAY_MS);

    // Periodic re-check
    const intervalId = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, []);
}
