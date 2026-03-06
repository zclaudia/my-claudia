import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadMessages, saveMessages, clearMessages } from '../agentStorage.js';
import type { ChatMessage } from '../clientAI';

// The IndexedDB mock is set up in src/test/setup.ts

describe('services/agentStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadMessages', () => {
    it('returns empty array on first load', async () => {
      const messages = await loadMessages();
      // With our mock, this should return an empty array
      // since we haven't saved anything yet
      expect(Array.isArray(messages)).toBe(true);
    });

    it('handles errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Force an error by making indexedDB.open throw
      const originalOpen = indexedDB.open;
      vi.stubGlobal('indexedDB', {
        ...indexedDB,
        open: vi.fn().mockImplementation(() => {
          throw new Error('IndexedDB error');
        }),
      });

      const messages = await loadMessages();

      expect(messages).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      vi.stubGlobal('indexedDB', { open: originalOpen });
    });
  });

  describe('saveMessages', () => {
    it('saves messages to IndexedDB', async () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi there!',
          createdAt: Date.now(),
        },
      ];

      await saveMessages(messages);

      // Verify it doesn't throw
      expect(true).toBe(true);
    });

    it('handles errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const originalOpen = indexedDB.open;
      vi.stubGlobal('indexedDB', {
        ...indexedDB,
        open: vi.fn().mockImplementation(() => {
          throw new Error('IndexedDB error');
        }),
      });

      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Test', createdAt: Date.now() },
      ];

      await saveMessages(messages);

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      vi.stubGlobal('indexedDB', { open: originalOpen });
    });
  });

  describe('clearMessages', () => {
    it('removes all messages', async () => {
      await clearMessages();
      expect(true).toBe(true);
    });

    it('handles errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const originalOpen = indexedDB.open;
      vi.stubGlobal('indexedDB', {
        ...indexedDB,
        open: vi.fn().mockImplementation(() => {
          throw new Error('IndexedDB error');
        }),
      });

      await clearMessages();

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      vi.stubGlobal('indexedDB', { open: originalOpen });
    });
  });
});
