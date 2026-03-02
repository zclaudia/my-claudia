import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared';

interface AgentConfig {
  id: number;
  enabled: boolean;
  projectId: string | null;
  sessionId: string | null;
  providerId: string | null;
  permissionPolicy: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AgentConfigRow {
  id: number;
  enabled: number;
  project_id: string | null;
  session_id: string | null;
  provider_id: string | null;
  permission_policy: string | null;
  created_at: number;
  updated_at: number;
}

function rowToConfig(row: AgentConfigRow): AgentConfig {
  return {
    id: row.id,
    enabled: row.enabled === 1,
    projectId: row.project_id,
    sessionId: row.session_id,
    providerId: row.provider_id,
    permissionPolicy: row.permission_policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAgentRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/agent/config — Get agent configuration
  router.get('/config', (_req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT * FROM agent_config WHERE id = 1').get() as AgentConfigRow | undefined;
      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Agent config not found' }
        });
        return;
      }
      res.json({ success: true, data: rowToConfig(row) } as ApiResponse<AgentConfig>);
    } catch (error) {
      console.error('Error fetching agent config:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch agent config' }
      });
    }
  });

  // PUT /api/agent/config — Update agent configuration
  router.put('/config', (req: Request, res: Response) => {
    try {
      const { enabled, permissionPolicy, providerId } = req.body;
      const now = Date.now();

      db.prepare(`
        UPDATE agent_config SET
          enabled = COALESCE(?, enabled),
          permission_policy = ?,
          provider_id = COALESCE(?, provider_id),
          updated_at = ?
        WHERE id = 1
      `).run(
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        permissionPolicy !== undefined ? (typeof permissionPolicy === 'string' ? permissionPolicy : JSON.stringify(permissionPolicy)) : null,
        providerId !== undefined ? providerId : null,
        now
      );

      const row = db.prepare('SELECT * FROM agent_config WHERE id = 1').get() as AgentConfigRow;
      res.json({ success: true, data: rowToConfig(row) } as ApiResponse<AgentConfig>);
    } catch (error) {
      console.error('Error updating agent config:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update agent config' }
      });
    }
  });

  return router;
}
