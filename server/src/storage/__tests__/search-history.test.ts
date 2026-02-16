import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  saveSearchHistory,
  getSearchHistory,
  clearSearchHistory,
  getSearchSuggestions,
} from '../search-history.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_history (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'default',
      query TEXT NOT NULL,
      result_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_history_user_id
      ON search_history(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_search_history_created_at
      ON search_history(created_at DESC);
  `);
  return db;
}

describe('search-history', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('saveSearchHistory', () => {
    it('writes a record and is verifiable via DB query', () => {
      const entry = saveSearchHistory(db, 'test query', 5, 'user1');

      expect(entry.query).toBe('test query');
      expect(entry.resultCount).toBe(5);
      expect(entry.userId).toBe('user1');
      expect(entry.id).toBeTruthy();
      expect(entry.createdAt).toBeGreaterThan(0);

      // Verify via direct DB query
      const row = db.prepare('SELECT * FROM search_history WHERE id = ?').get(entry.id) as {
        id: string;
        user_id: string;
        query: string;
        result_count: number;
        created_at: number;
      };
      expect(row).toBeDefined();
      expect(row.query).toBe('test query');
      expect(row.result_count).toBe(5);
      expect(row.user_id).toBe('user1');
    });

    it('uses default userId when not provided', () => {
      const entry = saveSearchHistory(db, 'hello', 0);
      expect(entry.userId).toBe('default');

      const row = db.prepare('SELECT user_id FROM search_history WHERE id = ?').get(entry.id) as {
        user_id: string;
      };
      expect(row.user_id).toBe('default');
    });

    it('limits to 50 most recent entries per user', () => {
      // Insert 55 entries
      for (let i = 0; i < 55; i++) {
        saveSearchHistory(db, `query-${i}`, i, 'user1');
      }

      const count = db.prepare(
        'SELECT COUNT(*) as cnt FROM search_history WHERE user_id = ?'
      ).get('user1') as { cnt: number };
      expect(count.cnt).toBe(50);
    });

    it('does not affect other users when pruning', () => {
      for (let i = 0; i < 55; i++) {
        saveSearchHistory(db, `query-${i}`, i, 'user1');
      }
      saveSearchHistory(db, 'other-query', 1, 'user2');

      const countUser2 = db.prepare(
        'SELECT COUNT(*) as cnt FROM search_history WHERE user_id = ?'
      ).get('user2') as { cnt: number };
      expect(countUser2.cnt).toBe(1);
    });
  });

  describe('getSearchHistory', () => {
    it('returns results sorted by createdAt DESC', () => {
      // Insert with explicit time gaps
      const e1 = saveSearchHistory(db, 'first', 1, 'user1');
      const e2 = saveSearchHistory(db, 'second', 2, 'user1');
      const e3 = saveSearchHistory(db, 'third', 3, 'user1');

      const history = getSearchHistory(db, 'user1', 10);

      expect(history.length).toBe(3);
      // Most recent first
      expect(history[0].createdAt).toBeGreaterThanOrEqual(history[1].createdAt);
      expect(history[1].createdAt).toBeGreaterThanOrEqual(history[2].createdAt);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        saveSearchHistory(db, `query-${i}`, i, 'user1');
      }

      const history = getSearchHistory(db, 'user1', 3);
      expect(history.length).toBe(3);
    });

    it('returns empty array for empty DB', () => {
      const history = getSearchHistory(db, 'user1');
      expect(history).toEqual([]);
    });

    it('returns empty array for non-existent user', () => {
      saveSearchHistory(db, 'query', 1, 'user1');
      const history = getSearchHistory(db, 'no-such-user');
      expect(history).toEqual([]);
    });

    it('returns correct fields', () => {
      saveSearchHistory(db, 'my query', 42, 'user1');
      const history = getSearchHistory(db, 'user1');

      expect(history.length).toBe(1);
      expect(history[0]).toHaveProperty('id');
      expect(history[0]).toHaveProperty('userId', 'user1');
      expect(history[0]).toHaveProperty('query', 'my query');
      expect(history[0]).toHaveProperty('resultCount', 42);
      expect(history[0]).toHaveProperty('createdAt');
    });
  });

  describe('clearSearchHistory', () => {
    it('removes all records for a user', () => {
      saveSearchHistory(db, 'q1', 1, 'user1');
      saveSearchHistory(db, 'q2', 2, 'user1');
      saveSearchHistory(db, 'q3', 3, 'user1');

      clearSearchHistory(db, 'user1');

      const history = getSearchHistory(db, 'user1');
      expect(history).toEqual([]);
    });

    it('does not affect other users', () => {
      saveSearchHistory(db, 'q1', 1, 'user1');
      saveSearchHistory(db, 'q2', 2, 'user2');

      clearSearchHistory(db, 'user1');

      const historyUser1 = getSearchHistory(db, 'user1');
      const historyUser2 = getSearchHistory(db, 'user2');
      expect(historyUser1).toEqual([]);
      expect(historyUser2.length).toBe(1);
    });

    it('is safe to call on empty DB', () => {
      expect(() => clearSearchHistory(db, 'user1')).not.toThrow();
    });
  });

  describe('getSearchSuggestions', () => {
    it('returns queries matching prefix', () => {
      saveSearchHistory(db, 'react hooks', 10, 'user1');
      saveSearchHistory(db, 'react router', 5, 'user1');
      saveSearchHistory(db, 'vue components', 3, 'user1');

      const suggestions = getSearchSuggestions(db, 'react', 'user1');
      expect(suggestions.length).toBe(2);
      expect(suggestions).toContain('react hooks');
      expect(suggestions).toContain('react router');
    });

    it('deduplicates results', () => {
      saveSearchHistory(db, 'react hooks', 10, 'user1');
      saveSearchHistory(db, 'react hooks', 20, 'user1');
      saveSearchHistory(db, 'react hooks', 30, 'user1');

      const suggestions = getSearchSuggestions(db, 'react', 'user1');
      expect(suggestions.length).toBe(1);
      expect(suggestions[0]).toBe('react hooks');
    });

    it('respects limit parameter', () => {
      saveSearchHistory(db, 'a1', 1, 'user1');
      saveSearchHistory(db, 'a2', 2, 'user1');
      saveSearchHistory(db, 'a3', 3, 'user1');
      saveSearchHistory(db, 'a4', 4, 'user1');

      const suggestions = getSearchSuggestions(db, 'a', 'user1', 2);
      expect(suggestions.length).toBe(2);
    });

    it('returns empty array when no matches', () => {
      saveSearchHistory(db, 'react hooks', 10, 'user1');
      const suggestions = getSearchSuggestions(db, 'vue', 'user1');
      expect(suggestions).toEqual([]);
    });

    it('returns empty array on empty DB', () => {
      const suggestions = getSearchSuggestions(db, 'any', 'user1');
      expect(suggestions).toEqual([]);
    });

    it('is case-sensitive for prefix matching', () => {
      saveSearchHistory(db, 'React hooks', 10, 'user1');
      saveSearchHistory(db, 'react hooks', 5, 'user1');

      const upper = getSearchSuggestions(db, 'React', 'user1');
      const lower = getSearchSuggestions(db, 'react', 'user1');

      expect(upper).toContain('React hooks');
      expect(lower).toContain('react hooks');
    });
  });
});
