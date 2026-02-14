import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared';
import { getAgentSystemPrompt } from '../agent/agent-prompt.js';

interface AgentConfig {
  id: number;
  enabled: boolean;
  projectId: string | null;
  sessionId: string | null;
  permissionPolicy: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AgentConfigRow {
  id: number;
  enabled: number;
  project_id: string | null;
  session_id: string | null;
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
      const { enabled, permissionPolicy } = req.body;
      const now = Date.now();

      db.prepare(`
        UPDATE agent_config SET
          enabled = COALESCE(?, enabled),
          permission_policy = ?,
          updated_at = ?
        WHERE id = 1
      `).run(
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        permissionPolicy !== undefined ? (typeof permissionPolicy === 'string' ? permissionPolicy : JSON.stringify(permissionPolicy)) : null,
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

  // POST /api/agent/ensure — Ensure agent project + session exist
  router.post('/ensure', (_req: Request, res: Response) => {
    try {
      const config = db.prepare('SELECT * FROM agent_config WHERE id = 1').get() as AgentConfigRow | undefined;

      // Check if already configured with valid project and session
      if (config?.project_id && config?.session_id) {
        const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(config.project_id);
        const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(config.session_id);

        if (project && session) {
          res.json({
            success: true,
            data: { projectId: config.project_id, sessionId: config.session_id }
          });
          return;
        }
      }

      const now = Date.now();

      // Create agent project
      const projectId = uuidv4();
      const systemPrompt = getAgentSystemPrompt();

      db.prepare(`
        INSERT INTO projects (id, name, type, system_prompt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(projectId, '_Agent Assistant', 'chat_only', systemPrompt, now, now);

      // Create agent session
      const sessionId = uuidv4();
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, projectId, 'Agent Chat', now, now);

      // Update agent_config with project and session IDs
      db.prepare(`
        UPDATE agent_config SET
          project_id = ?,
          session_id = ?,
          updated_at = ?
        WHERE id = 1
      `).run(projectId, sessionId, now);

      console.log(`[Agent] Created agent project ${projectId} and session ${sessionId}`);

      res.json({
        success: true,
        data: { projectId, sessionId }
      });
    } catch (error) {
      console.error('Error ensuring agent setup:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to ensure agent setup' }
      });
    }
  });

  return router;
}

/**
 * Check if a session belongs to the agent project.
 * Used by handleRunStart to force bypassPermissions for agent sessions.
 */
export function isAgentSession(db: Database.Database, projectId: string): boolean {
  const row = db.prepare('SELECT project_id FROM agent_config WHERE id = 1').get() as { project_id: string | null } | undefined;
  return row?.project_id === projectId && projectId !== null;
}
