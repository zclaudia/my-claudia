import type { Database } from 'better-sqlite3';
import {
  clearSearchHistory,
  getSearchHistory,
  getSearchSuggestions,
  saveSearchHistory,
  type SearchHistoryEntry,
} from '../../infrastructure/storage/search-history.js';

export interface SessionSearchQuery {
  q: string;
  projectId?: string;
  role?: string;
  sessionIds?: string;
  startDate?: number;
  endDate?: number;
  sort: string;
  scope: string;
  limit: number;
  offset: number;
}

export interface SessionSearchResult {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
  sessionName: string | null;
  resultType?: string;
}

export class SessionSearchRepository {
  constructor(private db: Database) {}

  private buildSessionFilters(
    prefix: string,
    query: SessionSearchQuery,
  ): { conditions: string[]; params: Array<string | number> } {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (query.projectId) {
      conditions.push(`${prefix}.project_id = ?`);
      params.push(query.projectId);
    }

    if (query.sessionIds) {
      const ids = query.sessionIds.split(',').filter(id => id.trim());
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        conditions.push(`${prefix}.session_id IN (${placeholders})`);
        params.push(...ids);
      }
    }

    if (query.startDate) {
      conditions.push(`${prefix}.created_at >= ?`);
      params.push(query.startDate);
    }
    if (query.endDate) {
      conditions.push(`${prefix}.created_at <= ?`);
      params.push(query.endDate);
    }

    return { conditions, params };
  }

  search(query: SessionSearchQuery): SessionSearchResult[] {
    const safeQuery = query.q.replace(/"/g, '""');
    let results: SessionSearchResult[] = [];

    if (query.scope === 'messages' || query.scope === 'all') {
      const conditions: string[] = ['messages_fts MATCH ?'];
      const params: Array<string | number> = [`"${safeQuery}"`];

      if (query.role && (query.role === 'user' || query.role === 'assistant')) {
        conditions.push('m.role = ?');
        params.push(query.role);
      }

      const sessionFilters = this.buildSessionFilters('m', query);
      conditions.push(...sessionFilters.conditions.map(condition =>
        condition
          .replace('m.session_id', 's.id')
          .replace('m.project_id', 's.project_id')
          .replace('m.created_at', 'm.created_at'),
      ));
      params.push(...sessionFilters.params);

      let orderBy = 'ORDER BY rank';
      if (query.sort === 'newest') {
        orderBy = 'ORDER BY m.created_at DESC';
      } else if (query.sort === 'oldest') {
        orderBy = 'ORDER BY m.created_at ASC';
      } else if (query.sort === 'session') {
        orderBy = 'ORDER BY m.session_id, m.created_at DESC';
      }

      const sql = `
        SELECT m.id, m.session_id as sessionId, m.role, m.content, m.created_at as createdAt,
               s.name as sessionName, 'message' as resultType
        FROM messages_fts f
        JOIN messages m ON m.rowid = f.rowid
        JOIN sessions s ON m.session_id = s.id
        WHERE ${conditions.join(' AND ')}
        ${orderBy}
        LIMIT ? OFFSET ?
      `;
      params.push(query.limit, query.offset);

      results = this.db.prepare(sql).all(...params) as SessionSearchResult[];
    }

    if (query.scope === 'files' || query.scope === 'all') {
      const params: Array<string | number> = [`"${safeQuery}"`];
      const sessionFilters = this.buildSessionFilters('fr', query);
      const conditions = sessionFilters.conditions.map(condition =>
        condition
          .replace('fr.session_id', 's.id')
          .replace('fr.project_id', 's.project_id')
          .replace('fr.created_at', 'fr.created_at'),
      );
      params.push(...sessionFilters.params);

      let orderBy = query.scope === 'files' ? 'ORDER BY rank' : '';
      if (query.sort === 'newest') {
        orderBy = 'ORDER BY fr.created_at DESC';
      } else if (query.sort === 'oldest') {
        orderBy = 'ORDER BY fr.created_at ASC';
      }

      const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
      const sql = `
        SELECT fr.message_id as id, fr.session_id as sessionId, '' as role,
               fr.file_path || ' (' || fr.source_type || ')' as content,
               fr.created_at as createdAt, s.name as sessionName, 'file' as resultType
        FROM files_fts f
        JOIN file_references fr ON fr.id = f.rowid
        JOIN sessions s ON fr.session_id = s.id
        WHERE files_fts MATCH ? ${whereClause}
        ${orderBy}
        LIMIT ? OFFSET ?
      `;
      params.push(query.limit, query.offset);

      const fileResults = this.db.prepare(sql).all(...params) as SessionSearchResult[];
      results = query.scope === 'all' ? [...results, ...fileResults] : fileResults;
    }

    if (query.scope === 'tool_calls' || query.scope === 'all') {
      const params: Array<string | number> = [`"${safeQuery}"`];
      const sessionFilters = this.buildSessionFilters('tc', query);
      const conditions = sessionFilters.conditions.map(condition =>
        condition
          .replace('tc.session_id', 's.id')
          .replace('tc.project_id', 's.project_id')
          .replace('tc.created_at', 'tc.created_at'),
      );
      params.push(...sessionFilters.params);

      let orderBy = query.scope === 'tool_calls' ? 'ORDER BY rank' : '';
      if (query.sort === 'newest') {
        orderBy = 'ORDER BY tc.created_at DESC';
      } else if (query.sort === 'oldest') {
        orderBy = 'ORDER BY tc.created_at ASC';
      }

      const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
      const sql = `
        SELECT tc.message_id as id, tc.session_id as sessionId, '' as role,
               tc.tool_name || ': ' || COALESCE(SUBSTR(tc.tool_input, 1, 100), '') as content,
               tc.created_at as createdAt, s.name as sessionName, 'tool_call' as resultType
        FROM tool_calls_fts f
        JOIN tool_call_records tc ON tc.id = f.rowid
        JOIN sessions s ON tc.session_id = s.id
        WHERE tool_calls_fts MATCH ? ${whereClause}
        ${orderBy}
        LIMIT ? OFFSET ?
      `;
      params.push(query.limit, query.offset);

      const toolResults = this.db.prepare(sql).all(...params) as SessionSearchResult[];
      results = query.scope === 'all' ? [...results, ...toolResults] : toolResults;
    }

    if (query.scope === 'all') {
      if (query.sort === 'newest') {
        results.sort((a, b) => b.createdAt - a.createdAt);
      } else if (query.sort === 'oldest') {
        results.sort((a, b) => a.createdAt - b.createdAt);
      }
      results = results.slice(0, query.limit);
    }

    return results;
  }

  saveHistory(query: string, resultCount: number, userId: string = 'default'): SearchHistoryEntry {
    return saveSearchHistory(this.db, query, resultCount, userId);
  }

  getHistory(userId: string = 'default', limit: number = 10): SearchHistoryEntry[] {
    return getSearchHistory(this.db, userId, limit);
  }

  clearHistory(userId: string = 'default'): void {
    clearSearchHistory(this.db, userId);
  }

  getSuggestions(prefix: string, userId: string = 'default', limit: number = 5): string[] {
    return getSearchSuggestions(this.db, prefix, userId, limit);
  }
}
