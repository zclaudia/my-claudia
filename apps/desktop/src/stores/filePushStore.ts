import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FilePushStatus = 'pending' | 'downloading' | 'completed' | 'error';

export interface FilePushItem {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sessionId: string;
  description?: string;
  autoDownload: boolean;
  status: FilePushStatus;
  downloadProgress: number; // 0-100
  error?: string;
  /** Source server ID (for constructing download URL) */
  serverId?: string;
  /** Absolute path where the file was saved (Tauri desktop only) */
  savedPath?: string;
  createdAt: number;
}

interface FilePushState {
  items: FilePushItem[];

  addItem: (item: Omit<FilePushItem, 'status' | 'downloadProgress' | 'createdAt'>) => void;
  updateStatus: (fileId: string, status: FilePushStatus, error?: string) => void;
  updateProgress: (fileId: string, progress: number) => void;
  updateSavedPath: (fileId: string, savedPath: string) => void;
  removeItem: (fileId: string) => void;
  getItemsForSession: (sessionId: string) => FilePushItem[];
  getPendingItems: () => FilePushItem[];
}

export const useFilePushStore = create<FilePushState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) =>
        set((state) => {
          // Don't add duplicates
          if (state.items.some((i) => i.fileId === item.fileId)) {
            return state;
          }
          return {
            items: [
              ...state.items,
              {
                ...item,
                status: 'pending',
                downloadProgress: 0,
                createdAt: Date.now(),
              },
            ],
          };
        }),

      updateStatus: (fileId, status, error) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.fileId === fileId
              ? { ...i, status, error, downloadProgress: status === 'completed' ? 100 : i.downloadProgress }
              : i
          ),
        })),

      updateProgress: (fileId, progress) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.fileId === fileId ? { ...i, downloadProgress: progress } : i
          ),
        })),

      updateSavedPath: (fileId, savedPath) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.fileId === fileId ? { ...i, savedPath } : i
          ),
        })),

      removeItem: (fileId) =>
        set((state) => ({
          items: state.items.filter((i) => i.fileId !== fileId),
        })),

      getItemsForSession: (sessionId) => {
        return get().items.filter((i) => i.sessionId === sessionId);
      },

      getPendingItems: () => {
        return get().items.filter((i) => i.status === 'pending');
      },
    }),
    {
      name: 'file-push-store',
      // Reset interrupted downloads on reload
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.items = state.items.map((i: FilePushItem) =>
          i.status === 'downloading' ? { ...i, status: 'pending' as const, downloadProgress: 0 } : i
        );
      },
    },
  ),
);
