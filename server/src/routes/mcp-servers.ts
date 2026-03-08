/**
 * MCP Server Management API Routes
 *
 * CRUD endpoints for managing Claudia's MCP server registry.
 * MCP servers configured here are injected into providers at run time.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { McpServerConfig, ApiResponse } from '@my-claudia/shared';
import { loadMcpServers } from '../utils/claude-config.js';

// ── DB row type ──────────────────────────────────────────────

interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string | null;
  env: string | null;
  enabled: number;
  description: string | null;
  source: string;
  provider_scope: string | null;
  created_at: number;
  updated_at: number;
}

function rowToConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: row.args ? JSON.parse(row.args) : undefined,
    env: row.env ? JSON.parse(row.env) : undefined,
    enabled: row.enabled === 1,
    description: row.description || undefined,
    source: row.source as McpServerConfig['source'],
    providerScope: row.provider_scope ? JSON.parse(row.provider_scope) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Routes ───────────────────────────────────────────────────

export function createMcpServerRoutes(db: Database.Database): Router {
  const router = Router();

  /**
   * GET /api/mcp-servers
   * List all MCP servers.
   */
  router.get('/', (_req: Request, res: Response) => {
    try {
      const rows = db.prepare(`
        SELECT id, name, command, args, env, enabled, description,
               source, provider_scope, created_at, updated_at
        FROM mcp_servers ORDER BY name ASC
      `).all() as McpServerRow[];

      const data = rows.map(rowToConfig);
      res.json({ success: true, data } as ApiResponse<McpServerConfig[]>);
    } catch (error) {
      console.error('[MCP Servers] Error listing:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to list MCP servers' },
      });
    }
  });

  /**
   * POST /api/mcp-servers
   * Create a new MCP server.
   */
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, command, args, env, enabled, description, providerScope } = req.body;

      if (!name || !command) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'name and command are required' },
        });
        return;
      }

      // Check uniqueness
      const existing = db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(name);
      if (existing) {
        res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE', message: `MCP server "${name}" already exists` },
        });
        return;
      }

      const id = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO mcp_servers (id, name, command, args, env, enabled, description, source, provider_scope, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?)
      `).run(
        id,
        name,
        command,
        args ? JSON.stringify(args) : null,
        env ? JSON.stringify(env) : null,
        enabled !== false ? 1 : 0,
        description || null,
        providerScope ? JSON.stringify(providerScope) : null,
        now,
        now,
      );

      const row = db.prepare(`
        SELECT id, name, command, args, env, enabled, description,
               source, provider_scope, created_at, updated_at
        FROM mcp_servers WHERE id = ?
      `).get(id) as McpServerRow;

      res.status(201).json({ success: true, data: rowToConfig(row) } as ApiResponse<McpServerConfig>);
    } catch (error) {
      console.error('[MCP Servers] Error creating:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create MCP server' },
      });
    }
  });

  /**
   * PUT /api/mcp-servers/:id
   * Update an MCP server.
   */
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const existing = db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(req.params.id);
      if (!existing) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'MCP server not found' },
        });
        return;
      }

      const { name, command, args, env, enabled, description, providerScope } = req.body;
      const now = Date.now();

      // Check name uniqueness if changing
      if (name) {
        const duplicate = db.prepare('SELECT id FROM mcp_servers WHERE name = ? AND id != ?').get(name, req.params.id);
        if (duplicate) {
          res.status(409).json({
            success: false,
            error: { code: 'DUPLICATE', message: `MCP server "${name}" already exists` },
          });
          return;
        }
      }

      db.prepare(`
        UPDATE mcp_servers SET
          name = COALESCE(?, name),
          command = COALESCE(?, command),
          args = ?,
          env = ?,
          enabled = COALESCE(?, enabled),
          description = ?,
          provider_scope = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        name || null,
        command || null,
        args !== undefined ? JSON.stringify(args) : null,
        env !== undefined ? JSON.stringify(env) : null,
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        description !== undefined ? (description || null) : null,
        providerScope !== undefined ? (providerScope ? JSON.stringify(providerScope) : null) : null,
        now,
        req.params.id,
      );

      const row = db.prepare(`
        SELECT id, name, command, args, env, enabled, description,
               source, provider_scope, created_at, updated_at
        FROM mcp_servers WHERE id = ?
      `).get(req.params.id) as McpServerRow;

      res.json({ success: true, data: rowToConfig(row) } as ApiResponse<McpServerConfig>);
    } catch (error) {
      console.error('[MCP Servers] Error updating:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update MCP server' },
      });
    }
  });

  /**
   * DELETE /api/mcp-servers/:id
   * Delete an MCP server.
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const result = db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(req.params.id);
      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'MCP server not found' },
        });
        return;
      }
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      console.error('[MCP Servers] Error deleting:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete MCP server' },
      });
    }
  });

  /**
   * POST /api/mcp-servers/:id/toggle
   * Toggle enabled/disabled.
   */
  router.post('/:id/toggle', (req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT id, enabled FROM mcp_servers WHERE id = ?').get(req.params.id) as { id: string; enabled: number } | undefined;
      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'MCP server not found' },
        });
        return;
      }

      const newEnabled = row.enabled === 1 ? 0 : 1;
      db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?').run(newEnabled, Date.now(), req.params.id);

      const updated = db.prepare(`
        SELECT id, name, command, args, env, enabled, description,
               source, provider_scope, created_at, updated_at
        FROM mcp_servers WHERE id = ?
      `).get(req.params.id) as McpServerRow;

      res.json({ success: true, data: rowToConfig(updated) } as ApiResponse<McpServerConfig>);
    } catch (error) {
      console.error('[MCP Servers] Error toggling:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to toggle MCP server' },
      });
    }
  });

  /**
   * POST /api/mcp-servers/import
   * Import MCP servers from ~/.claude/mcp.json.
   * Returns the list of imported servers (skips duplicates).
   */
  router.post('/import', (_req: Request, res: Response) => {
    try {
      const nativeServers = loadMcpServers();
      const imported: McpServerConfig[] = [];
      const skipped: string[] = [];

      for (const [name, srv] of Object.entries(nativeServers)) {
        const existing = db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(name);
        if (existing) {
          skipped.push(name);
          continue;
        }

        const id = uuidv4();
        const now = Date.now();
        db.prepare(`
          INSERT INTO mcp_servers (id, name, command, args, env, enabled, description, source, provider_scope, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, NULL, 'imported', NULL, ?, ?)
        `).run(
          id,
          name,
          srv.command,
          srv.args ? JSON.stringify(srv.args) : null,
          srv.env ? JSON.stringify(srv.env) : null,
          now,
          now,
        );

        const row = db.prepare(`
          SELECT id, name, command, args, env, enabled, description,
                 source, provider_scope, created_at, updated_at
          FROM mcp_servers WHERE id = ?
        `).get(id) as McpServerRow;

        imported.push(rowToConfig(row));
      }

      res.json({
        success: true,
        data: { imported, skipped },
      } as ApiResponse<{ imported: McpServerConfig[]; skipped: string[] }>);
    } catch (error) {
      console.error('[MCP Servers] Error importing:', error);
      res.status(500).json({
        success: false,
        error: { code: 'IMPORT_ERROR', message: 'Failed to import MCP servers' },
      });
    }
  });

  return router;
}
