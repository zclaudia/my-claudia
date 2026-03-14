import { useEffect, useRef } from 'react';
import { useUpdateStore } from '../stores/updateStore';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 5000; // 5 seconds after startup
const ANDROID_LATEST_URL =
  'https://github.com/zclaudia/my-claudia/releases/latest/download/android-latest.json';
const DESKTOP_LATEST_URL =
  'https://github.com/zclaudia/my-claudia/releases/latest/download/latest.json';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isAndroid(): boolean {
  return isTauri() && navigator.userAgent.includes('Android');
}

function isDesktopTauri(): boolean {
  return isTauri() && !navigator.userAgent.includes('Android');
}

/**
 * Compare semver-like version strings (e.g. "0.1.2260" > "0.1.2259").
 * Returns true if the remote numeric core is newer than local.
 * Suffixes like "-dev.macos.20260314093015" are ignored for update purposes.
 */
export function isDevBuild(version: string): boolean {
  return version.includes('-dev');
}

export function compareVersionCore(remote: string, local: string): number {
  const rBase = remote.replace(/-.*$/, '');
  const lBase = local.replace(/-.*$/, '');
  const r = rBase.split('.').map(Number);
  const l = lBase.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return 1;
    if (rv < lv) return -1;
  }
  return 0;
}

function isNewerVersion(remote: string, local: string): boolean {
  const coreCompare = compareVersionCore(remote, local);
  return coreCompare > 0;
}

export async function hasDesktopUpdateCandidate(currentVersion: string): Promise<boolean> {
  if (!isDevBuild(currentVersion)) return true;

  const res = await fetch(DESKTOP_LATEST_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const latest: { version?: string } = await res.json();
  if (!latest.version) return true;

  return compareVersionCore(latest.version, currentVersion) > 0;
}

/**
 * Android update check: fetch android-latest.json, compare versions.
 * Does NOT auto-download — sets status to 'available' for user to trigger download.
 */
async function checkForAndroidUpdates(manual: boolean): Promise<void> {
  const store = useUpdateStore.getState();
  if (store.status === 'ready' || store.status === 'downloading') return;

  try {
    useUpdateStore.setState({ manual });
    store.setStatus('checking');

    const { getVersion } = await import('@tauri-apps/api/app');
    const currentVersion = await getVersion();
    useUpdateStore.setState({ currentVersion });

    const res = await fetch(ANDROID_LATEST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const latest: { version: string; url: string; notes?: string } = await res.json();

    if (!isNewerVersion(latest.version, currentVersion)) {
      if (manual) {
        store.setStatus('up-to-date');
        setTimeout(() => {
          const s = useUpdateStore.getState();
          if (s.status === 'up-to-date') s.setStatus('idle');
        }, 3000);
      } else {
        store.setStatus('idle');
      }
      return;
    }

    // Update available — store info for user action
    useUpdateStore.setState({
      availableVersion: latest.version,
      releaseNotes: latest.notes ?? null,
      androidApkUrl: latest.url,
      status: 'available',
    });
  } catch (err) {
    console.warn('[AutoUpdate:Android] Check failed:', err);
    if (manual) {
      useUpdateStore.getState().setError(
        err instanceof Error ? err.message : 'Update check failed'
      );
    } else {
      useUpdateStore.getState().setStatus('idle');
    }
  }
}

/**
 * Download APK from the URL stored in updateStore and trigger install.
 */
export async function downloadAndInstallApk(): Promise<void> {
  const store = useUpdateStore.getState();
  const url = store.androidApkUrl;
  if (!url) return;

  try {
    store.setStatus('downloading');
    store.setDownloadProgress(0);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const contentLength = Number(res.headers.get('Content-Length') || 0);
    const reader = res.body?.getReader();

    let blob: Blob;
    if (reader) {
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          store.setDownloadProgress(Math.round((received / contentLength) * 100));
        }
      }
      blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.android.package-archive' });
    } else {
      blob = await res.blob();
    }

    // Save APK to app-private dir, then copy to Downloads
    const { downloadDir } = await import('@tauri-apps/api/path');
    const { writeFile } = await import('@tauri-apps/plugin-fs');

    const fileName = `MyClaudia-${store.availableVersion}.apk`;
    const dir = await downloadDir();
    const filePath = `${dir}/${fileName}`;

    const buffer = await blob.arrayBuffer();
    await writeFile(filePath, new Uint8Array(buffer));

    // Copy to shared Downloads for visibility, then open with installer
    const bridge = (window as any).AndroidFiles;
    if (bridge) {
      bridge.saveToDownloads(filePath, fileName, 'application/vnd.android.package-archive');
      bridge.openFile(filePath, 'application/vnd.android.package-archive');
    }

    store.setDownloadProgress(100);
    store.setStatus('ready');
  } catch (err) {
    console.warn('[AutoUpdate:Android] Download failed:', err);
    useUpdateStore.getState().setError(
      err instanceof Error ? err.message : 'APK download failed'
    );
  }
}

/**
 * Core update check + download logic. Shared by auto and manual triggers.
 * @param manual - If true, shows checking/up-to-date/error states in UI
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (isAndroid()) {
    return checkForAndroidUpdates(manual);
  }
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

    if (!(await hasDesktopUpdateCandidate(currentVersion))) {
      if (manual) {
        store.setStatus('up-to-date');
        setTimeout(() => {
          const s = useUpdateStore.getState();
          if (s.status === 'up-to-date') s.setStatus('idle');
        }, 3000);
      } else {
        store.setStatus('idle');
      }
      return;
    }

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
    if (!isTauri() || started.current) return;
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
