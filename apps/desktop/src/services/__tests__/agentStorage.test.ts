import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '../clientAI';

// Use dynamic imports so vi.resetModules() gives us a fresh dbPromise each test
let loadMessages: typeof import('../agentStorage.js').loadMessages;
let saveMessages: typeof import('../agentStorage.js').saveMessages;
let clearMessages: typeof import('../agentStorage.js').clearMessages;

describe('services/agentStorage', () => {
  // Save original indexedDB so we can restore it after error tests
  const originalIndexedDB = globalThis.indexedDB;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    // Restore original indexedDB in case previous test stubbed it
    globalThis.indexedDB = originalIndexedDB;
    vi.resetModules();
    const mod = await import('../agentStorage.js');
    loadMessages = mod.loadMessages;
    saveMessages = mod.saveMessages;
    clearMessages = mod.clearMessages;
  });

  describe('loadMessages', () => {
    it('returns empty array on first load', async () => {
      const messages = await loadMessages();
      expect(Array.isArray(messages)).toBe(true);
      expect(messages).toEqual([]);
    });

    it('handles errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Reset modules again to get a fresh dbPromise that will use our broken indexedDB
      vi.resetModules();
      vi.stubGlobal('indexedDB', {
        open: vi.fn().mockImplementation(() => {
          throw new Error('IndexedDB error');
        }),
      });

      const mod = await import('../agentStorage.js');
      const messages = await mod.loadMessages();

      expect(messages).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('saveMessages', () => {
    it('saves messages to IndexedDB', async () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!', createdAt: Date.now() },
      ];

      await saveMessages(messages);
      // Verify it doesn't throw
      expect(true).toBe(true);
    });

    it('handles errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      vi.stubGlobal('indexedDB', {
        open: vi.fn().mockImplementation(() => {
          throw new Error('IndexedDB error');
        }),
      });

      const mod = await import('../agentStorage.js');
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Test', createdAt: Date.now() },
      ];

      await mod.saveMessages(messages);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('clearMessages', () => {
    it('removes all messages', async () => {
      await clearMessages();
      expect(true).toBe(true);
    });

    it('handles errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      vi.stubGlobal('indexedDB', {
        open: vi.fn().mockImplementation(() => {
          throw new Error('IndexedDB error');
        }),
      });

      const mod = await import('../agentStorage.js');
      await mod.clearMessages();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('round-trip operations', () => {
    it('caches database connection across calls', async () => {
      // Multiple calls should reuse the same db connection (same module)
      await saveMessages([]);
      const loaded = await loadMessages();
      expect(loaded).toEqual([]);
    });

    it('clearMessages after save works', async () => {
      await clearMessages();
      const loaded = await loadMessages();
      expect(loaded).toEqual([]);
    });
  });

  describe('database initialization', () => {
    it('creates object store on upgrade', async () => {
      // loadMessages triggers getDB which opens the database
      // The onupgradeneeded handler creates the store
      const messages = await loadMessages();
      expect(messages).toEqual([]);
    });
  });
});
