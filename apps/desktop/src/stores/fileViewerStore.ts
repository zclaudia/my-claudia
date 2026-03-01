import { create } from 'zustand';

interface FileViewerState {
  // Panel open state
  isOpen: boolean;
  // Currently viewed file
  filePath: string | null;    // relative path from project root
  projectRoot: string | null;
  // File content
  content: string | null;
  loading: boolean;
  error: string | null;
  // Search mode (Cmd+P)
  searchOpen: boolean;
  // Full-screen overlay (mobile)
  fullscreen: boolean;

  openFile: (projectRoot: string, relativePath: string) => void;
  setContent: (content: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  close: () => void;
  togglePanel: () => void;
  setSearchOpen: (open: boolean) => void;
  setFullscreen: (open: boolean) => void;
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
  isOpen: false,
  filePath: null,
  projectRoot: null,
  content: null,
  loading: false,
  error: null,
  searchOpen: false,
  fullscreen: false,

  openFile: (projectRoot: string, relativePath: string) =>
    set({
      isOpen: true,
      filePath: relativePath,
      projectRoot,
      content: null,
      loading: true,
      error: null,
      searchOpen: false,
    }),

  setContent: (content: string) =>
    set({ content, loading: false }),

  setLoading: (loading: boolean) =>
    set({ loading }),

  setError: (error: string | null) =>
    set({ error, loading: false }),

  close: () =>
    set({ isOpen: false, searchOpen: false, fullscreen: false }),

  togglePanel: () =>
    set((state) => ({ isOpen: !state.isOpen })),

  setSearchOpen: (open: boolean) =>
    set({ searchOpen: open, isOpen: open ? true : undefined }),

  setFullscreen: (open: boolean) =>
    set({ fullscreen: open }),
}));
