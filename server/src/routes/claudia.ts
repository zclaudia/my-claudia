import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ClaudiaTaskStatus } from '@my-claudia/shared';

interface TaskRow {
  id: string;
  parent_task_id: string | null;
  project_id: string | null;
  session_id: string | null;
  status: string;
  task: string;
  result_summary: string | null;
  error_summary: string | null;
  created_at: number;
  completed_at: number | null;
}

interface ClaudiaTaskResponse {
  id: string;
  sessionId: string | null;
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  createdAt: number;
}

export function createClaudiaRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/claudia/tasks?projectId=xxx&limit=50
  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) {
        res.status(400).json({ success: false, error: { code: 'MISSING_PROJECT_ID', message: 'projectId is required' } });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const rows = db.prepare(
        `SELECT t.id, t.parent_task_id, t.project_id, t.session_id, t.status, t.task,
                t.result_summary, t.error_summary, t.created_at, t.completed_at
         FROM orchestrator_tasks t
         INNER JOIN agent_feed af ON af.task_id = t.id
         WHERE t.project_id = ? AND t.kind = 'agent' AND af.source = 'manual'
         ORDER BY t.created_at DESC
         LIMIT ?`
      ).all(projectId, limit) as TaskRow[];

      const tasks: ClaudiaTaskResponse[] = rows.map((row) => {
        const snippet = row.task.trim().replace(/\s+/g, ' ').slice(0, 80);
        return {
          id: row.id,
          sessionId: row.session_id,
          input: row.task,
          title: snippet,
          status: row.status as ClaudiaTaskStatus,
          summary: row.result_summary ?? undefined,
          error: row.error_summary ?? undefined,
          createdAt: row.created_at,
        };
      });

      res.json({ success: true, data: { tasks } });
    } catch (error) {
      console.error('Error listing claudia tasks:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list tasks' } });
    }
  });

  return router;
}
