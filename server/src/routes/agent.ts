import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared';
import { toolRegistry } from '../plugins/tool-registry.js';
import { getDiscoveredSkills } from '../plugins/skill-tools.js';
import { CONTEXT_TEMPLATES } from '../context/types.js';

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

  // GET /api/agent/capabilities — Agent tools, skills, and runtime info
  router.get('/capabilities', (_req: Request, res: Response) => {
    try {
      const agentTools = toolRegistry.getAll()
        .filter(t => t.scope?.includes('agent-assistant'))
        .map(t => ({
          id: t.id,
          name: t.definition.function.name,
          description: t.definition.function.description || '',
          scope: t.scope || [],
        }));

      let skills: Array<{ id: string; name: string; description: string }> = [];
      try {
        skills = getDiscoveredSkills().map(s => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
        }));
      } catch { /* skills may not be initialized yet */ }

      res.json({
        success: true,
        data: {
          tools: agentTools,
          skills,
          contextTemplates: CONTEXT_TEMPLATES,
          maxConcurrentTasks: 3,
        },
      } as ApiResponse<unknown>);
    } catch (error) {
      console.error('Error fetching agent capabilities:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch agent capabilities' },
      });
    }
  });

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
