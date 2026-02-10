import type { Database } from 'better-sqlite3';
import { nanoid } from 'nanoid';

export interface SearchHistoryEntry {
  id: string;
  userId: string;
  query: string;
  resultCount: number;
  createdAt: number;
}

/**
 * Save a search query to history
 * Automatically limits to 50 most recent entries per user
 */
export function saveSearchHistory(
  db: Database,
  query: string,
  resultCount: number,
  userId: string = 'default'
): SearchHistoryEntry {
  const id = nanoid();
  const createdAt = Date.now();

  // Insert new entry
  db.prepare(`
    INSERT INTO search_history (id, user_id, query, result_count, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, query, resultCount, createdAt);

  // Keep only the 50 most recent entries per user
  const keepIds = db.prepare(`
    SELECT id FROM search_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId) as Array<{ id: string }>;

  if (keepIds.length === 50) {
    const idsToKeep = keepIds.map(row => row.id);
    const placeholders = idsToKeep.map(() => '?').join(',');

    db.prepare(`
      DELETE FROM search_history
      WHERE user_id = ? AND id NOT IN (${placeholders})
    `).run(userId, ...idsToKeep);
  }

  return {
    id,
    userId,
    query,
    resultCount,
    createdAt,
  };
}

/**
 * Get search history for a user
 * Returns up to `limit` most recent entries
 */
export function getSearchHistory(
  db: Database,
  userId: string = 'default',
  limit: number = 10
): SearchHistoryEntry[] {
  const rows = db.prepare(`
    SELECT id, user_id as userId, query, result_count as resultCount, created_at as createdAt
    FROM search_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as SearchHistoryEntry[];

  return rows;
}

/**
 * Clear all search history for a user
 */
export function clearSearchHistory(
  db: Database,
  userId: string = 'default'
): void {
  db.prepare('DELETE FROM search_history WHERE user_id = ?').run(userId);
}

/**
 * Get unique queries from search history (for autocomplete)
 */
export function getSearchSuggestions(
  db: Database,
  prefix: string,
  userId: string = 'default',
  limit: number = 5
): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT query
    FROM search_history
    WHERE user_id = ? AND query LIKE ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, `${prefix}%`, limit) as Array<{ query: string }>;

  return rows.map(row => row.query);
}
