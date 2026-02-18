/**
 * IndexedDB storage for client-side global agent conversations.
 *
 * Stores the agent's chat messages locally so they persist across
 * page reloads on mobile (where there's no backend SQLite).
 */

import type { ChatMessage } from './clientAI';

const DB_NAME = 'my-claudia-agent';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';
const CONVERSATION_KEY = 'global-agent';

// ============================================
// Database initialization
// ============================================

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// ============================================
// Public API
// ============================================

/**
 * Load saved agent messages from IndexedDB.
 */
export async function loadMessages(): Promise<ChatMessage[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(CONVERSATION_KEY);

      request.onsuccess = () => {
        const data = request.result;
        resolve(data?.messages || []);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[AgentStorage] Failed to load messages:', error);
    return [];
  }
}

/**
 * Save agent messages to IndexedDB.
 */
export async function saveMessages(messages: ChatMessage[]): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ messages, updatedAt: Date.now() }, CONVERSATION_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('[AgentStorage] Failed to save messages:', error);
  }
}

/**
 * Clear all agent messages from IndexedDB.
 */
export async function clearMessages(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(CONVERSATION_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('[AgentStorage] Failed to clear messages:', error);
  }
}
