import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilePushStore, type FilePushItem } from '../filePushStore';

describe('filePushStore', () => {
  beforeEach(() => {
    useFilePushStore.setState({ items: [] });
    vi.clearAllMocks();
  });

  const createItemInput = (
    overrides: Partial<Omit<FilePushItem, 'status' | 'downloadProgress' | 'createdAt'>> = {}
  ) => ({
    fileId: 'file-1',
    fileName: 'test.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    sessionId: 'session-1',
    autoDownload: false,
    ...overrides,
  });

  describe('addItem', () => {
    it('adds item with pending status and zero progress', () => {
      useFilePushStore.getState().addItem(createItemInput());

      const items = useFilePushStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0].fileId).toBe('file-1');
      expect(items[0].status).toBe('pending');
      expect(items[0].downloadProgress).toBe(0);
      expect(items[0].createdAt).toBeGreaterThan(0);
    });

    it('does not add duplicate items with the same fileId', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().addItem(createItemInput());

      expect(useFilePushStore.getState().items).toHaveLength(1);
    });

    it('adds items with different fileIds', () => {
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-1' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-2' }));

      expect(useFilePushStore.getState().items).toHaveLength(2);
    });

    it('preserves optional fields like description and serverId', () => {
      useFilePushStore.getState().addItem(
        createItemInput({ description: 'A test file', serverId: 'server-1' })
      );

      const item = useFilePushStore.getState().items[0];
      expect(item.description).toBe('A test file');
      expect(item.serverId).toBe('server-1');
    });
  });

  describe('updateStatus', () => {
    it('updates the status of a specific item', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updateStatus('file-1', 'downloading');

      expect(useFilePushStore.getState().items[0].status).toBe('downloading');
    });

    it('sets downloadProgress to 100 when status is completed', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updateProgress('file-1', 50);
      useFilePushStore.getState().updateStatus('file-1', 'completed');

      expect(useFilePushStore.getState().items[0].downloadProgress).toBe(100);
    });

    it('sets error message when status is error', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updateStatus('file-1', 'error', 'Network failed');

      const item = useFilePushStore.getState().items[0];
      expect(item.status).toBe('error');
      expect(item.error).toBe('Network failed');
    });

    it('does not modify other items', () => {
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-1' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-2' }));
      useFilePushStore.getState().updateStatus('file-1', 'completed');

      expect(useFilePushStore.getState().items[1].status).toBe('pending');
    });

    it('preserves existing progress when status is not completed', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updateProgress('file-1', 42);
      useFilePushStore.getState().updateStatus('file-1', 'error', 'Timeout');

      expect(useFilePushStore.getState().items[0].downloadProgress).toBe(42);
    });
  });

  describe('updateProgress', () => {
    it('updates the download progress of a specific item', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updateProgress('file-1', 75);

      expect(useFilePushStore.getState().items[0].downloadProgress).toBe(75);
    });

    it('does not modify other items', () => {
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-1' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-2' }));
      useFilePushStore.getState().updateProgress('file-1', 60);

      expect(useFilePushStore.getState().items[1].downloadProgress).toBe(0);
    });
  });

  describe('updateSavedPath', () => {
    it('updates the saved path of a specific item', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updateSavedPath('file-1', '/downloads/test.pdf');

      expect(useFilePushStore.getState().items[0].savedPath).toBe('/downloads/test.pdf');
    });
  });

  describe('updatePrivatePath', () => {
    it('updates the private path of a specific item', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updatePrivatePath('file-1', '/private/test.pdf');

      expect(useFilePushStore.getState().items[0].privatePath).toBe('/private/test.pdf');
    });

    it('does not modify other items', () => {
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-1' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-2' }));
      useFilePushStore.getState().updatePrivatePath('file-1', '/private/test.pdf');

      expect(useFilePushStore.getState().items[1].privatePath).toBeUndefined();
    });
  });

  describe('removeItem', () => {
    it('removes the item with the given fileId', () => {
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-1' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-2' }));
      useFilePushStore.getState().removeItem('file-1');

      const items = useFilePushStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0].fileId).toBe('file-2');
    });

    it('does nothing when fileId does not exist', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().removeItem('non-existent');

      expect(useFilePushStore.getState().items).toHaveLength(1);
    });
  });

  describe('getItemsForSession', () => {
    it('returns items matching the session ID', () => {
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-1', sessionId: 'session-a' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-2', sessionId: 'session-b' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-3', sessionId: 'session-a' }));

      const result = useFilePushStore.getState().getItemsForSession('session-a');
      expect(result).toHaveLength(2);
      expect(result.map(i => i.fileId)).toEqual(['file-1', 'file-3']);
    });

    it('returns empty array when no items match', () => {
      useFilePushStore.getState().addItem(createItemInput({ sessionId: 'session-a' }));

      const result = useFilePushStore.getState().getItemsForSession('session-x');
      expect(result).toEqual([]);
    });
  });

  describe('getPendingItems', () => {
    it('returns only items with pending status', () => {
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-1' }));
      useFilePushStore.getState().addItem(createItemInput({ fileId: 'file-2' }));
      useFilePushStore.getState().updateStatus('file-1', 'completed');

      const pending = useFilePushStore.getState().getPendingItems();
      expect(pending).toHaveLength(1);
      expect(pending[0].fileId).toBe('file-2');
    });

    it('returns empty array when no items are pending', () => {
      useFilePushStore.getState().addItem(createItemInput());
      useFilePushStore.getState().updateStatus('file-1', 'completed');

      expect(useFilePushStore.getState().getPendingItems()).toEqual([]);
    });
  });

  describe('onRehydrateStorage (persist middleware)', () => {
    it('resets downloading items to pending on rehydration', () => {
      // Simulate a store with an item stuck in downloading state
      useFilePushStore.setState({
        items: [
          {
            fileId: 'file-1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            fileSize: 1024,
            sessionId: 'session-1',
            autoDownload: false,
            status: 'downloading',
            downloadProgress: 45,
            createdAt: Date.now(),
          },
          {
            fileId: 'file-2',
            fileName: 'test2.pdf',
            mimeType: 'application/pdf',
            fileSize: 2048,
            sessionId: 'session-1',
            autoDownload: false,
            status: 'completed',
            downloadProgress: 100,
            createdAt: Date.now(),
          },
        ],
      });

      // Access the persist API to trigger onRehydrateStorage
      const persistApi = (useFilePushStore as any).persist;
      const onRehydrate = persistApi?.getOptions?.()?.onRehydrateStorage;
      if (onRehydrate) {
        const callback = onRehydrate();
        const state = useFilePushStore.getState();
        callback(state);

        // After rehydration, downloading items should be reset to pending
        expect(state.items[0].status).toBe('pending');
        expect(state.items[0].downloadProgress).toBe(0);
        // Completed items should remain unchanged
        expect(state.items[1].status).toBe('completed');
        expect(state.items[1].downloadProgress).toBe(100);
      }
    });
  });
});
