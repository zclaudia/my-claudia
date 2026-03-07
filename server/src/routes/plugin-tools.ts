/**
 * Plugin Tools API Routes
 *
 * Provides HTTP endpoints for the MCP bridge to list and execute plugin tools.
 * These routes are used by the MCP bridge process to proxy tool calls
 * from the Claude SDK back to the main server's tool registry.
 */

import { Router, Request, Response } from 'express';
import { toolRegistry } from '../plugins/tool-registry.js';

export function createPluginToolsRoutes(): Router {
  const router = Router();

  /**
   * GET /api/plugins/tools
   * List all plugin tools in MCP-compatible format.
   */
  router.get('/tools', (_req: Request, res: Response) => {
    const pluginTools = toolRegistry.getAll().filter(t => t.source === 'plugin');
    const tools = pluginTools.map(t => ({
      name: t.definition.function.name,
      description: t.definition.function.description,
      inputSchema: t.definition.function.parameters,
    }));
    res.json({ tools });
  });

  /**
   * POST /api/plugins/tools/:name/execute
   * Execute a plugin tool by name.
   */
  router.post('/tools/:name/execute', async (req: Request, res: Response) => {
    const { name } = req.params;
    const args = req.body.arguments || req.body.args || {};

    try {
      const result = await toolRegistry.execute(name, args);
      res.json({ result });
    } catch (error) {
      res.status(500).json({
        error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  return router;
}
