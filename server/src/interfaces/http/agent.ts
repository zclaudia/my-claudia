import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { normalizeToUnifiedPolicy } from '@my-claudia/shared/interaction/permissions';
import { toolRegistry } from '../../application/plugins/tool-registry.js';
import { getDiscoveredSkills } from '../../application/plugins/skill-tools.js';
import { CONTEXT_TEMPLATES } from '../../application/conversation/context/types.js';
import { validateCliJobProviderId } from '../../infrastructure/providers/cli-jobs/provider-validation.js';

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

const CLAUDIA_HOST_PROJECT_NAME = '__claudia';
const LEGACY_AGENT_PROJECT_NAME = '_Agent Assistant';
const CLAUDIA_HOST_SESSION_NAME = 'Claudia Chat';
const LEGACY_AGENT_SESSION_NAME = 'Agent Chat';

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

  // POST /api/agent/ensure — Ensure the hidden Claudia host project/session exist
  router.post('/ensure', (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      const config = db.prepare('SELECT * FROM agent_config WHERE id = 1').get() as AgentConfigRow | undefined;
      const existingProject = config?.project_id
        ? db.prepare('SELECT id FROM projects WHERE id = ?').get(config.project_id) as { id: string } | undefined
        : undefined;
      const existingSession = config?.session_id
        ? db.prepare('SELECT id FROM sessions WHERE id = ?').get(config.session_id) as { id: string } | undefined
        : undefined;

      if (existingProject && existingSession && config?.project_id && config?.session_id) {
        db.prepare(`
          UPDATE projects
          SET name = ?, type = 'chat_only', is_internal = 1, updated_at = ?
          WHERE id = ?
        `).run(CLAUDIA_HOST_PROJECT_NAME, now, config.project_id);
        db.prepare(`
          UPDATE sessions
          SET name = ?, updated_at = ?
          WHERE id = ?
        `).run(CLAUDIA_HOST_SESSION_NAME, now, config.session_id);
        res.json({
          success: true,
          data: { projectId: config.project_id, sessionId: config.session_id },
        } as ApiResponse<{ projectId: string; sessionId: string }>);
        return;
      }

      const reusableProject = db.prepare(`
        SELECT id
        FROM projects
        WHERE name IN (?, ?)
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(CLAUDIA_HOST_PROJECT_NAME, LEGACY_AGENT_PROJECT_NAME) as { id: string } | undefined;

      const projectId = reusableProject?.id ?? uuidv4();
      if (reusableProject) {
        db.prepare(`
          UPDATE projects
          SET name = ?, type = 'chat_only', is_internal = 1, updated_at = ?
          WHERE id = ?
        `).run(CLAUDIA_HOST_PROJECT_NAME, now, projectId);
      } else {
        db.prepare(`
          INSERT INTO projects (id, name, type, is_internal, created_at, updated_at)
          VALUES (?, ?, 'chat_only', 1, ?, ?)
        `).run(projectId, CLAUDIA_HOST_PROJECT_NAME, now, now);
      }

      const reusableSession = db.prepare(`
        SELECT id
        FROM sessions
        WHERE project_id = ?
          AND name IN (?, ?)
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(projectId, CLAUDIA_HOST_SESSION_NAME, LEGACY_AGENT_SESSION_NAME) as { id: string } | undefined;

      const sessionId = reusableSession?.id ?? uuidv4();
      if (reusableSession) {
        db.prepare(`
          UPDATE sessions
          SET name = ?, updated_at = ?
          WHERE id = ?
        `).run(CLAUDIA_HOST_SESSION_NAME, now, sessionId);
      } else {
        db.prepare(`
          INSERT INTO sessions (id, project_id, name, type, created_at, updated_at)
          VALUES (?, ?, ?, 'regular', ?, ?)
        `).run(sessionId, projectId, CLAUDIA_HOST_SESSION_NAME, now, now);
      }

      db.prepare(`
        INSERT INTO agent_config (id, enabled, project_id, session_id, created_at, updated_at)
        VALUES (1, 1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          updated_at = excluded.updated_at
      `).run(projectId, sessionId, now, now);

      res.json({
        success: true,
        data: { projectId, sessionId },
      } as ApiResponse<{ projectId: string; sessionId: string }>);
    } catch (error) {
      console.error('Error ensuring Claudia host project:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to ensure Claudia host project' },
      });
    }
  });

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
      const serializedPermissionPolicy = permissionPolicy !== undefined
        ? (typeof permissionPolicy === 'string' ? permissionPolicy : JSON.stringify(permissionPolicy))
        : null;

      if (serializedPermissionPolicy !== null) {
        const normalizedPolicy = normalizeToUnifiedPolicy(JSON.parse(serializedPermissionPolicy));
        const providerValidationError = validateCliJobProviderId(db, normalizedPolicy.aiReview.analysisProviderId);
        if (providerValidationError) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: providerValidationError },
          });
          return;
        }
      }

      db.prepare(`
        UPDATE agent_config SET
          enabled = COALESCE(?, enabled),
          permission_policy = ?,
          provider_id = COALESCE(?, provider_id),
          updated_at = ?
        WHERE id = 1
      `).run(
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        serializedPermissionPolicy,
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
