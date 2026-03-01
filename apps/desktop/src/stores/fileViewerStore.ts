import { create } from 'zustand';

const CACHE_MAX = 30;

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
  // LRU content cache  (key = "projectRoot\0relativePath")
  contentCache: Map<string, string>;

  openFile: (projectRoot: string, relativePath: string) => void;
  setContent: (content: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  close: () => void;
  togglePanel: () => void;
  setSearchOpen: (open: boolean) => void;
  setFullscreen: (open: boolean) => void;
  getCached: (projectRoot: string, relativePath: string) => string | undefined;
}

function cacheKey(root: string, path: string) { return `${root}\0${path}`; }

export const useFileViewerStore = create<FileViewerState>((set, get) => ({
  isOpen: false,
  filePath: null,
  projectRoot: null,
  content: null,
  loading: false,
  error: null,
  searchOpen: false,
  fullscreen: false,
  contentCache: new Map(),

  openFile: (projectRoot: string, relativePath: string) => {
    const cached = get().contentCache.get(cacheKey(projectRoot, relativePath));
    set({
      isOpen: true,
      filePath: relativePath,
      projectRoot,
      content: cached ?? null,
      loading: !cached,
      error: null,
      searchOpen: false,
    });
  },

  setContent: (content: string) => {
    const { filePath, projectRoot, contentCache } = get();
    if (filePath && projectRoot) {
      const key = cacheKey(projectRoot, filePath);
      // LRU eviction: delete then re-insert to move to end
      contentCache.delete(key);
      contentCache.set(key, content);
      if (contentCache.size > CACHE_MAX) {
        const oldest = contentCache.keys().next().value;
        if (oldest !== undefined) contentCache.delete(oldest);
      }
    }
    set({ content, loading: false });
  },

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

  getCached: (projectRoot: string, relativePath: string) =>
    get().contentCache.get(cacheKey(projectRoot, relativePath)),
}));
