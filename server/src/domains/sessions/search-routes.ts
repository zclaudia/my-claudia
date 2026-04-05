import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { SessionSearchRepository } from './search-repository.js';

function buildSearchPreview(content: string): string {
  const withoutThinkBlocks = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?think>/gi, ' ');
  const normalized = withoutThinkBlocks.replace(/\s+/g, ' ').trim();
  return normalized || 'No preview text';
}

export function mountSearchRoutes(router: Router, db: Database.Database): void {
  const repo = new SessionSearchRepository(db);

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

      const results = repo.search({
        q,
        projectId,
        role,
        sessionIds,
        startDate,
        endDate,
        sort,
        scope,
        limit,
        offset,
      });

      const truncated = results.map((result) => ({
        ...result,
        content: (() => {
          const preview = buildSearchPreview(result.content);
          return preview.length > 200 ? preview.substring(0, 200) + '...' : preview;
        })(),
      }));

      try {
        repo.saveHistory(q.trim(), results.length);
      } catch (err) {
        console.error('Error saving search history:', err);
      }

      res.json({ success: true, data: { results: truncated } });
    } catch (error) {
      console.error('Error searching messages:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to search messages' } });
    }
  });

  router.get('/search/history', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const history = repo.getHistory(userId, limit);

      res.json({ success: true, data: { history } });
    } catch (error) {
      console.error('Error fetching search history:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to fetch search history' } });
    }
  });

  router.delete('/search/history', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';
      repo.clearHistory(userId);

      res.json({ success: true, data: { cleared: true } });
    } catch (error) {
      console.error('Error clearing search history:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to clear search history' } });
    }
  });

  router.get('/search/suggestions', (req: Request, res: Response) => {
    try {
      const prefix = (req.query.prefix as string) || '';
      const userId = (req.query.userId as string) || 'default';
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);
      const suggestions = repo.getSuggestions(prefix, userId, limit);

      res.json({ success: true, data: { suggestions } });
    } catch (error) {
      console.error('Error fetching search suggestions:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to fetch search suggestions' } });
    }
  });
}
