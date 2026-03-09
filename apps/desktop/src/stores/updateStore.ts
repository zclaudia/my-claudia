import { create } from 'zustand';

export type UpdateStatus =
  | 'idle'        // No update activity
  | 'checking'    // Checking for updates (visible only on manual check)
  | 'available'   // Update available, waiting for user action (Android)
  | 'downloading' // Downloading update in background
  | 'ready'       // Downloaded, ready for user to restart
  | 'up-to-date'  // Already on latest version (shown briefly on manual check)
  | 'error';      // Something went wrong (shown on manual check)

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string | null;
  downloadProgress: number; // 0-100
  error: string | null;
  dismissed: boolean;
  /** Whether the current check was triggered manually (affects UI visibility) */
  manual: boolean;
  /** APK download URL for Android updates */
  androidApkUrl: string | null;

  setStatus: (status: UpdateStatus) => void;
  setAvailableUpdate: (version: string, notes: string | null) => void;
  setDownloadProgress: (progress: number) => void;
  setError: (error: string) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: 'idle',
  currentVersion: '',
  availableVersion: null,
  releaseNotes: null,
  downloadProgress: 0,
  error: null,
  dismissed: false,
  manual: false,
  androidApkUrl: null,

  setStatus: (status) => set({ status, error: null }),
  setAvailableUpdate: (version, notes) =>
    set({ availableVersion: version, releaseNotes: notes, status: 'downloading' }),
  setDownloadProgress: (progress) => set({ downloadProgress: progress }),
  setError: (error) => set({ status: 'error', error }),
  dismiss: () => set({ dismissed: true }),
  reset: () =>
    set({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      downloadProgress: 0,
      error: null,
      dismissed: false,
      manual: false,
      androidApkUrl: null,
    }),
}));
