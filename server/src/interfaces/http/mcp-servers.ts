/**
 * MCP Server Management API Routes
 *
 * CRUD endpoints for managing Claudia's MCP server registry.
 * MCP servers configured here are injected into providers at run time.
 */

import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { McpServerConfig } from '@my-claudia/shared/core/mcp';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { mcpClientManager } from '../../utils/mcp-client-manager.js';
import { McpServerService, McpServerServiceError, type McpServerRow } from '../../infrastructure/services/mcp-server-service.js';
import { sendApiError } from './response.js';

// ── Routes ───────────────────────────────────────────────────

export function createMcpServerRoutes(db: Database.Database): Router {
  const router = Router();
  const mcpServerService = new McpServerService(db);

  /**
   * GET /api/mcp-servers
   * List all MCP servers.
   */
  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = mcpServerService.listServers();
      res.json({ success: true, data } as ApiResponse<McpServerConfig[]>);
    } catch (error) {
      console.error('[MCP Servers] Error listing:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to list MCP servers');
    }
  });

  /**
   * POST /api/mcp-servers
   * Create a new MCP server.
   */
  router.post('/', (req: Request, res: Response) => {
    try {
      const data = mcpServerService.createServer(req.body ?? {});
      res.status(201).json({ success: true, data } as ApiResponse<McpServerConfig>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error creating:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to create MCP server');
    }
  });

  /**
   * PUT /api/mcp-servers/:id
   * Update an MCP server.
   */
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const data = mcpServerService.updateServer(req.params.id, req.body ?? {});
      res.json({ success: true, data } as ApiResponse<McpServerConfig>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error updating:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to update MCP server');
    }
  });

  /**
   * DELETE /api/mcp-servers/:id
   * Delete an MCP server.
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      mcpServerService.deleteServer(req.params.id);
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error deleting:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to delete MCP server');
    }
  });

  /**
   * POST /api/mcp-servers/:id/toggle
   * Toggle enabled/disabled.
   */
  router.post('/:id/toggle', (req: Request, res: Response) => {
    try {
      const data = mcpServerService.toggleServer(req.params.id);
      res.json({ success: true, data } as ApiResponse<McpServerConfig>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error toggling:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to toggle MCP server');
    }
  });

  /**
   * POST /api/mcp-servers/import
   * Import MCP servers from ~/.claude/mcp.json.
   * Returns the list of imported servers (skips duplicates).
   */
  router.post('/import', (_req: Request, res: Response) => {
    try {
      const data = mcpServerService.importServers();
      res.json({ success: true, data } as ApiResponse<{ imported: McpServerConfig[]; skipped: string[] }>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error importing:', error);
      sendApiError(res, 500, 'IMPORT_ERROR', 'Failed to import MCP servers');
    }
  });

  /**
   * POST /api/mcp-servers/:name/call-tool
   * Call a tool on a named MCP server.
   *
   * Body: { tool: string, arguments?: Record<string, unknown> }
   * Returns the MCP tool result.
   */
  router.post('/:name/call-tool', async (req: Request, res: Response) => {
    const { name } = req.params;
    const { tool, arguments: toolArgs } = req.body as {
      tool?: string;
      arguments?: Record<string, unknown>;
    };

    if (!tool) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'tool name is required' },
      });
      return;
    }

    try {
      // Look up MCP server config by name
      const row = db.prepare(
        'SELECT id, name, command, args, env, enabled FROM mcp_servers WHERE name = ?',
      ).get(name) as McpServerRow | undefined;

      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `MCP server "${name}" not found` },
        });
        return;
      }

      if (!row.enabled) {
        res.status(400).json({
          success: false,
          error: { code: 'DISABLED', message: `MCP server "${name}" is disabled` },
        });
        return;
      }

      const config = {
        command: row.command,
        args: row.args ? JSON.parse(row.args) as string[] : [],
        env: row.env ? JSON.parse(row.env) as Record<string, string> : undefined,
      };

      const result = await mcpClientManager.callTool(name, config, tool, toolArgs || {});

      res.json({ success: true, data: { result } });
    } catch (error) {
      console.error(`[MCP Servers] Error calling tool "${tool}" on "${name}":`, error);
      res.status(502).json({
        success: false,
        error: {
          code: 'TOOL_CALL_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  /**
   * GET /api/mcp-servers/:name/tools
   * List available tools on a named MCP server.
   */
  router.get('/:name/tools', async (req: Request, res: Response) => {
    const { name } = req.params;

    try {
      const row = db.prepare(
        'SELECT id, name, command, args, env, enabled FROM mcp_servers WHERE name = ?',
      ).get(name) as McpServerRow | undefined;

      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `MCP server "${name}" not found` },
        });
        return;
      }

      if (!row.enabled) {
        res.status(400).json({
          success: false,
          error: { code: 'DISABLED', message: `MCP server "${name}" is disabled` },
        });
        return;
      }

      const config = {
        command: row.command,
        args: row.args ? JSON.parse(row.args) as string[] : [],
        env: row.env ? JSON.parse(row.env) as Record<string, string> : undefined,
      };

      const tools = await mcpClientManager.listTools(name, config);

      res.json({ success: true, data: { tools } });
    } catch (error) {
      console.error(`[MCP Servers] Error listing tools on "${name}":`, error);
      res.status(502).json({
        success: false,
        error: {
          code: 'LIST_TOOLS_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  return router;
}
