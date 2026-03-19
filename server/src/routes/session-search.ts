import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { saveSearchHistory, getSearchHistory, clearSearchHistory, getSearchSuggestions } from '../storage/search-history.js';

function buildSearchPreview(content: string): string {
  const withoutThinkBlocks = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?think>/gi, ' ');
  const normalized = withoutThinkBlocks.replace(/\s+/g, ' ').trim();
  return normalized || 'No preview text';
}

export function mountSearchRoutes(router: Router, db: Database.Database): void {
  // Search messages across sessions using FTS5
  router.get('/search/messages', (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      const projectId = req.query.projectId as string | undefined;
      const role = req.query.role as string | undefined;
      const sessionIds = req.query.sessionIds as string | undefined;
      const startDate = req.query.startDate ? parseInt(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? parseInt(req.query.endDate as string) : undefined;
      const sort = (req.query.sort as string) || 'relevance';
      const scope = (req.query.scope as string) || 'messages';
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      if (!q || q.trim().length === 0) {
        res.json({ success: true, data: { results: [] } });
        return;
      }

      const safeQuery = q.replace(/"/g, '""');
      let results: Array<{
        id: string; sessionId: string; role: string; content: string; createdAt: number; sessionName: string | null; resultType?: string;
      }> = [];

      const buildSessionFilters = (prefix: string): { conditions: string[]; params: (string | number)[] } => {
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (projectId) {
          conditions.push(`${prefix}.project_id = ?`);
          params.push(projectId);
        }

        if (sessionIds) {
          const ids = sessionIds.split(',').filter(id => id.trim());
          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            conditions.push(`${prefix}.session_id IN (${placeholders})`);
            params.push(...ids);
          }
        }

        if (startDate) {
          conditions.push(`${prefix}.created_at >= ?`);
          params.push(startDate);
        }
        if (endDate) {
          conditions.push(`${prefix}.created_at <= ?`);
          params.push(endDate);
        }

        return { conditions, params };
      };

      // Search messages
      if (scope === 'messages' || scope === 'all') {
        const conditions: string[] = ['messages_fts MATCH ?'];
        const params: (string | number)[] = [`"${safeQuery}"`];

        if (role && (role === 'user' || role === 'assistant')) {
          conditions.push('m.role = ?');
          params.push(role);
        }

        const sessionFilters = buildSessionFilters('m');
        conditions.push(...sessionFilters.conditions.map(c => c.replace('m.session_id', 's.id').replace('m.project_id', 's.project_id').replace('m.created_at', 'm.created_at')));
        params.push(...sessionFilters.params);

        let orderBy = 'ORDER BY rank';
        if (sort === 'newest') {
          orderBy = 'ORDER BY m.created_at DESC';
        } else if (sort === 'oldest') {
          orderBy = 'ORDER BY m.created_at ASC';
        } else if (sort === 'session') {
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
        params.push(limit, offset);

        results = db.prepare(sql).all(...params) as typeof results;
      }

      // Search files
      if (scope === 'files' || scope === 'all') {
        const params: (string | number)[] = [`"${safeQuery}"`];
        const sessionFilters = buildSessionFilters('fr');
        const conditions = sessionFilters.conditions.map(c => c.replace('fr.session_id', 's.id').replace('fr.project_id', 's.project_id').replace('fr.created_at', 'fr.created_at'));
        params.push(...sessionFilters.params);

        let orderBy = scope === 'files' ? 'ORDER BY rank' : '';
        if (sort === 'newest') {
          orderBy = 'ORDER BY fr.created_at DESC';
        } else if (sort === 'oldest') {
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
        params.push(limit, offset);

        const fileResults = db.prepare(sql).all(...params) as typeof results;
        results = scope === 'all' ? [...results, ...fileResults] : fileResults;
      }

      // Search tool calls
      if (scope === 'tool_calls' || scope === 'all') {
        const params: (string | number)[] = [`"${safeQuery}"`];
        const sessionFilters = buildSessionFilters('tc');
        const conditions = sessionFilters.conditions.map(c => c.replace('tc.session_id', 's.id').replace('tc.project_id', 's.project_id').replace('tc.created_at', 'tc.created_at'));
        params.push(...sessionFilters.params);

        let orderBy = scope === 'tool_calls' ? 'ORDER BY rank' : '';
        if (sort === 'newest') {
          orderBy = 'ORDER BY tc.created_at DESC';
        } else if (sort === 'oldest') {
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
        params.push(limit, offset);

        const toolResults = db.prepare(sql).all(...params) as typeof results;
        results = scope === 'all' ? [...results, ...toolResults] : toolResults;
      }

      // If scope is 'all', sort the combined results
      if (scope === 'all') {
        if (sort === 'newest') {
          results.sort((a, b) => b.createdAt - a.createdAt);
        } else if (sort === 'oldest') {
          results.sort((a, b) => a.createdAt - b.createdAt);
        }
        results = results.slice(0, limit);
      }

      const truncated = results.map(r => ({
        ...r,
        content: (() => {
          const preview = buildSearchPreview(r.content);
          return preview.length > 200 ? preview.substring(0, 200) + '...' : preview;
        })(),
      }));

      // Save search history
      try {
        saveSearchHistory(db, q.trim(), results.length);
      } catch (err) {
        console.error('Error saving search history:', err);
      }

      res.json({ success: true, data: { results: truncated } });
    } catch (error) {
      console.error('Error searching messages:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to search messages' } });
    }
  });

  // Get search history
  router.get('/search/history', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const history = getSearchHistory(db, userId, limit);

      res.json({ success: true, data: { history } });
    } catch (error) {
      console.error('Error fetching search history:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to fetch search history' } });
    }
  });

  // Clear search history
  router.delete('/search/history', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';

      clearSearchHistory(db, userId);

      res.json({ success: true, data: { cleared: true } });
    } catch (error) {
      console.error('Error clearing search history:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to clear search history' } });
    }
  });

  // Get search suggestions
  router.get('/search/suggestions', (req: Request, res: Response) => {
    try {
      const prefix = (req.query.prefix as string) || '';
      const userId = (req.query.userId as string) || 'default';
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);

      const suggestions = getSearchSuggestions(db, prefix, userId, limit);

      res.json({ success: true, data: { suggestions } });
    } catch (error) {
      console.error('Error fetching search suggestions:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to fetch search suggestions' } });
    }
  });
}
