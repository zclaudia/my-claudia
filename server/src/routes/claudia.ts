import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { BranchAction, ClaudiaTaskStatus } from '@my-claudia/shared/protocol/messages';

interface TaskRow {
  id: string;
  parent_task_id: string | null;
  project_id: string | null;
  session_id: string | null;
  branch_id: string | null;
  branch_action: string | null;
  context_reset: number | null;
  status: string;
  task: string;
  result_summary: string | null;
  error_summary: string | null;
  response_text: string | null;
  tool_count: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface ClaudiaTaskResponse {
  id: string;
  sessionId: string | null;
  branchId: string | null;
  branchAction?: BranchAction;
  contextReset?: boolean;
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  responseText?: string;
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

export function createClaudiaRoutes(db: Database.Database): Router {
  const router = Router();
  const getLastAssistantMessage = db.prepare(
    `SELECT content FROM messages
     WHERE session_id = ? AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`
  );
  const getToolCount = db.prepare(
    `SELECT COUNT(*) as count
     FROM tool_call_records
     WHERE session_id = ?`
  );

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
        `SELECT t.id, t.parent_task_id, t.project_id, t.session_id, t.branch_id, t.branch_action,
                t.context_reset, t.status, t.task, t.result_summary, t.error_summary,
                t.response_text, t.tool_count, t.created_at, t.updated_at, t.completed_at
         FROM orchestrator_tasks t
         WHERE t.project_id = ? AND t.kind = 'agent' AND t.initiator = 'claudia'
         ORDER BY t.created_at DESC
         LIMIT ?`
      ).all(projectId, limit) as TaskRow[];

      const tasks: ClaudiaTaskResponse[] = rows.map((row) => {
        const snippet = row.task.trim().replace(/\s+/g, ' ').slice(0, 80);
        const responseText = row.response_text ?? (
          row.session_id && (row.status === 'completed' || row.status === 'failed')
            ? (getLastAssistantMessage.get(row.session_id) as { content: string } | undefined)?.content
            : undefined
        );
        const toolCount = row.tool_count ?? (
          row.session_id
            ? (getToolCount.get(row.session_id) as { count: number } | undefined)?.count
            : undefined
        );

        return {
          id: row.id,
          sessionId: row.session_id,
          branchId: row.branch_id,
          branchAction: (row.branch_action ?? undefined) as BranchAction | undefined,
          contextReset: Boolean(row.context_reset),
          input: row.task,
          title: snippet,
          status: row.status as ClaudiaTaskStatus,
          summary: row.result_summary ?? undefined,
          error: row.error_summary ?? undefined,
          responseText,
          toolCount: toolCount && toolCount > 0 ? toolCount : undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
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
